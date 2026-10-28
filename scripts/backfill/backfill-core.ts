import { ACCOUNTING_ROWS_PER_CALL, backfillAllowance } from "../../src/domain/budget.ts";
import { parseMubasherCsvLine, type AppliedAction, type BackfillRow, type RawCsvBar } from "../../src/domain/adjust.ts";
import { sessionStatus, utcDay } from "../../src/domain/calendar.ts";
import { parseMubasherActionRow, type Row } from "../../src/providers/mubasher-parse.ts";
import type { ProviderAction } from "../../src/providers/types.ts";

export type Mode = "validate" | "actions" | "load";

export type ParsedArgs =
  | { kind: "usage" }
  | { kind: "error"; message: string }
  | { kind: "run"; mode: Mode; years: number; duringSession: boolean };

export interface Caps {
  GLOBAL_DAILY_CALLS: number;
  ADJUST_MAX_ROWS_PER_DAY: number;
  PERSONAL_DAILY_ROWS: number;
  BACKFILL_MAX_ROWS_PER_DAY: number;
}

export interface UsageToday {
  calls: number;
  adjust_rows: number;
  personal_rows: number;
  backfill_rows: number;
}

export interface StoredClose {
  date: string;
  close: number;
}

export interface CloseComparison {
  passed: boolean;
  csvClose: number | null;
  differencePct: number | null;
  storedDate: string | null;
  storedClose: number | null;
}

export interface ActionSymbol {
  isin: string;
  ticker: string;
}

export interface SelectOptions {
  from: string;
  basisDate: string;
  afterDate: string | null;
}

export interface SqlFile {
  sql: string;
  estimatedRows: number;
}

export interface CapDifference {
  name: keyof Caps;
  deployed: number;
  configured: number;
}

export interface D1Output {
  rows: Record<string, unknown>[];
  rowsWritten: number;
}

export class StopForTheDay extends Error {}

export type SymbolAttempt<T> = { ok: true; value: T } | { ok: false };

export const DEFAULT_YEARS = 5;
export const MAX_YEARS = 30;
export const MAX_FILE_ROWS = 5000;
export const ACTION_ROWS_WRITTEN = 4;
export const NOTICE_ROWS_WRITTEN = 3;
export const VALIDATION_TOLERANCE_PCT = 0.5;
export const MAX_ACTION_PAGES = 50;
export const ACTIONS_URL = "https://www.mubasher.info/api/1/corporate-actions?country=eg";
export const BAR_SOURCE = "mubasher_csv";
export const ACTION_SOURCE = "mubasher";

const FIRST_PAGE = 1;
const USAGE_UPSERT_ROWS = 1;
const DONE_UPDATE_ROWS = 1;
const ROWS_PER_INSERT = 200;
const PERCENT = 100;
const ISIN_PATTERN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;
const TICKER_PATTERN = /^[A-Za-z0-9]{1,12}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const HISTORICAL_URL_PATTERN = /historical-data-url\s*=\s*["']([^"']+)["']/;
const CSV_HOST = "static.mubasher.info";
const PRICE_KINDS: ReadonlyArray<string> = ["bonus", "split", "reverse_split"];
const ACTION_KINDS: ReadonlyArray<string> = [
  "cash_dividend",
  "bonus",
  "split",
  "reverse_split",
  "rights",
  "name_change",
  "other",
];
const CAP_NAMES: ReadonlyArray<keyof Caps> = [
  "GLOBAL_DAILY_CALLS",
  "ADJUST_MAX_ROWS_PER_DAY",
  "PERSONAL_DAILY_ROWS",
  "BACKFILL_MAX_ROWS_PER_DAY",
];

export const USAGE_TEXT = [
  "Usage: node scripts/backfill/backfill.ts <mode> [--years N] [--during-session]",
  "",
  "Modes:",
  "  --validate        compare each active symbol's newest stored close with the Mubasher CSV",
  "                    (run first; writes scripts/backfill/out/validation.json)",
  "  --actions         load corporate actions for the last N years (run before loading prices)",
  "  --years N         load prices for the symbols that passed validation (N defaults to 5)",
  "",
  "Importing a file locks the database, so loading prices or actions refuses to run during the EGX session",
  "(Sunday to Thursday, 10:00 to 14:30 Cairo time). Pass --during-session to run anyway.",
  "",
  "Prices and actions write to the remote D1 database through wrangler, within the daily row allowance.",
  "Re-run the same command on later days until it reports that everything is loaded.",
].join("\n");

export function parseArgs(argv: string[]): ParsedArgs {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) return { kind: "usage" };
  let years = DEFAULT_YEARS;
  let validate = false;
  let actions = false;
  let duringSession = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] as string;
    if (argument === "--validate") validate = true;
    else if (argument === "--actions") actions = true;
    else if (argument === "--during-session") duringSession = true;
    else if (argument === "--years") {
      const parsed = parseYears(argv[index + 1]);
      if (parsed === null) return { kind: "error", message: `--years needs a whole number from 1 to ${MAX_YEARS}` };
      years = parsed;
      index += 1;
    } else return { kind: "error", message: `Unknown argument ${argument}` };
  }
  if (validate && actions) return { kind: "error", message: "--validate and --actions cannot be combined" };
  return { kind: "run", mode: validate ? "validate" : actions ? "actions" : "load", years, duringSession };
}

function parseYears(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value)) return null;
  const years = Number(value);
  return years >= 1 && years <= MAX_YEARS ? years : null;
}

export function isIsin(value: string): boolean {
  return ISIN_PATTERN.test(value);
}

export function isTicker(value: string): boolean {
  return TICKER_PATTERN.test(value);
}

export function isIsoDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

function requireIsin(value: string): string {
  if (!isIsin(value)) throw new Error(`Invalid ISIN: ${value}`);
  return value;
}

function requireTicker(value: string): string {
  if (!isTicker(value)) throw new Error(`Invalid ticker: ${value}`);
  return value;
}

function requireDate(value: string): string {
  if (!isIsoDate(value)) throw new Error(`Invalid date: ${value}`);
  return value;
}

function requireWholeNumber(value: number): number {
  if (!Number.isInteger(value) || value < 0) throw new Error(`Invalid row count: ${value}`);
  return value;
}

function sqlNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`Invalid number: ${value}`);
  return String(value);
}

function sqlText(value: string): string {
  if (value.includes("\0")) throw new Error("Text holds a NUL character");
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlNullableText(value: string | null): string {
  return value === null ? "NULL" : sqlText(value);
}

export function sessionRefusal(mode: Mode, duringSession: boolean, unixSeconds: number): string | null {
  if (mode === "validate" || duringSession) return null;
  if (sessionStatus(unixSeconds, null) !== "open") return null;
  return "The EGX session is open (Sunday to Thursday, 10:00 to 14:30 Cairo time) and importing a file locks the database. Run this after 14:30, or pass --during-session to run it anyway.";
}

export function yearsBefore(day: string, years: number): string {
  const date = new Date(`${requireDate(day)}T00:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() - years);
  return date.toISOString().slice(0, 10);
}

export function extractHistoricalDataUrl(html: string): string | null {
  const url = HISTORICAL_URL_PATTERN.exec(html)?.[1];
  if (url === undefined) return null;
  try {
    const parsed = new URL(url, "https://www.mubasher.info");
    return parsed.protocol === "https:" && parsed.hostname === CSV_HOST ? parsed.href : null;
  } catch {
    return null;
  }
}

function clampBar(bar: RawCsvBar): RawCsvBar {
  return {
    ...bar,
    high: Math.max(bar.high, bar.open, bar.close),
    low: Math.min(bar.low, bar.open, bar.close),
  };
}

export function parseBars(csv: string): RawCsvBar[] {
  const byDate = new Map<string, RawCsvBar>();
  for (const line of csv.split(/\r?\n/)) {
    const bar = parseMubasherCsvLine(line);
    if (bar !== null) byDate.set(bar.date, clampBar(bar));
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export function compareClose(bars: RawCsvBar[], stored: StoredClose[]): CloseComparison {
  const closeByDate = new Map(bars.map((bar) => [bar.date, bar.close] as const));
  const common = stored
    .filter((entry) => closeByDate.has(entry.date))
    .sort((left, right) => right.date.localeCompare(left.date))[0];
  if (common === undefined) return { passed: false, csvClose: null, differencePct: null, storedDate: null, storedClose: null };
  const csvClose = closeByDate.get(common.date) as number;
  const compared = { csvClose, storedDate: common.date, storedClose: common.close };
  if (!(csvClose > 0)) return { passed: false, differencePct: null, ...compared };
  const differencePct = (Math.abs(csvClose - common.close) / csvClose) * PERCENT;
  return { passed: differencePct <= VALIDATION_TOLERANCE_PCT, differencePct, ...compared };
}

export type SymbolCheck =
  | { outcome: "passed"; csvUrl: string }
  | { outcome: "missingUrl" }
  | {
      outcome: "failed";
      csvClose: number | null;
      differencePct: number | null;
      storedDate: string | null;
      storedClose: number | null;
      error: string | null;
    };

export async function checkSymbol(
  pageUrl: string,
  stored: StoredClose[],
  fetchText: (url: string) => Promise<string>,
): Promise<SymbolCheck> {
  let csvUrl: string | null;
  try {
    csvUrl = extractHistoricalDataUrl(await fetchText(pageUrl));
  } catch {
    return { outcome: "missingUrl" };
  }
  if (csvUrl === null) return { outcome: "missingUrl" };
  try {
    const comparison = compareClose(parseBars(await fetchText(csvUrl)), stored);
    if (comparison.passed) return { outcome: "passed", csvUrl };
    return {
      outcome: "failed",
      csvClose: comparison.csvClose,
      differencePct: comparison.differencePct,
      storedDate: comparison.storedDate,
      storedClose: comparison.storedClose,
      error: null,
    };
  } catch (error) {
    return {
      outcome: "failed",
      csvClose: null,
      differencePct: null,
      storedDate: null,
      storedClose: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function attemptSymbol<T>(
  symbol: { ticker: string },
  work: () => Promise<T>,
  report: (message: string) => void,
): Promise<SymbolAttempt<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    if (error instanceof StopForTheDay) throw error;
    report(`${symbol.ticker}: ${error instanceof Error ? error.message : String(error)}`);
    return { ok: false };
  }
}

export function recentClosesQuery(windowDays: number): string {
  return `SELECT s.isin AS isin, b.session_date AS session_date, b.close AS close FROM symbols s JOIN daily_bars b ON b.isin = s.isin AND b.session_date >= date((SELECT MAX(session_date) FROM daily_bars WHERE isin = s.isin), '-${requireWholeNumber(windowDays)} days') WHERE s.status = 'active'`;
}

export function loadingRefusal(entries: Array<{ isin: string; state: string }>): string | null {
  const loading = entries.filter((entry) => entry.state === "loading").map((entry) => entry.isin);
  if (loading.length === 0) return null;
  return `Validation would replace the list the load reads while ${loading.length} symbols are still loading (${loading.join(", ")}). Finish the load first: re-run the load command until it reports that everything is loaded.`;
}

export function selectBars(bars: RawCsvBar[], options: SelectOptions): RawCsvBar[] {
  return bars.filter(
    (bar) =>
      bar.date >= options.from &&
      bar.date <= options.basisDate &&
      (options.afterDate === null || bar.date > options.afterDate),
  );
}

export function loadingStatement(isin: string, basisDate: string, firstTradeDate: string): string {
  return `UPDATE symbols SET adj_basis_date = '${requireDate(basisDate)}', backfill_state = 'loading', first_trade_date = '${requireDate(firstTradeDate)}' WHERE isin = '${requireIsin(isin)}'`;
}

export function doneStatement(isin: string): string {
  return `UPDATE symbols SET backfill_state = 'done' WHERE isin = '${requireIsin(isin)}'`;
}

export function appliedActionsQuery(isin: string): string {
  return `SELECT kind, ratio, ex_date FROM corporate_actions WHERE isin = '${requireIsin(isin)}' AND status = 'applied' AND kind IN ('bonus', 'split', 'reverse_split')`;
}

export function usageUpsertStatement(day: string, rows: number): string {
  return `INSERT INTO usage_global (day, backfill_rows) VALUES ('${requireDate(day)}', ${requireWholeNumber(rows)}) ON CONFLICT(day) DO UPDATE SET backfill_rows = backfill_rows + excluded.backfill_rows`;
}

export function parseAppliedActions(rows: Record<string, unknown>[]): AppliedAction[] {
  return rows.map((row) => {
    const kind = row.kind;
    const ratio = row.ratio;
    const exDate = row.ex_date;
    if (typeof kind !== "string" || !PRICE_KINDS.includes(kind)) throw new Error(`Unexpected applied action kind: ${String(kind)}`);
    if (typeof ratio !== "number" || !(ratio > 0)) throw new Error(`Applied ${kind} has no valid ratio`);
    if (typeof exDate !== "string" || !isIsoDate(exDate)) throw new Error(`Applied ${kind} has no valid ex date`);
    return { kind: kind as AppliedAction["kind"], ratio, exDate, status: "applied" };
  });
}

export function estimateBarFileRows(barCount: number, isLast: boolean): number {
  return barCount + USAGE_UPSERT_ROWS + (isLast ? DONE_UPDATE_ROWS : 0);
}

function barValues(isin: string, row: BackfillRow): string {
  const numbers = [
    row.open,
    row.high,
    row.low,
    row.close,
    row.volume,
    row.adjOpen,
    row.adjHigh,
    row.adjLow,
    row.adjClose,
    row.adjFactor,
  ].map(sqlNumber);
  return `('${isin}', '${requireDate(row.date)}', ${numbers.join(", ")}, 1, ${sqlText(BAR_SOURCE)})`;
}

const BAR_INSERT_HEAD =
  "INSERT INTO daily_bars (isin, session_date, open, high, low, close, volume, adj_open, adj_high, adj_low, adj_close, adj_factor, raw_derived, source) VALUES";
const BAR_INSERT_TAIL = "ON CONFLICT(isin, session_date) DO NOTHING;";

export function buildBarFile(isin: string, rows: BackfillRow[], isLast: boolean): SqlFile {
  requireIsin(isin);
  if (rows.length > MAX_FILE_ROWS) throw new Error(`A file holds at most ${MAX_FILE_ROWS} rows`);
  const statements: string[] = [];
  for (let start = 0; start < rows.length; start += ROWS_PER_INSERT) {
    const values = rows.slice(start, start + ROWS_PER_INSERT).map((row) => barValues(isin, row));
    statements.push(`${BAR_INSERT_HEAD}\n${values.join(",\n")}\n${BAR_INSERT_TAIL}`);
  }
  if (isLast) statements.push(`${doneStatement(isin)};`);
  return { sql: `${statements.join("\n")}\n`, estimatedRows: estimateBarFileRows(rows.length, isLast) };
}

function requireActionKind(kind: string): string {
  if (!ACTION_KINDS.includes(kind)) throw new Error(`Invalid action kind: ${kind}`);
  return kind;
}

function actionStatements(isin: string, action: ProviderAction, now: number): SqlFile {
  const kind = requireActionKind(action.kind);
  const exDate = requireDate(action.exDate);
  const announcedOn = action.announcedOn === null ? null : requireDate(action.announcedOn);
  const ticker = requireTicker(action.ticker);
  const insert = `INSERT INTO corporate_actions (isin, kind, announced_on, ex_date, status, source, source_text, created_at, updated_at) VALUES ('${isin}', '${kind}', ${sqlNullableText(announcedOn)}, '${exDate}', ${PRICE_KINDS.includes(kind) ? "'needs_ratio'" : "'recorded'"}, ${sqlText(ACTION_SOURCE)}, ${sqlText(action.sourceText)}, ${sqlNumber(now)}, ${sqlNumber(now)}) ON CONFLICT(isin, kind, ex_date) DO NOTHING;`;
  if (!PRICE_KINDS.includes(kind)) return { sql: insert, estimatedRows: ACTION_ROWS_WRITTEN };
  const subject = `${ticker.toUpperCase()} ${kind} ${exDate}`;
  const dedupeKey = `needs_ratio|${subject}|${utcDay(now)}`;
  const notice = `INSERT INTO notices (kind, subject, details, created_at, status, dedupe_key) SELECT 'needs_ratio', ${sqlText(subject)}, json_object('actionId', id, 'ticker', ${sqlText(ticker.toUpperCase())}, 'kind', kind, 'exDate', ex_date, 'source', source), ${sqlNumber(now)}, 'open', ${sqlText(dedupeKey)} FROM corporate_actions WHERE isin = '${isin}' AND kind = '${kind}' AND ex_date = '${exDate}' AND status = 'needs_ratio' AND created_at = ${sqlNumber(now)} ON CONFLICT(dedupe_key) DO NOTHING;`;
  return { sql: `${insert}\n${notice}`, estimatedRows: ACTION_ROWS_WRITTEN + NOTICE_ROWS_WRITTEN };
}

export function buildActionStatements(isin: string, actions: ProviderAction[], now: number): SqlFile {
  requireIsin(isin);
  const parts = actions.map((action) => actionStatements(isin, action, now));
  return {
    sql: parts.map((part) => part.sql).join("\n"),
    estimatedRows: parts.reduce((total, part) => total + part.estimatedRows, 0),
  };
}

export async function fetchSymbolActions(
  symbol: ActionSymbol,
  from: string,
  fetchText: (url: string) => Promise<string>,
  pause: () => Promise<void>,
): Promise<ProviderAction[]> {
  const actions = new Map<string, ProviderAction>();
  let pageCount = FIRST_PAGE;
  for (let page = FIRST_PAGE; page <= pageCount; page += 1) {
    const body = JSON.parse(await fetchText(`${ACTIONS_URL}&symbol=${symbol.ticker}&page=${page}`)) as Record<string, unknown>;
    pageCount = typeof body.numberOfPages === "number" ? body.numberOfPages : FIRST_PAGE;
    if (pageCount > MAX_ACTION_PAGES) {
      throw new Error(`${symbol.ticker}: the source lists ${pageCount} action pages, more than the ${MAX_ACTION_PAGES} that are read`);
    }
    const rows = Array.isArray(body.rows) ? (body.rows as Row[]) : [];
    for (const row of rows) {
      const action = parseMubasherActionRow(row);
      if (action === null || action.ticker.toUpperCase() !== symbol.ticker.toUpperCase() || action.exDate < from) continue;
      actions.set(`${action.kind}|${action.exDate}`, action);
    }
    await pause();
  }
  return [...actions.values()];
}

export function parseD1Output(stdout: string): D1Output {
  const start = stdout.indexOf("[");
  if (start === -1) throw new Error("wrangler printed no JSON");
  const results = JSON.parse(stdout.slice(start)) as Array<{
    results?: Record<string, unknown>[];
    success?: boolean;
    meta?: { rows_written?: number };
  }>;
  if (results.some((result) => result.success === false)) throw new Error("wrangler reported a failed statement");
  return {
    rows: results[0]?.results ?? [],
    rowsWritten: results.reduce((total, result) => total + (result.meta?.rows_written ?? 0), 0),
  };
}

export function parseDeploymentVersionIds(status: { versions?: Array<{ version_id?: string; percentage?: number }> }): string[] {
  const ids = (status.versions ?? []).flatMap((version) => (version.version_id === undefined ? [] : [version.version_id]));
  if (ids.length === 0) throw new Error("The deployment lists no versions");
  return ids;
}

export function parseVersionCaps(version: {
  resources?: { bindings?: Array<{ type?: string; name?: string; text?: string }> };
}): Caps {
  const bindings = version.resources?.bindings ?? [];
  const caps = {} as Caps;
  for (const name of CAP_NAMES) {
    const text = bindings.find((binding) => binding.type === "plain_text" && binding.name === name)?.text;
    if (text === undefined) throw new Error(`The deployed version has no ${name} variable`);
    const value = Number(text);
    if (text.trim() === "" || !Number.isFinite(value)) throw new Error(`${name} is not a number: ${text}`);
    caps[name] = value;
  }
  return caps;
}

export function mergeCaps(versions: Caps[]): Caps {
  const pick = (name: keyof Caps, choose: (...values: number[]) => number) => choose(...versions.map((caps) => caps[name]));
  return {
    GLOBAL_DAILY_CALLS: pick("GLOBAL_DAILY_CALLS", Math.max),
    ADJUST_MAX_ROWS_PER_DAY: pick("ADJUST_MAX_ROWS_PER_DAY", Math.max),
    PERSONAL_DAILY_ROWS: pick("PERSONAL_DAILY_ROWS", Math.max),
    BACKFILL_MAX_ROWS_PER_DAY: pick("BACKFILL_MAX_ROWS_PER_DAY", Math.min),
  };
}

export function readConfiguredCaps(configText: string): Caps {
  const caps = {} as Caps;
  for (const name of CAP_NAMES) {
    const match = new RegExp(`"${name}"\\s*:\\s*"([^"]*)"`).exec(configText);
    if (match === null) throw new Error(`wrangler.jsonc has no ${name} variable`);
    caps[name] = Number(match[1]);
  }
  return caps;
}

export function capDifferences(deployed: Caps, configured: Caps): CapDifference[] {
  return CAP_NAMES.filter((name) => deployed[name] !== configured[name]).map((name) => ({
    name,
    deployed: deployed[name],
    configured: configured[name],
  }));
}

export function computeAllowance(usage: UsageToday, caps: Caps): number {
  return backfillAllowance({
    configured: caps.BACKFILL_MAX_ROWS_PER_DAY,
    globalDailyCalls: caps.GLOBAL_DAILY_CALLS,
    rowsPerCall: ACCOUNTING_ROWS_PER_CALL,
    callsToday: usage.calls,
    adjustCap: caps.ADJUST_MAX_ROWS_PER_DAY,
    adjustRowsToday: usage.adjust_rows,
    personalCap: caps.PERSONAL_DAILY_ROWS,
    personalRowsToday: usage.personal_rows,
    backfillRowsToday: usage.backfill_rows,
  });
}
