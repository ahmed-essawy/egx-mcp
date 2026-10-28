import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AuthProps } from "../../auth/api-keys";
import { isQuoteStale } from "../../domain/freshness";
import {
  downsample,
  highestReturn,
  lastRows,
  nullMetrics,
  summarize,
  type Close,
  type DatedClose,
} from "../../domain/index-analytics";
import { INDEX_NAMES, resolveIndexCode, type IndexCode } from "../../domain/indices";
import { shiftDays } from "../../domain/returns";
import { readIndexSeries, type IndexSeriesRow } from "../../store/d1/closes";
import { defineTool, type ToolContext } from "../define-tool";
import { fail, ok, type Meta } from "../envelope";
import { envelopeSchema } from "../output-schema";
import { closeProvenance, computedProvenance, groupBySource } from "../provenance";
import { roundIndex, roundPercent } from "../rounding";
import { loadMarketClock, sessionMeta, type MarketClock } from "../session";

const MAX_DAYS = 1825;
const DEFAULT_DAYS = 365;
const MAX_ROWS = 500;
const MAX_INDEX_INPUT_LENGTH = 40;
const MAX_SUMMARY_INDICES = 5;
const MIN_SUMMARY_READ_DAYS = 100;
const DEFAULT_SUMMARY_INDEX = "EGX30";
const NO_ROWS_REASON = "no stored closes for this index in the requested window";
const NO_CLOSES_REASON = "no stored closes for this index";
const NOT_ENOUGH_CLOSES_REASON = "not enough stored closes";
const POINTS_FIELD = "points";
const SUMMARIES_FIELD = "summaries";

const historyInputSchema = z.object({
  index: z.string().min(1).max(MAX_INDEX_INPUT_LENGTH),
  days: z.number().int().min(1).max(MAX_DAYS).default(DEFAULT_DAYS),
  interval: z.enum(["daily", "weekly", "monthly"]).default("daily"),
  maxRows: z.number().int().min(1).max(MAX_ROWS).default(MAX_ROWS),
});

const historyOutputSchema = envelopeSchema(
  z.object({
    code: z.string(),
    name: z.string(),
    interval: z.enum(["daily", "weekly", "monthly"]),
    from: z.string(),
    to: z.string(),
    earliestAvailable: z.string().nullable(),
    truncated: z.boolean(),
    points: z.array(z.object({ date: z.string(), close: z.number(), source: z.string() })),
  }),
);

const summaryInputSchema = z.object({
  indices: z
    .array(z.string().min(1).max(MAX_INDEX_INPUT_LENGTH))
    .min(1)
    .max(MAX_SUMMARY_INDICES)
    .default([DEFAULT_SUMMARY_INDEX]),
  days: z.number().int().min(1).max(MAX_DAYS).default(DEFAULT_DAYS),
});

const datedCloseSchema = z.object({ date: z.string(), close: z.number() });

const okSummarySchema = z.object({
  code: z.string(),
  name: z.string(),
  status: z.literal("ok"),
  latest: datedCloseSchema,
  previousClose: z.number().nullable(),
  dailyChange: z.number().nullable(),
  dailyChangePct: z.number().nullable(),
  periodFrom: z.string(),
  periodHigh: datedCloseSchema.nullable(),
  periodLow: datedCloseSchema.nullable(),
  periodReturnPct: z.number().nullable(),
  sma20: z.number().nullable(),
  sma50: z.number().nullable(),
  annualizedVolatilityPct: z.number().nullable(),
  drawdownFromHighPct: z.number().nullable(),
  return5SessionsPct: z.number().nullable(),
  observations: z.number(),
  sources: z.array(z.string()),
  stale: z.boolean(),
});

const summaryOutputSchema = envelopeSchema(
  z.object({
    summaries: z.array(
      z.discriminatedUnion("status", [
        okSummarySchema,
        z.object({ input: z.string(), status: z.literal("not_found") }),
        z.object({ code: z.string(), status: z.literal("not_available"), reason: z.string() }),
      ]),
    ),
    highestReturn: z.object({ code: z.string(), periodReturnPct: z.number() }).nullable(),
  }),
);

type OkSummary = z.infer<typeof okSummarySchema>;
type SummaryItem = z.infer<typeof summaryOutputSchema>["data"]["summaries"][number];
type SummaryRequest = { input: string; code: IndexCode | undefined };
type SummaryEntry = { item: SummaryItem; rows: Close[] };

function toClose(row: IndexSeriesRow): Close {
  return { date: row.date, close: row.close, source: row.source };
}

function seriesStale(date: string, clock: MarketClock): boolean {
  return isQuoteStale(date, clock.sessionDate, clock.holidays);
}

function staleReason(date: string): string {
  return `Latest close ${date} is older than the last completed session.`;
}

function metaOf(clock: MarketClock, points: Close[]): Meta {
  const last = points[points.length - 1];
  const stale = last !== undefined && seriesStale(last.date, clock);
  return {
    label: "end_of_day",
    dataTime: last?.date ?? null,
    source: last?.source ?? null,
    stale,
    staleReason: stale ? staleReason(last.date) : null,
    session: sessionMeta(clock, null),
    notAvailable: points.length === 0 ? [{ field: POINTS_FIELD, reason: NO_ROWS_REASON }] : [],
    provenance: closeProvenance([POINTS_FIELD], points, stale),
  };
}

async function indexHistory(
  { index, days, interval, maxRows }: z.infer<typeof historyInputSchema>,
  ctx: ToolContext,
): Promise<CallToolResult> {
  const code = resolveIndexCode(index);
  if (code === undefined) return fail("not_found", `Unknown index: ${index}.`);
  const clock = await loadMarketClock(ctx.env.DB, ctx.now, ctx.rows);
  const from = shiftDays(clock.today, -days);
  const series = await readIndexSeries(ctx.env.DB, [code], from, clock.today);
  ctx.rows.add({ rows_read: series.rowsRead });
  const { rows, truncated } = lastRows(downsample(series.rows.map(toClose), interval), maxRows);
  return ok(
    {
      code,
      name: INDEX_NAMES[code],
      interval,
      from,
      to: clock.today,
      earliestAvailable: series.earliest.get(code) ?? null,
      truncated,
      points: rows.map((row) => ({ date: row.date, close: roundIndex(row.close), source: row.source })),
    },
    metaOf(clock, rows),
  );
}

function resolveRequests(inputs: string[]): SummaryRequest[] {
  const seen = new Set<IndexCode>();
  return inputs.flatMap((input) => {
    const code = resolveIndexCode(input);
    if (code !== undefined && seen.has(code)) return [];
    if (code !== undefined) seen.add(code);
    return [{ input, code }];
  });
}

function closesByCodeOf(rows: IndexSeriesRow[]): Map<string, Close[]> {
  return new Map(
    [...groupBySource(rows, (row) => row.code)].map(([code, group]) => [code, group.map(toClose)]),
  );
}

function roundedClose(value: DatedClose | null): DatedClose | null {
  return value === null ? null : { date: value.date, close: roundIndex(value.close) };
}

function okSummary(code: IndexCode, series: Close[], periodFrom: string, clock: MarketClock): OkSummary {
  const metrics = summarize(series, periodFrom);
  return {
    code,
    name: INDEX_NAMES[code],
    status: "ok",
    latest: { date: metrics.latest.date, close: roundIndex(metrics.latest.close) },
    previousClose: metrics.previousClose === null ? null : roundIndex(metrics.previousClose),
    dailyChange: metrics.dailyChange === null ? null : roundIndex(metrics.dailyChange),
    dailyChangePct: roundPercent(metrics.dailyChangePct),
    periodFrom,
    periodHigh: roundedClose(metrics.periodHigh),
    periodLow: roundedClose(metrics.periodLow),
    periodReturnPct: roundPercent(metrics.periodReturnPct),
    sma20: metrics.sma20 === null ? null : roundIndex(metrics.sma20),
    sma50: metrics.sma50 === null ? null : roundIndex(metrics.sma50),
    annualizedVolatilityPct: roundPercent(metrics.annualizedVolatilityPct),
    drawdownFromHighPct: roundPercent(metrics.drawdownFromHighPct),
    return5SessionsPct: roundPercent(metrics.return5SessionsPct),
    observations: metrics.observations,
    sources: [...groupBySource(series, (close) => close.source).keys()],
    stale: seriesStale(metrics.latest.date, clock),
  };
}

function summaryEntry(
  request: SummaryRequest,
  closesByCode: Map<string, Close[]>,
  periodFrom: string,
  clock: MarketClock,
): SummaryEntry {
  if (request.code === undefined) return { item: { input: request.input, status: "not_found" }, rows: [] };
  const series = closesByCode.get(request.code) ?? [];
  if (series.length === 0) {
    return { item: { code: request.code, status: "not_available", reason: NO_CLOSES_REASON }, rows: [] };
  }
  return { item: okSummary(request.code, series, periodFrom, clock), rows: series };
}

function isOk(entry: SummaryEntry): entry is { item: OkSummary; rows: Close[] } {
  return entry.item.status === "ok";
}

function missingMetrics(item: OkSummary): Meta["notAvailable"] {
  return nullMetrics(item).map((metric) => ({
    field: `${item.code}.${metric}`,
    reason: NOT_ENOUGH_CLOSES_REASON,
  }));
}

function summaryMeta(clock: MarketClock, available: { item: OkSummary; rows: Close[] }[]): Meta {
  const stale = available.some(({ item }) => item.stale);
  const firstStale = available.find(({ item }) => item.stale);
  const sourceRows = groupBySource(
    available.flatMap(({ rows }) => rows),
    (row) => row.source,
  );
  const provenance = [...sourceRows].map(([source, rows]) =>
    computedProvenance(
      [SUMMARIES_FIELD],
      source,
      rows.reduce((latest, row) => (row.date > latest ? row.date : latest), ""),
      "close",
      stale,
    ),
  );
  return {
    label: "end_of_day",
    dataTime: available.reduce<string | null>(
      (latest, { item }) => (latest === null || item.latest.date > latest ? item.latest.date : latest),
      null,
    ),
    source: provenance[0]?.source ?? null,
    stale,
    staleReason: firstStale ? staleReason(firstStale.item.latest.date) : null,
    session: sessionMeta(clock, null),
    notAvailable: available.flatMap(({ item }) => missingMetrics(item)),
    provenance,
  };
}

async function indexSummary(
  { indices, days }: z.infer<typeof summaryInputSchema>,
  ctx: ToolContext,
): Promise<CallToolResult> {
  const clock = await loadMarketClock(ctx.env.DB, ctx.now, ctx.rows);
  const requests = resolveRequests(indices);
  const codes = requests.flatMap((request) => (request.code === undefined ? [] : [request.code]));
  const periodFrom = shiftDays(clock.today, -days);
  let closesByCode = new Map<string, Close[]>();
  if (codes.length > 0) {
    const readFrom = shiftDays(clock.today, -Math.max(days, MIN_SUMMARY_READ_DAYS));
    const series = await readIndexSeries(ctx.env.DB, codes, readFrom, clock.today);
    ctx.rows.add({ rows_read: series.rowsRead });
    closesByCode = closesByCodeOf(series.rows);
  }
  const entries = requests.map((request) => summaryEntry(request, closesByCode, periodFrom, clock));
  const available = entries.filter(isOk);
  return ok(
    {
      summaries: entries.map((entry) => entry.item),
      highestReturn: highestReturn(available.map(({ item }) => item)),
    },
    summaryMeta(clock, available),
  );
}

export function registerIndexHistoryTools(server: McpServer, env: Env, auth: AuthProps): void {
  defineTool(
    server,
    {
      name: "get_index_history",
      description:
        "Get stored end-of-day closes of one EGX index (EGX30, EGX30CAPPED, EGX70EWI, EGX100EWI, EGX30USD) for up to 5 years, daily, weekly or monthly, at most 500 points.",
      inputSchema: historyInputSchema,
      outputSchema: historyOutputSchema,
      readOnly: true,
      handler: indexHistory,
    },
    env,
    auth,
  );
  defineTool(
    server,
    {
      name: "get_index_summary",
      description:
        "Summarize up to 5 EGX indices from stored end-of-day closes: latest close, daily change, period high, low and return, 20 and 50 session averages, annualized volatility, drawdown from the period high and 5 session return, with the index of highest period return.",
      inputSchema: summaryInputSchema,
      outputSchema: summaryOutputSchema,
      readOnly: true,
      handler: indexSummary,
    },
    env,
    auth,
  );
}
