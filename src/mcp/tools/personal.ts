import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AuthProps } from "../../auth/api-keys";
import { SECONDS_PER_DAY, toCairoIso } from "../../domain/calendar";
import { evaluateLevels, type CrossedLevel, type PriceLevelRow } from "../../domain/levels";
import { CAPACITY_MESSAGE, capacityRetryAt, checkPersonalWrite } from "../../limits/usage";
import { DEFAULT_EVENTS_LIMIT, listEventsSince, type EventKind, type MarketEvent } from "../../store/d1/events";
import {
  CROSSING_WORST_ROWS,
  INSERT_WORST_ROWS,
  listHoldingsAndLevels,
  MAX_ITEMS_PER_USER,
  removeHolding,
  removeLevel,
  REMOVE_WORST_ROWS,
  saveCrossings,
  UPDATE_WORST_ROWS,
  upsertHolding,
  upsertLevel,
  type Holding,
  type RemoveResult,
  type SaveResult,
} from "../../store/d1/personal";
import { getDirectory, getSnapshot, type Directory, type DirectorySymbol, type QuoteEntry, type Snapshot } from "../../store/kv";
import { defineTool, type ToolContext } from "../define-tool";
import { fail, ok, type Meta, type Provenance } from "../envelope";
import { envelopeSchema } from "../output-schema";
import { computedProvenance, MARKET_EVENTS_SOURCE, primaryStockSource, quoteProvenance } from "../provenance";
import { MAX_SYMBOL_INPUT_LENGTH, resolveSymbol } from "../resolve";
import { roundPercent, roundPrice, roundTurnover } from "../rounding";
import { loadMarketClock, sessionMeta, type MarketClock } from "../session";
import {
  DIRECTORY_MISSING_MESSAGE,
  identityOf,
  newestDataTime,
  SNAPSHOT_FIELD,
  SNAPSHOT_MISSING_REASON,
  staleReasonOf,
} from "../shared";

const MAX_SINCE_AGE_DAYS = 30;
const MILLIS_PER_SECOND = 1000;
const PERCENT = 100;
const UNCLASSIFIED_SECTOR = "Unclassified";
const ACCESS_NOT_FOUND_MESSAGE = "Not found.";
const LIMIT_MESSAGE = `Limit ${MAX_ITEMS_PER_USER} per user`;
const PRICE_FIELD = "price";
const PRICE_MISSING_REASON = "no quote yet for a holding";
const EVENTS_FIELD = "events";
const EVENTS_TRUNCATED_REASON = `only the first ${DEFAULT_EVENTS_LIMIT} events after since are listed`;
const DISCLOSURES_REASON = "not available from current sources";
export const MAX_HOLDING_NUMBER = 1_000_000_000;
const VISIBLE_EVENT_KINDS: readonly EventKind[] = ["new_nav", "big_move", "new_listing", "corporate_action"];
const PROVENANCE_EVENT_KINDS: readonly EventKind[] = ["big_move", "new_listing", "corporate_action"];
const NEW_NAV_KINDS: readonly EventKind[] = ["new_nav"];
const NEW_NAV_FIELDS = ["newNavs"];
const HOLDINGS_FIELDS = ["holdings"];
const PORTFOLIO_COMPUTED_FIELDS = ["totals", "allocationBySector", "levelsCrossed"];
const EVENT_FIELDS = ["bigMoves", "newListings", "corporateActions"];
const CROSSED_FIELDS = ["levelsCrossed"];

const idSchema = z.number().int().positive();

const holdingInputSchema = z.object({
  id: idSchema.optional(),
  symbol: z.string().min(1).max(MAX_SYMBOL_INPUT_LENGTH),
  quantity: z.number().positive().max(MAX_HOLDING_NUMBER),
  costPerShare: z.number().min(0).max(MAX_HOLDING_NUMBER),
  acquiredOn: z.iso.date(),
});

const levelInputSchema = z.object({
  id: idSchema.optional(),
  symbol: z.string().min(1).max(MAX_SYMBOL_INPUT_LENGTH),
  direction: z.enum(["above", "below"]),
  level: z.number().positive(),
});

const removeInputSchema = z.object({ id: idSchema });
const emptyInputSchema = z.object({});
const sinceInputSchema = z.object({ since: z.iso.datetime({ offset: true }) });

const idOutputSchema = envelopeSchema(z.object({ id: z.number() }));
const removedOutputSchema = envelopeSchema(z.object({ removed: z.literal(true) }));

const crossedSchema = z.object({
  id: z.number(),
  isin: z.string(),
  ticker: z.string().nullable(),
  direction: z.enum(["above", "below"]),
  level: z.number(),
  lastCrossedAt: z.string(),
});

const holdingViewSchema = z.object({
  id: z.number(),
  isin: z.string(),
  ticker: z.string().nullable(),
  status: z.enum(["pending", "active", "inactive", "no_data_yet"]),
  quantity: z.number(),
  costPerShare: z.number(),
  acquiredOn: z.string(),
  price: z.number().nullable(),
  value: z.number().nullable(),
  gain: z.number().nullable(),
  gainPct: z.number().nullable(),
  source: z.string().nullable(),
  dataTime: z.string().nullable(),
});

const portfolioOutputSchema = envelopeSchema(
  z.object({
    holdings: z.array(holdingViewSchema),
    totals: z.object({
      cost: z.number(),
      value: z.number(),
      gain: z.number(),
      gainPct: z.number().nullable(),
    }),
    allocationBySector: z.array(z.object({ sector: z.string(), value: z.number(), weightPct: z.number().nullable() })),
    levelsCrossed: z.array(crossedSchema),
  }),
);

const levelsListOutputSchema = envelopeSchema(
  z.object({
    items: z.array(
      z.object({
        id: z.number(),
        isin: z.string(),
        ticker: z.string().nullable(),
        direction: z.enum(["above", "below"]),
        level: z.number(),
        armed: z.boolean(),
        lastCrossedAt: z.string().nullable(),
      }),
    ),
  }),
);

const eventItemSchema = z.object({
  occurredAt: z.string(),
  isin: z.string().nullable(),
  ticker: z.string().nullable(),
  fundId: z.string().nullable(),
  details: z.record(z.string(), z.unknown()),
});

const changesOutputSchema = envelopeSchema(
  z.object({
    newNavs: z.array(eventItemSchema),
    bigMoves: z.array(eventItemSchema),
    levelsCrossed: z.array(crossedSchema),
    newListings: z.array(eventItemSchema),
    corporateActions: z.array(eventItemSchema),
    disclosures: z.object({ status: z.literal("not_available"), reason: z.string() }),
  }),
);

type CrossedItem = z.infer<typeof crossedSchema>;
type HoldingView = z.infer<typeof holdingViewSchema>;
type EventItem = z.infer<typeof eventItemSchema>;
type SymbolIndex = ReadonlyMap<string, DirectorySymbol>;
type Settled = { ok: true; crossed: CrossedLevel[] } | { ok: false; result: CallToolResult };
type Position = { holding: Holding; quote: QuoteEntry | null; cost: number; value: number };
type Resolved = { ok: true; entry: DirectorySymbol } | { ok: false; result: CallToolResult };

function personalMeta(overrides: Partial<Meta> = {}): Meta {
  return {
    label: "personal",
    dataTime: null,
    source: null,
    stale: false,
    staleReason: null,
    session: null,
    notAvailable: [],
    provenance: [],
    ...overrides,
  };
}

function capacityRefusal(now: number): CallToolResult {
  return fail("capacity", CAPACITY_MESSAGE, { retryAt: capacityRetryAt(now) });
}

function indexByIsin(directory: Directory): SymbolIndex {
  return new Map(directory.symbols.map((entry) => [entry[0], entry]));
}

function tickerOf(index: SymbolIndex, isin: string): string | null {
  return index.get(isin)?.[1] ?? null;
}

function resolveInput(directory: Directory, input: string): Resolved {
  const resolution = resolveSymbol(directory, input);
  if (resolution.ok) return { ok: true, entry: resolution.entry };
  const candidates = resolution.candidates.map(identityOf);
  const tickers = candidates.map((candidate) => candidate.ticker).join(", ");
  if (resolution.code === "ambiguous") {
    const message = `No single symbol matches "${input}": ${tickers}.`;
    return { ok: false, result: fail(resolution.code, message, { extra: { candidates } }) };
  }
  const hint = tickers === "" ? "" : ` Did you mean: ${tickers}?`;
  const message = `No symbol matches "${input}".${hint}`;
  return { ok: false, result: fail(resolution.code, message, { extra: { suggestions: candidates } }) };
}

function saveOutcome(result: SaveResult): CallToolResult {
  if (result.status === "saved") return ok({ id: result.id }, personalMeta());
  if (result.status === "limit_reached") return fail("invalid_input", LIMIT_MESSAGE);
  return fail("not_found", ACCESS_NOT_FOUND_MESSAGE);
}

function removeOutcome(result: RemoveResult): CallToolResult {
  if (result.status === "removed") return ok({ removed: true as const }, personalMeta());
  return fail("not_found", ACCESS_NOT_FOUND_MESSAGE);
}

function crossedItem(crossed: CrossedLevel, index: SymbolIndex): CrossedItem {
  return {
    id: crossed.id,
    isin: crossed.isin,
    ticker: tickerOf(index, crossed.isin),
    direction: crossed.direction,
    level: crossed.level,
    lastCrossedAt: toCairoIso(crossed.lastCrossedAt),
  };
}

async function settleLevels(
  ctx: ToolContext,
  levels: readonly PriceLevelRow[],
  snapshot: Snapshot | null,
): Promise<Settled> {
  const prices = new Map(Object.entries(snapshot?.quotes ?? {}).map(([isin, quote]) => [isin, quote.p]));
  const { crossed, changes } = evaluateLevels(levels, prices, ctx.now);
  if (changes.length === 0) return { ok: true, crossed };
  if (!checkPersonalWrite(ctx.usage, ctx.cfg, changes.length * CROSSING_WORST_ROWS)) {
    return { ok: false, result: capacityRefusal(ctx.now) };
  }
  const saved = await saveCrossings(ctx.env.DB, ctx.auth.userId, changes);
  ctx.rows.add({ rows_read: saved.rowsRead, rows_written: saved.rowsWritten });
  return { ok: true, crossed: crossed.filter((level) => saved.changedIds.has(level.id)) };
}

function positionOf(holding: Holding, snapshot: Snapshot | null): Position {
  const quote = snapshot?.quotes[holding.isin] ?? null;
  if (quote === null) return { holding, quote, cost: 0, value: 0 };
  return { holding, quote, cost: holding.quantity * holding.costPerShare, value: holding.quantity * quote.p };
}

function holdingView({ holding, quote, cost, value }: Position, index: SymbolIndex): HoldingView {
  const entry = index.get(holding.isin);
  const base = {
    id: holding.id,
    isin: holding.isin,
    ticker: entry?.[1] ?? null,
    quantity: holding.quantity,
    costPerShare: holding.costPerShare,
    acquiredOn: holding.acquiredOn,
  };
  if (quote === null) {
    return { ...base, status: "no_data_yet", price: null, value: null, gain: null, gainPct: null, source: null, dataTime: null };
  }
  return {
    ...base,
    status: entry?.[5] ?? "inactive",
    price: roundPrice(quote.p),
    value: roundTurnover(value),
    gain: roundTurnover(value - cost),
    gainPct: cost > 0 ? roundPercent(((value - cost) / cost) * PERCENT) : null,
    source: quote.src,
    dataTime: toCairoIso(quote.tt),
  };
}

function totalsOf(positions: Position[]) {
  const cost = positions.reduce((sum, position) => sum + position.cost, 0);
  const value = positions.reduce((sum, position) => sum + position.value, 0);
  const gain = value - cost;
  return {
    cost: roundTurnover(cost),
    value: roundTurnover(value),
    gain: roundTurnover(gain),
    gainPct: cost > 0 ? roundPercent((gain / cost) * PERCENT) : null,
  };
}

function allocationOf(positions: Position[], index: SymbolIndex, totalValue: number) {
  const bySector = new Map<string, number>();
  for (const { holding, quote, value } of positions) {
    if (quote === null) continue;
    const sector = index.get(holding.isin)?.[4] ?? UNCLASSIFIED_SECTOR;
    bySector.set(sector, (bySector.get(sector) ?? 0) + value);
  }
  return [...bySector.entries()]
    .sort(([, left], [, right]) => right - left)
    .map(([sector, value]) => ({
      sector,
      value: roundTurnover(value),
      weightPct: totalValue > 0 ? roundPercent((value / totalValue) * PERCENT) : null,
    }));
}

function portfolioProvenance(
  quotes: QuoteEntry[],
  snapshot: Snapshot | null,
  clock: MarketClock,
  primarySource: string,
  dataTime: string | null,
  stale: boolean,
): Provenance[] {
  if (snapshot === null) return [];
  const held = quoteProvenance(HOLDINGS_FIELDS, quotes, primarySource, clock);
  if (quotes.length === 0) return held;
  return [...held, computedProvenance(PORTFOLIO_COMPUTED_FIELDS, snapshot.sources.stocks, dataTime, "trade", stale)];
}

function portfolioMeta(holdings: Holding[], snapshot: Snapshot | null, clock: MarketClock, primarySource: string): Meta {
  const quotes = holdings.flatMap((holding) => snapshot?.quotes[holding.isin] ?? []);
  const staleReason = staleReasonOf(quotes, clock);
  const dataTime = newestDataTime(quotes.map((quote) => quote.tt));
  const notAvailable = [];
  if (snapshot === null) notAvailable.push({ field: SNAPSHOT_FIELD, reason: SNAPSHOT_MISSING_REASON });
  else if (quotes.length < holdings.length) notAvailable.push({ field: PRICE_FIELD, reason: PRICE_MISSING_REASON });
  return personalMeta({
    dataTime,
    source: snapshot?.sources.stocks ?? null,
    stale: staleReason !== null,
    staleReason,
    session: sessionMeta(clock, snapshot),
    notAvailable,
    provenance: portfolioProvenance(quotes, snapshot, clock, primarySource, dataTime, staleReason !== null),
  });
}

async function handlePortfolioGet(_args: unknown, ctx: ToolContext): Promise<CallToolResult> {
  const [directory, snapshot, personal, clock] = await Promise.all([
    getDirectory(ctx.env),
    getSnapshot(ctx.env),
    listHoldingsAndLevels(ctx.env.DB, ctx.auth.userId),
    loadMarketClock(ctx.env.DB, ctx.now, ctx.rows),
  ]);
  ctx.rows.add({ rows_read: personal.rowsRead });
  if (directory === null) return fail("not_available", DIRECTORY_MISSING_MESSAGE, { source: snapshot?.sources.stocks });
  const settled = await settleLevels(ctx, personal.levels, snapshot);
  if (!settled.ok) return settled.result;
  const index = indexByIsin(directory);
  const positions = personal.holdings.map((holding) => positionOf(holding, snapshot));
  const totals = totalsOf(positions);
  return ok(
    {
      holdings: positions.map((position) => holdingView(position, index)),
      totals,
      allocationBySector: allocationOf(positions, index, totals.value),
      levelsCrossed: settled.crossed.map((crossed) => crossedItem(crossed, index)),
    },
    portfolioMeta(personal.holdings, snapshot, clock, primaryStockSource(ctx.cfg)),
  );
}

async function handleHoldingUpsert(args: z.infer<typeof holdingInputSchema>, ctx: ToolContext): Promise<CallToolResult> {
  const worstCase = args.id === undefined ? INSERT_WORST_ROWS : UPDATE_WORST_ROWS;
  if (!checkPersonalWrite(ctx.usage, ctx.cfg, worstCase)) return capacityRefusal(ctx.now);
  const directory = await getDirectory(ctx.env);
  if (directory === null) return fail("not_available", DIRECTORY_MISSING_MESSAGE);
  const resolved = resolveInput(directory, args.symbol);
  if (!resolved.ok) return resolved.result;
  const saved = await upsertHolding(ctx.env.DB, ctx.auth.userId, {
    id: args.id,
    isin: resolved.entry[0],
    quantity: args.quantity,
    costPerShare: args.costPerShare,
    acquiredOn: args.acquiredOn,
    now: ctx.now,
  });
  ctx.rows.add({ rows_read: saved.rowsRead, rows_written: saved.rowsWritten });
  return saveOutcome(saved);
}

async function handleHoldingRemove(args: z.infer<typeof removeInputSchema>, ctx: ToolContext): Promise<CallToolResult> {
  if (!checkPersonalWrite(ctx.usage, ctx.cfg, REMOVE_WORST_ROWS)) return capacityRefusal(ctx.now);
  const removed = await removeHolding(ctx.env.DB, ctx.auth.userId, args.id);
  ctx.rows.add({ rows_read: removed.rowsRead, rows_written: removed.rowsWritten });
  return removeOutcome(removed);
}

async function handleLevelSet(args: z.infer<typeof levelInputSchema>, ctx: ToolContext): Promise<CallToolResult> {
  const worstCase = args.id === undefined ? INSERT_WORST_ROWS : UPDATE_WORST_ROWS;
  if (!checkPersonalWrite(ctx.usage, ctx.cfg, worstCase)) return capacityRefusal(ctx.now);
  const directory = await getDirectory(ctx.env);
  if (directory === null) return fail("not_available", DIRECTORY_MISSING_MESSAGE);
  const resolved = resolveInput(directory, args.symbol);
  if (!resolved.ok) return resolved.result;
  const saved = await upsertLevel(ctx.env.DB, ctx.auth.userId, {
    id: args.id,
    isin: resolved.entry[0],
    direction: args.direction,
    level: args.level,
    now: ctx.now,
  });
  ctx.rows.add({ rows_read: saved.rowsRead, rows_written: saved.rowsWritten });
  return saveOutcome(saved);
}

async function handleLevelRemove(args: z.infer<typeof removeInputSchema>, ctx: ToolContext): Promise<CallToolResult> {
  if (!checkPersonalWrite(ctx.usage, ctx.cfg, REMOVE_WORST_ROWS)) return capacityRefusal(ctx.now);
  const removed = await removeLevel(ctx.env.DB, ctx.auth.userId, args.id);
  ctx.rows.add({ rows_read: removed.rowsRead, rows_written: removed.rowsWritten });
  return removeOutcome(removed);
}

async function handleLevelsList(_args: unknown, ctx: ToolContext): Promise<CallToolResult> {
  const [directory, personal] = await Promise.all([getDirectory(ctx.env), listHoldingsAndLevels(ctx.env.DB, ctx.auth.userId)]);
  ctx.rows.add({ rows_read: personal.rowsRead });
  if (directory === null) return fail("not_available", DIRECTORY_MISSING_MESSAGE);
  const index = indexByIsin(directory);
  const items = personal.levels.map((level) => ({
    id: level.id,
    isin: level.isin,
    ticker: tickerOf(index, level.isin),
    direction: level.direction,
    level: level.level,
    armed: level.armed === 1,
    lastCrossedAt: level.lastCrossedAt === null ? null : toCairoIso(level.lastCrossedAt),
  }));
  return ok({ items }, personalMeta());
}

function eventItem(event: MarketEvent, index: SymbolIndex): EventItem {
  return {
    occurredAt: toCairoIso(event.occurredAt),
    isin: event.isin,
    ticker: event.isin === null ? null : tickerOf(index, event.isin),
    fundId: event.fundId,
    details: event.payload,
  };
}

function groupEvents(events: MarketEvent[], index: SymbolIndex) {
  const itemsOf = (kind: EventKind) =>
    events.filter((event) => event.kind === kind).map((event) => eventItem(event, index));
  return {
    newNavs: itemsOf("new_nav"),
    bigMoves: itemsOf("big_move"),
    newListings: itemsOf("new_listing"),
    corporateActions: itemsOf("corporate_action"),
  };
}

function eventsNotAvailable(events: MarketEvent[]): Meta["notAvailable"] {
  if (events.length <= DEFAULT_EVENTS_LIMIT) return [];
  return [{ field: EVENTS_FIELD, reason: EVENTS_TRUNCATED_REASON }];
}

function changesProvenance(events: MarketEvent[], crossed: CrossedLevel[], snapshot: Snapshot | null): Provenance[] {
  const provenance: Provenance[] = [];
  const eventEntries: [string[], readonly EventKind[]][] = [
    [EVENT_FIELDS, PROVENANCE_EVENT_KINDS],
    [NEW_NAV_FIELDS, NEW_NAV_KINDS],
  ];
  for (const [fields, kinds] of eventEntries) {
    const occurrences = events.filter((event) => kinds.includes(event.kind)).map((event) => event.occurredAt);
    if (occurrences.length === 0) continue;
    const dataTime = toCairoIso(Math.max(...occurrences));
    provenance.push(computedProvenance(fields, MARKET_EVENTS_SOURCE, dataTime, "fetched", false));
  }
  const crossingTimes = crossed.flatMap((level) => snapshot?.quotes[level.isin]?.tt ?? []);
  if (snapshot !== null && crossingTimes.length > 0) {
    const dataTime = toCairoIso(Math.max(...crossingTimes));
    provenance.push(computedProvenance(CROSSED_FIELDS, snapshot.sources.stocks, dataTime, "trade", false));
  }
  return provenance;
}

async function handleChangesSince(args: z.infer<typeof sinceInputSchema>, ctx: ToolContext): Promise<CallToolResult> {
  const since = Math.floor(Date.parse(args.since) / MILLIS_PER_SECOND);
  if (since < ctx.now - MAX_SINCE_AGE_DAYS * SECONDS_PER_DAY) {
    return fail("invalid_input", `since must be within the last ${MAX_SINCE_AGE_DAYS} days.`);
  }
  const [directory, snapshot, personal, eventsPage] = await Promise.all([
    getDirectory(ctx.env),
    getSnapshot(ctx.env),
    listHoldingsAndLevels(ctx.env.DB, ctx.auth.userId),
    listEventsSince(ctx.env.DB, since, DEFAULT_EVENTS_LIMIT + 1, VISIBLE_EVENT_KINDS),
  ]);
  ctx.rows.add({ rows_read: personal.rowsRead + eventsPage.rowsRead });
  if (directory === null) return fail("not_available", DIRECTORY_MISSING_MESSAGE, { source: snapshot?.sources.stocks });
  const settled = await settleLevels(ctx, personal.levels, snapshot);
  if (!settled.ok) return settled.result;
  const index = indexByIsin(directory);
  const events = eventsPage.events.slice(0, DEFAULT_EVENTS_LIMIT);
  return ok(
    {
      ...groupEvents(events, index),
      levelsCrossed: settled.crossed.map((crossed) => crossedItem(crossed, index)),
      disclosures: { status: "not_available" as const, reason: DISCLOSURES_REASON },
    },
    personalMeta({
      notAvailable: eventsNotAvailable(eventsPage.events),
      provenance: changesProvenance(events, settled.crossed, snapshot),
    }),
  );
}

export function registerPersonalTools(server: McpServer, env: Env, auth: AuthProps): void {
  defineTool(
    server,
    {
      name: "portfolio_get",
      description: "Get your portfolio with value, gain, sector allocation and price levels crossed since the last check.",
      inputSchema: emptyInputSchema,
      outputSchema: portfolioOutputSchema,
      readOnly: true,
      handler: handlePortfolioGet,
    },
    env,
    auth,
  );
  defineTool(
    server,
    {
      name: "portfolio_upsert_holding",
      description: `Add a holding, or update one by id. Up to ${MAX_ITEMS_PER_USER} holdings per user.`,
      inputSchema: holdingInputSchema,
      outputSchema: idOutputSchema,
      readOnly: false,
      handler: handleHoldingUpsert,
    },
    env,
    auth,
  );
  defineTool(
    server,
    {
      name: "portfolio_remove_holding",
      description: "Remove one of your holdings by id.",
      inputSchema: removeInputSchema,
      outputSchema: removedOutputSchema,
      readOnly: false,
      handler: handleHoldingRemove,
    },
    env,
    auth,
  );
  defineTool(
    server,
    {
      name: "price_level_set",
      description: `Set a price level for a symbol, or update one by id. Up to ${MAX_ITEMS_PER_USER} levels per user.`,
      inputSchema: levelInputSchema,
      outputSchema: idOutputSchema,
      readOnly: false,
      handler: handleLevelSet,
    },
    env,
    auth,
  );
  defineTool(
    server,
    {
      name: "price_level_remove",
      description: "Remove one of your price levels by id.",
      inputSchema: removeInputSchema,
      outputSchema: removedOutputSchema,
      readOnly: false,
      handler: handleLevelRemove,
    },
    env,
    auth,
  );
  defineTool(
    server,
    {
      name: "price_levels_list",
      description: "List your price levels with their armed state and last crossing time.",
      inputSchema: emptyInputSchema,
      outputSchema: levelsListOutputSchema,
      readOnly: true,
      handler: handleLevelsList,
    },
    env,
    auth,
  );
  defineTool(
    server,
    {
      name: "what_changed_since",
      description: `List new fund NAVs, big moves, new listings, corporate actions and your crossed price levels since an instant within the last ${MAX_SINCE_AGE_DAYS} days.`,
      inputSchema: sinceInputSchema,
      outputSchema: changesOutputSchema,
      readOnly: true,
      handler: handleChangesSince,
    },
    env,
    auth,
  );
}
