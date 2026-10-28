import { ADJUST_BATCH_OVERHEAD_ROWS } from "./budget.ts";

export type CorporateActionKind =
  | "cash_dividend"
  | "bonus"
  | "split"
  | "reverse_split"
  | "rights"
  | "name_change"
  | "other";

export type CorporateActionStatus = "needs_ratio" | "recorded" | "adjusting" | "applied";

export interface RawCsvBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface DerivedRawBar extends RawCsvBar {
  rawDerived: true;
}

export interface AppliedAction {
  kind: CorporateActionKind;
  ratio: number;
  exDate: string;
  status: "applied";
}

export interface BackfillRow extends DerivedRawBar {
  adjOpen: number;
  adjHigh: number;
  adjLow: number;
  adjClose: number;
  adjFactor: number;
}

export interface ApplyCandidate {
  id: number;
  isin: string;
  ticker: string;
  kind: CorporateActionKind;
  ratio: number | null;
  exDate: string;
  status: string;
  basisDate: string | null;
  backfillState: "loading" | "done" | null;
  rowCount: number;
  latestSession: string | null;
  adjustRowsToday: number;
}

const BAR_LINE_PATTERN = /^\d{4}-\d{2}-\d{2}\//;
const CSV_COLUMN_COUNT = 6;
const DATE_LENGTH = 10;

export function actionFactor(kind: CorporateActionKind, ratio: number): number {
  if (!(ratio > 0)) throw new Error("ratio must be positive");
  if (kind === "bonus") return 1 / (1 + ratio);
  if (kind === "split" || kind === "reverse_split") return 1 / ratio;
  throw new Error(`${kind} does not adjust prices`);
}

export function parseMubasherCsvLine(line: string): RawCsvBar | null {
  if (!BAR_LINE_PATTERN.test(line)) return null;
  const columns = line.trim().split(",");
  if (columns.length !== CSV_COLUMN_COUNT) return null;
  if (columns.some((column) => column.trim() === "")) return null;
  const [reference, high, low, close, volume] = columns.slice(1).map(Number) as [number, number, number, number, number];
  if ([reference, high, low, close, volume].some((value) => !Number.isFinite(value))) return null;
  return {
    date: line.slice(0, DATE_LENGTH),
    open: Math.min(Math.max(reference, low), high),
    high,
    low,
    close,
    volume,
  };
}

export function deriveRaw(bar: RawCsvBar, cumulativeFactor: number): DerivedRawBar {
  return {
    date: bar.date,
    open: bar.open / cumulativeFactor,
    high: bar.high / cumulativeFactor,
    low: bar.low / cumulativeFactor,
    close: bar.close / cumulativeFactor,
    volume: bar.volume,
    rawDerived: true,
  };
}

function productOfFactors(actions: AppliedAction[], include: (action: AppliedAction) => boolean): number {
  return actions.filter(include).reduce((product, action) => product * actionFactor(action.kind, action.ratio), 1);
}

export function backfillRowValues(csvBar: RawCsvBar, appliedActions: AppliedAction[], basisDate: string): BackfillRow {
  if (appliedActions.some((action) => action.status !== "applied")) throw new Error("only applied actions");
  const afterBasis = productOfFactors(appliedActions, (action) => action.exDate > basisDate);
  const insideCsv = productOfFactors(
    appliedActions,
    (action) => action.exDate > csvBar.date && action.exDate <= basisDate,
  );
  const raw = deriveRaw(csvBar, insideCsv);
  return {
    ...raw,
    adjOpen: csvBar.open * afterBasis,
    adjHigh: csvBar.high * afterBasis,
    adjLow: csvBar.low * afterBasis,
    adjClose: csvBar.close * afterBasis,
    adjFactor: productOfFactors(appliedActions, (action) => action.exDate > csvBar.date),
  };
}

export function validateRatio(kind: CorporateActionKind, ratio: number): string | null {
  if (kind === "bonus") return ratio > 0 && ratio <= 10 ? null : "ratio for bonus must be 0 < ratio <= 10";
  if (kind === "split") return ratio > 1 ? null : "ratio for split must be ratio > 1";
  if (kind === "reverse_split") return ratio > 0 && ratio < 1 ? null : "ratio for reverse_split must be 0 < ratio < 1";
  return null;
}

function exceedsDailyCap(candidate: ApplyCandidate, maxRowsPerDay: number): boolean {
  return candidate.adjustRowsToday + candidate.rowCount + ADJUST_BATCH_OVERHEAD_ROWS > maxRowsPerDay;
}

export function applyRefusal(
  candidate: ApplyCandidate,
  maxRowsPerDay: number,
): "not_recorded" | "ex_date_not_reached" | "backfill_loading" | "daily_cap" | null {
  if (candidate.status !== "recorded" || candidate.ratio === null) return "not_recorded";
  if (candidate.latestSession === null || candidate.exDate > candidate.latestSession) return "ex_date_not_reached";
  if (candidate.backfillState === "loading") return "backfill_loading";
  if (exceedsDailyCap(candidate, maxRowsPerDay)) return "daily_cap";
  return null;
}

export function revertRefusal(
  candidate: ApplyCandidate,
  maxRowsPerDay: number,
): "not_applied" | "backfill_loading" | "daily_cap" | null {
  if (candidate.status !== "applied") return "not_applied";
  if (candidate.backfillState === "loading") return "backfill_loading";
  if (exceedsDailyCap(candidate, maxRowsPerDay)) return "daily_cap";
  return null;
}
