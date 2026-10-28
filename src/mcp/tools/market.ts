import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AuthProps } from "../../auth/api-keys";
import { toCairoIso } from "../../domain/calendar";
import { INDEX_CODES, INDEX_NAMES, resolveIndexCode, type IndexCode } from "../../domain/indices";
import {
  getDirectory,
  getLastSessionSnapshot,
  getSnapshot,
  type Directory,
  type DirectorySymbol,
  type IndexEntry,
  type Snapshot,
} from "../../store/kv";
import { defineTool } from "../define-tool";
import { fail, ok, type Meta } from "../envelope";
import { envelopeSchema } from "../output-schema";
import { roundIndex, roundPercent, roundPrice, roundTurnover } from "../rounding";
import { loadMarketClock, sessionMeta } from "../session";
import { DIRECTORY_MISSING_MESSAGE, identityOf, identitySchema, newestDataTime } from "../shared";

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

function moverOf(isin: string, snapshot: Snapshot, symbols: SymbolsByIsin): Mover[] {
  const quote = snapshot.quotes[isin];
  if (!quote) return [];
  const entry = symbols.get(isin);
  const identity = entry ? identityOf(entry) : { isin, ticker: quote.t, nameEn: null, nameAr: null };
  return [
    {
      ...identity,
      price: roundPrice(quote.p),
      changePct: roundPercent(quote.chp),
      volume: quote.v,
      value: roundTurnover(quote.val),
    },
  ];
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

function availableIndices(snapshot: Snapshot): IndexItem[] {
  return INDEX_CODES.flatMap((code) => {
    const entry = snapshot.indices[code];
    return entry ? [indexItemOf(code, entry)] : [];
  });
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

function marketMeta(label: Meta["label"], snapshot: Snapshot, session: Meta["session"], notAvailable: Meta["notAvailable"]): Meta {
  return {
    label,
    dataTime: newestDataTime(snapshotTimestamps(snapshot)),
    source: snapshot.sources.stocks,
    stale: false,
    staleReason: null,
    session,
    notAvailable,
  };
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
        if (directory === null) return fail("not_available", DIRECTORY_MISSING_MESSAGE);
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
          marketMeta("delayed", snapshot, session, [{ field: INVESTOR_STATS_FIELD, reason: NOT_AVAILABLE_REASON }]),
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
        if (directory === null) return fail("not_available", DIRECTORY_MISSING_MESSAGE);
        if (snapshot === null) return fail("not_available", LAST_SESSION_MISSING_MESSAGE);
        const symbols = symbolsByIsin(directory);
        return ok(
          sessionSummary(snapshot, SUMMARY_TOP, symbols),
          marketMeta("end_of_day", snapshot, { date: snapshot.session.date, status: CLOSED_STATUS }, []),
        );
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
}
