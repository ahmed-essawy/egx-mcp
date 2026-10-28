import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AuthProps } from "../../auth/api-keys";
import { periodReturn, shiftMonths } from "../../domain/returns";
import {
  compareRange,
  earliestDate,
  getHistoryPage,
  pendingForIsins,
  type HistoryBar,
  type PendingAction,
  type RangeSummary,
} from "../../store/d1/bars";
import { getDirectory, type DirectorySymbol } from "../../store/kv";
import { defineTool, type ToolContext } from "../define-tool";
import { fail, ok, type Meta } from "../envelope";
import { envelopeSchema } from "../output-schema";
import { MAX_SYMBOL_INPUT_LENGTH, resolveSymbol } from "../resolve";
import { roundPercent, roundPrice } from "../rounding";
import { loadMarketClock, sessionMeta, type MarketClock } from "../session";
import {
  ADJUSTED_FIELD,
  DIRECTORY_MISSING_MESSAGE,
  NEEDS_RATIO_REASON,
  QUEUED_REASON,
  resolveEach,
  unresolvedSymbol,
} from "../shared";

const PAGE_SIZE = 500;
const MAX_RANGE_YEARS = 5;
const MIN_COMPARE_SYMBOLS = 2;
const MAX_COMPARE_SYMBOLS = 5;
const MAX_CURSOR_LENGTH = 64;
const PERCENT_FACTOR = 100;
const MONTHS_PER_YEAR = 12;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EX_DATE_CAUSE = "until the ex-date session is stored";
const BACKFILL_CAUSE = "until the backfill of this symbol finishes";
const CAP_CAUSE = "daily adjustment limit reached; a later end-of-day run applies it";
const NO_BARS_REASON = "no bars stored in the requested range";
const NO_BARS_MESSAGE = "No bars are stored for these symbols over a common period within the requested range.";
const RANGE_ORDER_MESSAGE = "from must not be after to.";
const RANGE_LENGTH_MESSAGE = `The range must not exceed ${MAX_RANGE_YEARS} years.`;
const CURSOR_MESSAGE = "cursor is not valid.";

const dateSchema = z.iso.date();
const symbolInputSchema = z.string().min(1).max(MAX_SYMBOL_INPUT_LENGTH);

const historyInputSchema = z.object({
  symbol: symbolInputSchema,
  from: dateSchema,
  to: dateSchema,
  series: z.enum(["raw", "adjusted", "both"]).default("both"),
  cursor: z.string().min(1).max(MAX_CURSOR_LENGTH).optional(),
});

const compareInputSchema = z.object({
  symbols: z.array(symbolInputSchema).min(MIN_COMPARE_SYMBOLS).max(MAX_COMPARE_SYMBOLS),
  from: dateSchema,
  to: dateSchema,
});

const pendingItemSchema = z.object({
  actionId: z.number(),
  kind: z.string(),
  exDate: z.string(),
  announcedOn: z.string().nullable(),
  source: z.string(),
  state: z.enum(["needs_ratio", "queued"]),
  reason: z.string(),
});

const barSchema = z.object({
  date: z.string(),
  open: z.number().optional(),
  high: z.number().optional(),
  low: z.number().optional(),
  close: z.number().optional(),
  volume: z.number(),
  adjOpen: z.number().optional(),
  adjHigh: z.number().optional(),
  adjLow: z.number().optional(),
  adjClose: z.number().optional(),
  rawDerived: z.boolean(),
  adjustmentPending: z.boolean(),
  rawPending: z.boolean(),
  source: z.string(),
});

const historyOutputSchema = envelopeSchema(
  z.object({
    isin: z.string(),
    earliestAvailable: z.string().nullable(),
    pendingAdjustments: z.array(pendingItemSchema),
    bars: z.array(barSchema),
    nextCursor: z.string().nullable(),
  }),
);

const compareItemSchema = z.object({
  isin: z.string(),
  ticker: z.string(),
  returnPct: z.number(),
  high: z.number(),
  low: z.number(),
  totalVolume: z.number(),
  firstDate: z.string(),
  lastDate: z.string(),
  adjustmentPending: z.boolean(),
  pendingAdjustments: z.array(pendingItemSchema),
});

const compareOutputSchema = envelopeSchema(
  z.object({
    items: z.array(compareItemSchema),
    commonFrom: z.string(),
    commonTo: z.string(),
  }),
);

type Series = z.infer<typeof historyInputSchema>["series"];
type PendingItem = z.infer<typeof pendingItemSchema>;
type Bar = z.infer<typeof barSchema>;
type Range = { from: string; to: string };
type Notice = { field: string; reason: string };

function rangeProblem({ from, to }: Range): string | null {
  if (from > to) return RANGE_ORDER_MESSAGE;
  return shiftMonths(from, MAX_RANGE_YEARS * MONTHS_PER_YEAR) < to ? RANGE_LENGTH_MESSAGE : null;
}

function encodeCursor(date: string): string {
  return btoa(date).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeCursor(cursor: string): string | null {
  try {
    const date = atob(cursor.replaceAll("-", "+").replaceAll("_", "/"));
    return ISO_DATE_PATTERN.test(date) ? date : null;
  } catch {
    return null;
  }
}

function queuedCause(action: PendingAction): string {
  if (action.latestSession === null || action.exDate > action.latestSession) return EX_DATE_CAUSE;
  return action.backfillState === "loading" ? BACKFILL_CAUSE : CAP_CAUSE;
}

function reasonOf(action: PendingAction): string {
  return action.status === "needs_ratio" ? NEEDS_RATIO_REASON : `${QUEUED_REASON}: ${queuedCause(action)}`;
}

function pendingItemOf(action: PendingAction): PendingItem {
  return {
    actionId: action.actionId,
    kind: action.kind,
    exDate: action.exDate,
    announcedOn: action.announcedOn,
    source: action.source,
    state: action.status === "needs_ratio" ? "needs_ratio" : "queued",
    reason: reasonOf(action),
  };
}

function adjustedNotAvailable(actions: PendingAction[]): Notice[] {
  const first = actions[0];
  return first ? [{ field: ADJUSTED_FIELD, reason: reasonOf(first) }] : [];
}

function isInSeriesBasis(bar: HistoryBar, action: PendingAction): boolean {
  return bar.rawDerived && action.basisDate !== null && action.exDate <= action.basisDate;
}

function labelsOf(bar: HistoryBar, actions: PendingAction[]): Pick<Bar, "adjustmentPending" | "rawPending"> {
  const before = actions.filter((action) => bar.sessionDate < action.exDate);
  return {
    rawPending: before.some((action) => isInSeriesBasis(bar, action)),
    adjustmentPending: before.some((action) => !isInSeriesBasis(bar, action)),
  };
}

function rawPricesOf(bar: HistoryBar): Pick<Bar, "open" | "high" | "low" | "close"> {
  return {
    open: roundPrice(bar.open),
    high: roundPrice(bar.high),
    low: roundPrice(bar.low),
    close: roundPrice(bar.close),
  };
}

function adjustedPricesOf(bar: HistoryBar): Pick<Bar, "adjOpen" | "adjHigh" | "adjLow" | "adjClose"> {
  return {
    adjOpen: roundPrice(bar.adjOpen),
    adjHigh: roundPrice(bar.adjHigh),
    adjLow: roundPrice(bar.adjLow),
    adjClose: roundPrice(bar.adjClose),
  };
}

function pricesOf(bar: HistoryBar, series: Series): Partial<Bar> {
  return {
    ...(series === "adjusted" ? {} : rawPricesOf(bar)),
    ...(series === "raw" ? {} : adjustedPricesOf(bar)),
  };
}

function barOf(bar: HistoryBar, series: Series, actions: PendingAction[]): Bar {
  return {
    date: bar.sessionDate,
    ...pricesOf(bar, series),
    volume: bar.volume,
    rawDerived: bar.rawDerived,
    ...labelsOf(bar, actions),
    source: bar.source,
  };
}

function metaOf(clock: MarketClock, source: string | null, notAvailable: Notice[]): Meta {
  return {
    label: "end_of_day",
    dataTime: null,
    source,
    stale: false,
    staleReason: null,
    session: sessionMeta(clock, null),
    notAvailable,
  };
}

async function priceHistory(
  { symbol, from, to, series, cursor }: z.infer<typeof historyInputSchema>,
  ctx: ToolContext,
): Promise<CallToolResult> {
  const problem = rangeProblem({ from, to });
  if (problem) return fail("invalid_input", problem);
  const afterDate = cursor === undefined ? null : decodeCursor(cursor);
  if (cursor !== undefined && afterDate === null) return fail("invalid_input", CURSOR_MESSAGE);
  const [directory, clock] = await Promise.all([getDirectory(ctx.env), loadMarketClock(ctx.env.DB, ctx.now, ctx.rows)]);
  if (directory === null) return fail("not_available", DIRECTORY_MISSING_MESSAGE);
  const resolution = resolveSymbol(directory, symbol);
  if (!resolution.ok) return unresolvedSymbol(symbol, resolution);
  const isin = resolution.entry[0];
  const [fetched, earliestAvailable, pending] = await Promise.all([
    getHistoryPage(ctx.env.DB, isin, from, to, afterDate, PAGE_SIZE + 1),
    earliestDate(ctx.env.DB, isin),
    pendingForIsins(ctx.env.DB, [isin], clock.today, from),
  ]);
  ctx.rows.add({ rows_read: fetched.rowsRead + earliestAvailable.rowsRead + pending.rowsRead });
  const actions = pending.value;
  const page = fetched.value.slice(0, PAGE_SIZE);
  const last = page[page.length - 1];
  const hasMore = fetched.value.length > PAGE_SIZE && last !== undefined;
  return ok(
    {
      isin,
      earliestAvailable: earliestAvailable.value,
      pendingAdjustments: actions.map(pendingItemOf),
      bars: page.map((bar) => barOf(bar, series, actions)),
      nextCursor: hasMore ? encodeCursor(last.sessionDate) : null,
    },
    metaOf(clock, last?.source ?? null, adjustedNotAvailable(actions.filter((action) => action.adjAffected))),
  );
}

function uniqueIsins(entries: DirectorySymbol[]): string[] {
  return [...new Set(entries.map((entry) => entry[0]))];
}

function compareItemOf(entry: DirectorySymbol, summary: RangeSummary, actions: PendingAction[]) {
  const affecting = actions.filter((action) => action.isin === summary.isin && action.adjAffected);
  return {
    isin: summary.isin,
    ticker: entry[1],
    returnPct: roundPercent(periodReturn(summary.firstClose, summary.lastClose) * PERCENT_FACTOR) ?? 0,
    high: roundPrice(summary.high),
    low: roundPrice(summary.low),
    totalVolume: summary.volume,
    firstDate: summary.firstDate,
    lastDate: summary.lastDate,
    adjustmentPending: affecting.length > 0,
    pendingAdjustments: affecting.map(pendingItemOf),
  };
}

async function compareSymbols(
  { symbols, from, to }: z.infer<typeof compareInputSchema>,
  ctx: ToolContext,
): Promise<CallToolResult> {
  const problem = rangeProblem({ from, to });
  if (problem) return fail("invalid_input", problem);
  const [directory, clock] = await Promise.all([getDirectory(ctx.env), loadMarketClock(ctx.env.DB, ctx.now, ctx.rows)]);
  if (directory === null) return fail("not_available", DIRECTORY_MISSING_MESSAGE);
  const resolved = resolveEach(directory, symbols);
  if ("failure" in resolved) return resolved.failure;
  const isins = uniqueIsins(resolved.entries);
  const [range, pending] = await Promise.all([
    compareRange(ctx.env.DB, isins, from, to),
    pendingForIsins(ctx.env.DB, isins, clock.today, from),
  ]);
  ctx.rows.add({ rows_read: range.rowsRead + pending.rowsRead });
  const summaries = range.value;
  const actions = pending.value;
  const summaryByIsin = new Map(summaries.map((summary) => [summary.isin, summary]));
  const entryByIsin = new Map(resolved.entries.map((entry) => [entry[0], entry]));
  const covered = isins.flatMap((isin) => {
    const entry = entryByIsin.get(isin);
    const summary = summaryByIsin.get(isin);
    return entry && summary ? [{ entry, summary }] : [];
  });
  if (covered.length === 0) return fail("not_available", NO_BARS_MESSAGE);
  const items = covered.map(({ entry, summary }) => compareItemOf(entry, summary, actions));
  const missing = isins.filter((isin) => !summaryByIsin.has(isin));
  const notAvailable: Notice[] = [
    ...missing.map((isin) => ({ field: entryByIsin.get(isin)?.[1] ?? isin, reason: NO_BARS_REASON })),
    ...adjustedNotAvailable(actions.filter((action) => action.adjAffected)),
  ];
  return ok(
    {
      items,
      commonFrom: items.map((item) => item.firstDate).reduce((latest, date) => (date > latest ? date : latest)),
      commonTo: items.map((item) => item.lastDate).reduce((earliest, date) => (date < earliest ? date : earliest)),
    },
    metaOf(clock, null, notAvailable),
  );
}

export function registerHistoryTools(server: McpServer, env: Env, auth: AuthProps): void {
  defineTool(
    server,
    {
      name: "get_price_history",
      description:
        "Get end-of-day price history (raw, adjusted or both) for one Egyptian stock over a range of at most 5 years, 500 bars per page.",
      inputSchema: historyInputSchema,
      outputSchema: historyOutputSchema,
      readOnly: true,
      handler: priceHistory,
    },
    env,
    auth,
  );
  defineTool(
    server,
    {
      name: "compare_symbols",
      description:
        "Compare 2 to 5 Egyptian stocks over a range of at most 5 years: return, high, low and total volume from adjusted end-of-day prices.",
      inputSchema: compareInputSchema,
      outputSchema: compareOutputSchema,
      readOnly: true,
      handler: compareSymbols,
    },
    env,
    auth,
  );
}
