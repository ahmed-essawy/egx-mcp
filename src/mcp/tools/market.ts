import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AuthProps } from "../../auth/api-keys";
import { cairoParts, toCairoIso } from "../../domain/calendar";
import { INDEX_CODES, INDEX_NAMES, resolveIndexCode, type IndexCode } from "../../domain/indices";
import { median } from "../../domain/returns";
import { sessionQuotes, type SessionQuote } from "../../domain/session-quotes";
import {
  getDirectory,
  getLastSessionSnapshot,
  getSnapshot,
  getStats,
  type Directory,
  type DirectorySymbol,
  type IndexEntry,
  type PendingAdjustment,
  type QuoteEntry,
  type Snapshot,
  type Stats,
  type SymbolStats,
} from "../../store/kv";
import { defineTool } from "../define-tool";
import { fail, ok, type Meta, type Provenance } from "../envelope";
import { envelopeSchema } from "../output-schema";
import {
  STORED_BARS_SOURCE,
  closeProvenance,
  computedProvenance,
  indexProvenance,
  groupBySource,
  primaryStockSource,
  quoteProvenance,
} from "../provenance";
import { MAX_SYMBOL_INPUT_LENGTH } from "../resolve";
import { roundIndex, roundPercent, roundPrice, roundTurnover } from "../rounding";
import { loadMarketClock, sessionMeta, type MarketClock } from "../session";
import {
  ADJUSTED_FIELD,
  DIRECTORY_MISSING_MESSAGE,
  NEEDS_RATIO_REASON,
  QUEUED_REASON,
  identityOf,
  identitySchema,
  newestDataTime,
  resolveEach,
  staleReasonOf,
} from "../shared";

const DEFAULT_TOP = 5;
const MIN_TOP = 1;
const MAX_TOP = 10;
const MAX_INDEX_NAMES = 10;
const MAX_INDEX_NAME_LENGTH = 40;
const SUMMARY_TOP = 5;
const CLOSED_STATUS = "closed";
const SNAPSHOT_MISSING_MESSAGE = "The market snapshot is not built yet.";
const LAST_SESSION_MISSING_MESSAGE = "No completed session snapshot is stored yet.";
const NOT_AVAILABLE_REASON = "not available from current sources";
const INVESTOR_STATS_FIELD = "investorStats";
const INDICES_FIELDS = ["indices"];
const OVERVIEW_MOVER_FIELDS = ["breadth", "totals", "topGainers", "topLosers", "mostActiveByVolume", "mostActiveByValue"];
const SUMMARY_MOVER_FIELDS = ["breadth", "totals", "topGainers", "topLosers"];

const moverSchema = identitySchema.extend({
  price: z.number(),
  changePct: z.number().nullable(),
  volume: z.number(),
  value: z.number().nullable(),
});

const indexItemSchema = z.object({
  code: z.string(),
  name: z.string(),
  value: z.number(),
  changePct: z.number().nullable(),
  dataTime: z.string(),
  source: z.string(),
});

const indexUnavailableSchema = z.object({
  code: z.string(),
  status: z.literal("not_available"),
  reason: z.string(),
});

const indexNotFoundSchema = z.object({
  input: z.string(),
  status: z.literal("not_found"),
});

const breadthSchema = z.object({ advancers: z.number(), decliners: z.number(), unchanged: z.number() });
const totalsSchema = z.object({ volume: z.number(), value: z.number() });

const overviewInputSchema = z.object({
  top: z.number().int().min(MIN_TOP).max(MAX_TOP).default(DEFAULT_TOP),
});

const indicesInputSchema = z.object({
  names: z.array(z.string().min(1).max(MAX_INDEX_NAME_LENGTH)).max(MAX_INDEX_NAMES).default([]),
});

const summaryInputSchema = z.object({});

const sessionSummarySchema = z.object({
  indices: z.array(indexItemSchema),
  breadth: breadthSchema,
  topGainers: z.array(moverSchema),
  topLosers: z.array(moverSchema),
  totals: totalsSchema,
});

const overviewOutputSchema = envelopeSchema(
  sessionSummarySchema.extend({
    status: z.string(),
    mostActiveByVolume: z.array(moverSchema),
    mostActiveByValue: z.array(moverSchema),
    investorStats: z.null(),
  }),
);

const indicesOutputSchema = envelopeSchema(
  z.object({ indices: z.array(z.union([indexItemSchema, indexUnavailableSchema, indexNotFoundSchema])) }),
);

const summaryOutputSchema = envelopeSchema(sessionSummarySchema);

type Mover = z.infer<typeof moverSchema>;
type SessionSummary = z.infer<typeof sessionSummarySchema>;
type IndexItem = z.infer<typeof indexItemSchema>;
type IndexUnavailable = z.infer<typeof indexUnavailableSchema>;
type IndexNotFound = z.infer<typeof indexNotFoundSchema>;
type SymbolsByIsin = ReadonlyMap<string, DirectorySymbol>;
type RequestedIndex = { input: string; code: IndexCode | undefined };

function symbolsByIsin(directory: Directory): SymbolsByIsin {
  return new Map(directory.symbols.map((entry) => [entry[0], entry]));
}

function moverFrom(isin: string, quote: QuoteEntry, symbols: SymbolsByIsin): Mover {
  const entry = symbols.get(isin);
  const identity = entry ? identityOf(entry) : { isin, ticker: quote.t, nameEn: null, nameAr: null };
  return {
    ...identity,
    price: roundPrice(quote.p),
    changePct: roundPercent(quote.chp),
    volume: quote.v,
    value: roundTurnover(quote.val),
  };
}

function moverOf(isin: string, snapshot: Snapshot, symbols: SymbolsByIsin): Mover[] {
  const quote = snapshot.quotes[isin];
  return quote ? [moverFrom(isin, quote, symbols)] : [];
}

function moversOf(isins: string[], limit: number, snapshot: Snapshot, symbols: SymbolsByIsin): Mover[] {
  return isins.slice(0, limit).flatMap((isin) => moverOf(isin, snapshot, symbols));
}

function sessionSummary(snapshot: Snapshot, top: number, symbols: SymbolsByIsin): SessionSummary {
  return {
    indices: availableIndices(snapshot),
    breadth: snapshot.breadth,
    topGainers: moversOf(snapshot.top.gainers, top, snapshot, symbols),
    topLosers: moversOf(snapshot.top.losers, top, snapshot, symbols),
    totals: { volume: snapshot.totals.volume, value: roundTurnover(snapshot.totals.value) },
  };
}

function indexItemOf(code: IndexCode, entry: IndexEntry): IndexItem {
  return {
    code,
    name: INDEX_NAMES[code],
    value: roundIndex(entry.v),
    changePct: roundPercent(entry.chp),
    dataTime: toCairoIso(entry.tt),
    source: entry.src,
  };
}

function lookupIndex(code: IndexCode, snapshot: Snapshot): IndexItem | IndexUnavailable {
  const entry = snapshot.indices[code];
  if (!entry) return { code, status: "not_available", reason: NOT_AVAILABLE_REASON };
  return indexItemOf(code, entry);
}

function availableIndexEntries(snapshot: Snapshot): [IndexCode, IndexEntry][] {
  return INDEX_CODES.flatMap((code): [IndexCode, IndexEntry][] => {
    const entry = snapshot.indices[code];
    return entry ? [[code, entry]] : [];
  });
}

function availableIndices(snapshot: Snapshot): IndexItem[] {
  return availableIndexEntries(snapshot).map(([code, entry]) => indexItemOf(code, entry));
}

function requestedIndices(names: string[]): RequestedIndex[] {
  if (names.length === 0) return INDEX_CODES.map((code) => ({ input: code, code }));
  return names.map((input) => ({ input, code: resolveIndexCode(input) }));
}

function serveRequested({ input, code }: RequestedIndex, snapshot: Snapshot): IndexItem | IndexUnavailable | IndexNotFound {
  if (code === undefined) return { input, status: "not_found" };
  return lookupIndex(code, snapshot);
}

function requestedEntries(requested: RequestedIndex[], snapshot: Snapshot): IndexEntry[] {
  return requested.flatMap(({ code }) => {
    const entry = code === undefined ? undefined : snapshot.indices[code];
    return entry ? [entry] : [];
  });
}

function snapshotTimestamps(snapshot: Snapshot): number[] {
  return [...Object.values(snapshot.quotes), ...Object.values(snapshot.indices)].map((entry) => entry.tt);
}

function snapshotDataTime(snapshot: Snapshot): string | null {
  return newestDataTime(snapshotTimestamps(snapshot));
}

function marketMeta(
  label: Meta["label"],
  snapshot: Snapshot,
  session: Meta["session"],
  notAvailable: Meta["notAvailable"],
  provenance: Provenance[],
): Meta {
  return {
    label,
    dataTime: snapshotDataTime(snapshot),
    source: snapshot.sources.stocks,
    stale: false,
    staleReason: null,
    session,
    notAvailable,
    provenance,
  };
}

function overviewProvenance(snapshot: Snapshot): Provenance[] {
  const entries = availableIndexEntries(snapshot).map(([, entry]) => entry);
  return [
    ...indexProvenance(INDICES_FIELDS, entries),
    computedProvenance(OVERVIEW_MOVER_FIELDS, snapshot.sources.stocks, snapshotDataTime(snapshot), "trade", false),
  ];
}

function summaryProvenance(snapshot: Snapshot): Provenance[] {
  const date = snapshot.session.date;
  const rows = availableIndexEntries(snapshot).map(([, entry]) => ({ date: cairoParts(entry.tt).date, source: entry.src }));
  const indices = [...groupBySource(rows, (row) => row.source).values()].flatMap((group) =>
    closeProvenance(INDICES_FIELDS, group, group.some((row) => row.date !== date)),
  );
  return [
    ...indices,
    computedProvenance(SUMMARY_MOVER_FIELDS, snapshot.sources.stocks, date, "close", false),
  ];
}

function indicesMeta(entries: IndexEntry[], session: Meta["session"]): Meta {
  return {
    label: "delayed",
    dataTime: newestDataTime(entries.map((entry) => entry.tt)),
    source: entries[0]?.src ?? null,
    stale: false,
    staleReason: null,
    session,
    notAvailable: [],
    provenance: indexProvenance(INDICES_FIELDS, entries),
  };
}

function registerOverview(server: McpServer, env: Env, auth: AuthProps): void {
  defineTool(
    server,
    {
      name: "get_market_overview",
      description: "Get the delayed EGX market overview: indices, breadth, top movers, most active stocks and totals.",
      inputSchema: overviewInputSchema,
      outputSchema: overviewOutputSchema,
      readOnly: true,
      handler: async ({ top }, ctx) => {
        const [directory, snapshot, clock] = await Promise.all([
          getDirectory(ctx.env),
          getSnapshot(ctx.env),
          loadMarketClock(ctx.env.DB, ctx.now, ctx.rows),
        ]);
        if (directory === null) return fail("not_available", DIRECTORY_MISSING_MESSAGE, { source: snapshot?.sources.stocks });
        if (snapshot === null) return fail("not_available", SNAPSHOT_MISSING_MESSAGE);
        const symbols = symbolsByIsin(directory);
        const session = sessionMeta(clock, snapshot);
        return ok(
          {
            status: session.status,
            ...sessionSummary(snapshot, top, symbols),
            mostActiveByVolume: moversOf(snapshot.top.byVolume, top, snapshot, symbols),
            mostActiveByValue: moversOf(snapshot.top.byValue, top, snapshot, symbols),
            investorStats: null,
          },
          marketMeta("delayed", snapshot, session, [{ field: INVESTOR_STATS_FIELD, reason: NOT_AVAILABLE_REASON }], overviewProvenance(snapshot)),
        );
      },
    },
    env,
    auth,
  );
}

function registerIndices(server: McpServer, env: Env, auth: AuthProps): void {
  defineTool(
    server,
    {
      name: "get_indices",
      description: "Get delayed EGX index values by name or code. An empty list returns every known index.",
      inputSchema: indicesInputSchema,
      outputSchema: indicesOutputSchema,
      readOnly: true,
      handler: async ({ names }, ctx) => {
        const [snapshot, clock] = await Promise.all([
          getSnapshot(ctx.env),
          loadMarketClock(ctx.env.DB, ctx.now, ctx.rows),
        ]);
        if (snapshot === null) return fail("not_available", SNAPSHOT_MISSING_MESSAGE);
        const requested = requestedIndices(names);
        return ok(
          { indices: requested.map((index) => serveRequested(index, snapshot)) },
          indicesMeta(requestedEntries(requested, snapshot), sessionMeta(clock, snapshot)),
        );
      },
    },
    env,
    auth,
  );
}

function registerDailySummary(server: McpServer, env: Env, auth: AuthProps): void {
  defineTool(
    server,
    {
      name: "get_daily_summary",
      description: "Get the summary of the last completed session: indices, breadth, top movers and totals.",
      inputSchema: summaryInputSchema,
      outputSchema: summaryOutputSchema,
      readOnly: true,
      handler: async (_args, ctx) => {
        const [directory, snapshot] = await Promise.all([getDirectory(ctx.env), getLastSessionSnapshot(ctx.env)]);
        if (directory === null) return fail("not_available", DIRECTORY_MISSING_MESSAGE, { source: snapshot?.sources.stocks });
        if (snapshot === null) return fail("not_available", LAST_SESSION_MISSING_MESSAGE);
        const symbols = symbolsByIsin(directory);
        return ok(
          sessionSummary(snapshot, SUMMARY_TOP, symbols),
          marketMeta("end_of_day", snapshot, { date: snapshot.session.date, status: CLOSED_STATUS }, [], summaryProvenance(snapshot)),
        );
      },
    },
    env,
    auth,
  );
}

const DEFAULT_MOVERS_LIMIT = 10;
const MAX_MOVERS_LIMIT = 20;
const MIN_RANGE_SYMBOLS = 1;
const MAX_RANGE_SYMBOLS = 20;
const UNUSUAL_VOLUME_FACTOR = 2;
const PERCENT_FACTOR = 100;
const STATS_MISSING_MESSAGE = "The 52-week statistics are not available: stats not built yet.";
const MOVERS_FIELDS = ["items"];
const SECTORS_FIELDS = ["sectors"];
const SNAPSHOT_MOVER_KINDS = ["gainers", "losers", "volume", "value"] as const;
const STATS_MOVER_KINDS = ["unusual_volume", "near_52w_high", "near_52w_low"] as const;
const SECTOR_PERIODS = ["1d", "1w", "1m", "3m", "ytd", "1y"] as const;

const PENDING_REASONS: Readonly<Record<PendingAdjustment["state"], string>> = {
  needs_ratio: NEEDS_RATIO_REASON,
  queued: QUEUED_REASON,
};

const SNAPSHOT_METRICS: Readonly<
  Record<(typeof SNAPSHOT_MOVER_KINDS)[number], { metric: (quote: QuoteEntry) => number | null; sign: 1 | -1 }>
> = {
  gainers: { metric: (quote) => quote.chp, sign: -1 },
  losers: { metric: (quote) => quote.chp, sign: 1 },
  volume: { metric: (quote) => quote.v, sign: -1 },
  value: { metric: (quote) => quote.val, sign: -1 },
};

const moversInputSchema = z.object({
  kind: z.enum([...SNAPSHOT_MOVER_KINDS, ...STATS_MOVER_KINDS]),
  limit: z.number().int().min(MIN_TOP).max(MAX_MOVERS_LIMIT).default(DEFAULT_MOVERS_LIMIT),
});

const moversItemSchema = moverSchema.extend({
  avgVol20: z.number().optional(),
  h52: z.number().optional(),
  l52: z.number().optional(),
  distancePct: z.number().optional(),
  adjustmentPending: z.boolean().optional(),
});

const moversOutputSchema = envelopeSchema(z.object({ items: z.array(moversItemSchema) }));

const rangeInputSchema = z.object({
  symbols: z.array(z.string().min(1).max(MAX_SYMBOL_INPUT_LENGTH)).min(MIN_RANGE_SYMBOLS).max(MAX_RANGE_SYMBOLS),
});

const rangeItemSchema = identitySchema.extend({
  price: z.number(),
  h52: z.number(),
  h52Date: z.string(),
  l52: z.number(),
  l52Date: z.string(),
  fromHighPct: z.number(),
  fromLowPct: z.number(),
  adjustmentPending: z.boolean(),
});

const rangeNoDataSchema = identitySchema.extend({ status: z.literal("no_data_yet") });

const rangeOutputSchema = envelopeSchema(z.object({ items: z.array(z.union([rangeItemSchema, rangeNoDataSchema])) }));

const sectorInputSchema = z.object({ period: z.enum(SECTOR_PERIODS) });

const sectorItemSchema = z.object({
  sector: z.string(),
  medianReturnPct: z.number(),
  advancers: z.number(),
  decliners: z.number(),
  symbols: z.number(),
  adjustmentPending: z.boolean(),
});

const sectorOutputSchema = envelopeSchema(z.object({ sectors: z.array(sectorItemSchema) }));

type MoverItem = z.infer<typeof moversItemSchema>;
type RangeResult = z.infer<typeof rangeOutputSchema>["data"]["items"][number];
type SectorItem = z.infer<typeof sectorItemSchema>;
type SnapshotMoverKind = (typeof SNAPSHOT_MOVER_KINDS)[number];
type StatsMoverKind = (typeof STATS_MOVER_KINDS)[number];
type SectorPeriod = (typeof SECTOR_PERIODS)[number];
type StatsSymbol = SessionQuote & { stats: SymbolStats };
type Ranked<T> = { item: T; rank: number };
type SectorMember = { returnPct: number; pending: PendingAdjustment | undefined };
type ServedRange = { result: RangeResult; quote: QuoteEntry | null; pending: PendingAdjustment | undefined };

function isSnapshotKind(kind: string): kind is SnapshotMoverKind {
  return (SNAPSHOT_MOVER_KINDS as readonly string[]).includes(kind);
}

function pendingEntryOf(stats: SymbolStats, today: string): PendingAdjustment | undefined {
  return stats.pendingAdj.find((entry) => entry.adjAffected && entry.exDate <= today);
}

function adjustedNotAvailable(entries: (PendingAdjustment | undefined)[]): Meta["notAvailable"] {
  const first = entries.find((entry) => entry !== undefined);
  return first ? [{ field: ADJUSTED_FIELD, reason: PENDING_REASONS[first.state] }] : [];
}

function percentFrom(price: number, reference: number): number {
  return ((price - reference) / reference) * PERCENT_FACTOR;
}

function compareText(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

function topRanked<T extends SessionQuote>(candidates: Ranked<T>[], limit: number): T[] {
  return candidates
    .sort((a, b) => a.rank - b.rank || compareText(a.item.isin, b.item.isin))
    .slice(0, limit)
    .map(({ item }) => item);
}

function rankedBy<T extends SessionQuote>(symbols: T[], rankOf: (symbol: T) => number | null, limit: number): T[] {
  const candidates = symbols.flatMap((item): Ranked<T>[] => {
    const rank = rankOf(item);
    return rank === null ? [] : [{ item, rank }];
  });
  return topRanked(candidates, limit);
}

function snapshotKindMovers(kind: SnapshotMoverKind, snapshot: Snapshot, limit: number): SessionQuote[] {
  const { metric, sign } = SNAPSHOT_METRICS[kind];
  return rankedBy(
    sessionQuotes(snapshot, snapshot.session.date),
    ({ quote }) => {
      const value = metric(quote);
      return value === null ? null : sign * value;
    },
    limit,
  );
}

function statsSymbols(snapshot: Snapshot, stats: Stats): StatsSymbol[] {
  return sessionQuotes(snapshot, snapshot.session.date).flatMap(({ isin, quote }) => {
    const symbolStats = stats.symbols[isin];
    return symbolStats ? [{ isin, quote, stats: symbolStats }] : [];
  });
}

function highDistance({ quote, stats }: StatsSymbol): number | null {
  return stats.h52 > 0 ? percentFrom(quote.p, stats.h52) : null;
}

function lowDistance({ quote, stats }: StatsSymbol): number | null {
  return stats.l52 > 0 ? percentFrom(quote.p, stats.l52) : null;
}

function absolute(value: number | null): number | null {
  return value === null ? null : Math.abs(value);
}

function unusualVolumeRank({ quote, stats }: StatsSymbol): number | null {
  if (stats.avgVol20 <= 0 || quote.v <= UNUSUAL_VOLUME_FACTOR * stats.avgVol20) return null;
  return -quote.v / stats.avgVol20;
}

function statsKindMovers(kind: StatsMoverKind, symbols: StatsSymbol[], limit: number): StatsSymbol[] {
  switch (kind) {
    case "unusual_volume":
      return rankedBy(symbols, unusualVolumeRank, limit);
    case "near_52w_high":
      return rankedBy(symbols, (symbol) => absolute(highDistance(symbol)), limit);
    case "near_52w_low":
      return rankedBy(symbols, (symbol) => absolute(lowDistance(symbol)), limit);
  }
}

function statsMoverItem(kind: StatsMoverKind, symbol: StatsSymbol, symbols: SymbolsByIsin, today: string): MoverItem {
  const base = moverFrom(symbol.isin, symbol.quote, symbols);
  const adjustmentPending = pendingEntryOf(symbol.stats, today) !== undefined;
  switch (kind) {
    case "unusual_volume":
      return { ...base, avgVol20: Math.round(symbol.stats.avgVol20) };
    case "near_52w_high":
      return {
        ...base,
        h52: roundPrice(symbol.stats.h52),
        distancePct: roundPercent(highDistance(symbol)) ?? 0,
        adjustmentPending,
      };
    case "near_52w_low":
      return {
        ...base,
        l52: roundPrice(symbol.stats.l52),
        distancePct: roundPercent(lowDistance(symbol)) ?? 0,
        adjustmentPending,
      };
  }
}

function moversMeta(
  quotes: QuoteEntry[],
  snapshot: Snapshot,
  clock: MarketClock,
  notAvailable: Meta["notAvailable"],
  provenance: Provenance[],
): Meta {
  const staleReason = staleReasonOf(quotes, clock);
  return {
    label: "delayed",
    dataTime: newestDataTime(quotes.map((quote) => quote.tt)),
    source: snapshot.sources.stocks,
    stale: staleReason !== null,
    staleReason,
    session: sessionMeta(clock, snapshot),
    notAvailable,
    provenance,
  };
}

function storedBarsProvenance(fields: string[], stats: Stats): Provenance {
  return computedProvenance(fields, STORED_BARS_SOURCE, stats.asOf, "close", false);
}

function registerMovers(server: McpServer, env: Env, auth: AuthProps): void {
  defineTool(
    server,
    {
      name: "get_movers",
      description:
        "List delayed EGX movers: gainers, losers, volume, value, unusual volume, or stocks near their 52-week high or low.",
      inputSchema: moversInputSchema,
      outputSchema: moversOutputSchema,
      readOnly: true,
      handler: async ({ kind, limit }, ctx) => {
        const [directory, snapshot, stats, clock] = await Promise.all([
          getDirectory(ctx.env),
          getSnapshot(ctx.env),
          isSnapshotKind(kind) ? Promise.resolve(null) : getStats(ctx.env),
          loadMarketClock(ctx.env.DB, ctx.now, ctx.rows),
        ]);
        if (directory === null) return fail("not_available", DIRECTORY_MISSING_MESSAGE, { source: snapshot?.sources.stocks });
        if (snapshot === null) return fail("not_available", SNAPSHOT_MISSING_MESSAGE);
        const symbols = symbolsByIsin(directory);
        if (isSnapshotKind(kind)) {
          const picked = snapshotKindMovers(kind, snapshot, limit);
          const items = picked.map(({ isin, quote }) => moverFrom(isin, quote, symbols));
          const quotes = picked.map(({ quote }) => quote);
          return ok({ items }, moversMeta(quotes, snapshot, clock, [], quoteProvenance(MOVERS_FIELDS, quotes, primaryStockSource(ctx.cfg), clock)));
        }
        if (stats === null) return fail("not_available", STATS_MISSING_MESSAGE, { source: snapshot.sources.stocks });
        const today = clock.today;
        const picked = statsKindMovers(kind, statsSymbols(snapshot, stats), limit);
        const items = picked.map((symbol) => statsMoverItem(kind, symbol, symbols, today));
        const pending = kind === "unusual_volume" ? [] : picked.map((symbol) => pendingEntryOf(symbol.stats, today));
        const quotes = picked.map(({ quote }) => quote);
        const provenance = [...quoteProvenance(MOVERS_FIELDS, quotes, primaryStockSource(ctx.cfg), clock), storedBarsProvenance(MOVERS_FIELDS, stats)];
        return ok({ items }, moversMeta(quotes, snapshot, clock, adjustedNotAvailable(pending), provenance));
      },
    },
    env,
    auth,
  );
}

function serveRange(entry: DirectorySymbol, snapshot: Snapshot, stats: Stats, today: string): ServedRange {
  const quote = snapshot.quotes[entry[0]];
  const symbolStats = stats.symbols[entry[0]];
  if (!quote || !symbolStats || symbolStats.h52 <= 0 || symbolStats.l52 <= 0) {
    return { result: { ...identityOf(entry), status: "no_data_yet" }, quote: null, pending: undefined };
  }
  const pending = pendingEntryOf(symbolStats, today);
  return {
    result: {
      ...identityOf(entry),
      price: roundPrice(quote.p),
      h52: roundPrice(symbolStats.h52),
      h52Date: symbolStats.h52d,
      l52: roundPrice(symbolStats.l52),
      l52Date: symbolStats.l52d,
      fromHighPct: roundPercent(percentFrom(quote.p, symbolStats.h52)) ?? 0,
      fromLowPct: roundPercent(percentFrom(quote.p, symbolStats.l52)) ?? 0,
      adjustmentPending: pending !== undefined,
    },
    quote,
    pending,
  };
}

function registerRange(server: McpServer, env: Env, auth: AuthProps): void {
  defineTool(
    server,
    {
      name: "get_52_week_range",
      description: "Get the 52-week high and low of up to 20 Egyptian stocks and the distance of the delayed price from each.",
      inputSchema: rangeInputSchema,
      outputSchema: rangeOutputSchema,
      readOnly: true,
      handler: async ({ symbols }, ctx) => {
        const [directory, snapshot, stats, clock] = await Promise.all([
          getDirectory(ctx.env),
          getSnapshot(ctx.env),
          getStats(ctx.env),
          loadMarketClock(ctx.env.DB, ctx.now, ctx.rows),
        ]);
        if (directory === null) return fail("not_available", DIRECTORY_MISSING_MESSAGE, { source: snapshot?.sources.stocks });
        if (snapshot === null) return fail("not_available", SNAPSHOT_MISSING_MESSAGE);
        if (stats === null) return fail("not_available", STATS_MISSING_MESSAGE, { source: snapshot.sources.stocks });
        const today = clock.today;
        const resolved = resolveEach(directory, symbols);
        if ("failure" in resolved) return resolved.failure;
        const served = resolved.entries.map((entry) => serveRange(entry, snapshot, stats, today));
        const quotes = served.flatMap(({ quote }) => (quote ? [quote] : []));
        return ok(
          { items: served.map(({ result }) => result) },
          moversMeta(quotes, snapshot, clock, adjustedNotAvailable(served.map(({ pending }) => pending)), [
            ...quoteProvenance(MOVERS_FIELDS, quotes, primaryStockSource(ctx.cfg), clock),
            storedBarsProvenance(MOVERS_FIELDS, stats),
          ]),
        );
      },
    },
    env,
    auth,
  );
}

function sectorMembers(directory: Directory, stats: Stats, period: SectorPeriod, today: string): Map<string, SectorMember[]> {
  const bySector = new Map<string, SectorMember[]>();
  for (const [isin, , , , sector] of directory.symbols) {
    const symbolStats = stats.symbols[isin];
    const returnPct = symbolStats?.ret[period];
    if (!sector || !symbolStats || returnPct === null || returnPct === undefined) continue;
    const members = bySector.get(sector) ?? [];
    members.push({ returnPct, pending: pendingEntryOf(symbolStats, today) });
    bySector.set(sector, members);
  }
  return bySector;
}

function sectorItemOf(sector: string, members: SectorMember[]): SectorItem {
  return {
    sector,
    medianReturnPct: roundPercent(median(members.map(({ returnPct }) => returnPct))) ?? 0,
    advancers: members.filter(({ returnPct }) => returnPct > 0).length,
    decliners: members.filter(({ returnPct }) => returnPct < 0).length,
    symbols: members.length,
    adjustmentPending: members.some(({ pending }) => pending !== undefined),
  };
}

function sectorMeta(notAvailable: Meta["notAvailable"], provenance: Provenance[]): Meta {
  return {
    label: "end_of_day",
    dataTime: null,
    source: null,
    stale: false,
    staleReason: null,
    session: null,
    notAvailable,
    provenance,
  };
}

function registerSectorPerformance(server: McpServer, env: Env, auth: AuthProps): void {
  defineTool(
    server,
    {
      name: "get_sector_performance",
      description: "Get the median return, advancers and decliners of each EGX sector over a period.",
      inputSchema: sectorInputSchema,
      outputSchema: sectorOutputSchema,
      readOnly: true,
      handler: async ({ period }, ctx) => {
        const [directory, stats] = await Promise.all([getDirectory(ctx.env), getStats(ctx.env)]);
        if (directory === null) return fail("not_available", DIRECTORY_MISSING_MESSAGE);
        if (stats === null) return fail("not_available", STATS_MISSING_MESSAGE);
        const members = sectorMembers(directory, stats, period, cairoParts(ctx.now).date);
        const sectors = [...members].map(([sector, list]) => sectorItemOf(sector, list));
        sectors.sort((a, b) => b.medianReturnPct - a.medianReturnPct || compareText(a.sector, b.sector));
        const pending = [...members.values()].flat().map((member) => member.pending);
        const provenance = sectors.length > 0 ? [storedBarsProvenance(SECTORS_FIELDS, stats)] : [];
        return ok({ sectors }, sectorMeta(adjustedNotAvailable(pending), provenance));
      },
    },
    env,
    auth,
  );
}

export function registerMarketTools(server: McpServer, env: Env, auth: AuthProps): void {
  registerOverview(server, env, auth);
  registerIndices(server, env, auth);
  registerDailySummary(server, env, auth);
  registerMovers(server, env, auth);
  registerRange(server, env, auth);
  registerSectorPerformance(server, env, auth);
}
