import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AuthProps } from "../../auth/api-keys";
import { toCairoIso } from "../../domain/calendar";
import { isQuoteStale } from "../../domain/freshness";
import {
  getDirectory,
  getSnapshot,
  type Directory,
  type DirectorySymbol,
  type QuoteEntry,
  type Snapshot,
} from "../../store/kv";
import { defineTool } from "../define-tool";
import { fail, ok, type Meta } from "../envelope";
import { envelopeSchema } from "../output-schema";
import { MAX_SYMBOL_INPUT_LENGTH, resolveSymbol } from "../resolve";
import { loadMarketClock, sessionMeta, type MarketClock } from "../session";
import { DIRECTORY_MISSING_MESSAGE, identityOf, identitySchema, newestDataTime } from "../shared";

const MIN_SYMBOLS = 1;
const MAX_SYMBOLS = 20;
const SNAPSHOT_FIELD = "snapshot";
const SNAPSHOT_MISSING_REASON = "snapshot not built yet";

const inputSchema = z.object({
  symbols: z.array(z.string().min(1).max(MAX_SYMBOL_INPUT_LENGTH)).min(MIN_SYMBOLS).max(MAX_SYMBOLS),
});

const quotedSchema = identitySchema.extend({
  status: z.enum(["pending", "active", "inactive"]),
  price: z.number(),
  open: z.number().nullable(),
  high: z.number().nullable(),
  low: z.number().nullable(),
  prevClose: z.number().nullable(),
  change: z.number().nullable(),
  changePct: z.number().nullable(),
  volume: z.number(),
  value: z.number().nullable(),
  tradeDate: z.string(),
  dataTime: z.string(),
  source: z.string(),
  stale: z.boolean(),
});

const noDataSchema = identitySchema.extend({ status: z.literal("no_data_yet") });

const notFoundSchema = z.object({
  input: z.string(),
  status: z.literal("not_found"),
  suggestions: z.array(identitySchema),
});

const ambiguousSchema = z.object({
  input: z.string(),
  status: z.literal("ambiguous"),
  candidates: z.array(identitySchema),
});

const outputSchema = envelopeSchema(
  z.object({
    quotes: z.array(z.union([quotedSchema, noDataSchema, notFoundSchema, ambiguousSchema])),
  }),
);

type QuoteItem = z.infer<typeof outputSchema>["data"]["quotes"][number];
type Served = { item: QuoteItem; quote: QuoteEntry | null };

function quotedItem(entry: DirectorySymbol, quote: QuoteEntry, stale: boolean): QuoteItem {
  return {
    ...identityOf(entry),
    status: entry[5],
    price: quote.p,
    open: quote.o,
    high: quote.h,
    low: quote.l,
    prevClose: quote.pc,
    change: quote.ch,
    changePct: quote.chp,
    volume: quote.v,
    value: quote.val,
    tradeDate: quote.td,
    dataTime: toCairoIso(quote.tt),
    source: quote.src,
    stale,
  };
}

function serveEntry(entry: DirectorySymbol, snapshot: Snapshot | null, clock: MarketClock): Served {
  const quote = snapshot?.quotes[entry[0]] ?? null;
  if (quote === null) return { item: { ...identityOf(entry), status: "no_data_yet" }, quote };
  const stale = isQuoteStale(quote.td, clock.sessionDate, clock.holidays);
  return { item: quotedItem(entry, quote, stale), quote };
}

function serveInput(input: string, directory: Directory, snapshot: Snapshot | null, clock: MarketClock): Served {
  const resolution = resolveSymbol(directory, input);
  if (resolution.ok) return serveEntry(resolution.entry, snapshot, clock);
  const candidates = resolution.candidates.map(identityOf);
  const item: QuoteItem =
    resolution.code === "ambiguous"
      ? { input, status: "ambiguous", candidates }
      : { input, status: "not_found", suggestions: candidates };
  return { item, quote: null };
}

function staleReasonOf(quotes: QuoteEntry[], clock: MarketClock): string | null {
  const staleDates = quotes
    .filter((quote) => isQuoteStale(quote.td, clock.sessionDate, clock.holidays))
    .map((quote) => quote.td);
  if (staleDates.length === 0) return null;
  return `Data dated ${staleDates.sort()[0]} is older than the last completed session.`;
}

function metaFor(quotes: QuoteEntry[], snapshot: Snapshot | null, clock: MarketClock): Meta {
  const staleReason = staleReasonOf(quotes, clock);
  return {
    label: "delayed",
    dataTime: newestDataTime(quotes.map((quote) => quote.tt)),
    source: snapshot?.sources.stocks ?? null,
    stale: staleReason !== null,
    staleReason,
    session: sessionMeta(clock, snapshot),
    notAvailable: snapshot ? [] : [{ field: SNAPSHOT_FIELD, reason: SNAPSHOT_MISSING_REASON }],
  };
}

export function registerQuoteTools(server: McpServer, env: Env, auth: AuthProps): void {
  defineTool(
    server,
    {
      name: "get_quotes",
      description: "Get delayed quotes for up to 20 Egyptian stocks by ticker, ISIN, or Arabic or English name.",
      inputSchema,
      outputSchema,
      readOnly: true,
      handler: async ({ symbols }, ctx) => {
        const [directory, snapshot, clock] = await Promise.all([
          getDirectory(ctx.env),
          getSnapshot(ctx.env),
          loadMarketClock(ctx.env.DB, ctx.now, ctx.rows),
        ]);
        if (directory === null) return fail("not_available", DIRECTORY_MISSING_MESSAGE);
        const served = symbols.map((input) => serveInput(input, directory, snapshot, clock));
        const quotes = served.flatMap(({ quote }) => (quote ? [quote] : []));
        return ok({ quotes: served.map(({ item }) => item) }, metaFor(quotes, snapshot, clock));
      },
    },
    env,
    auth,
  );
}
