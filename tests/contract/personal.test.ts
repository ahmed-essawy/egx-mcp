import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectorySymbol, QuoteEntry } from "../../src/store/kv";
import { MAX_HOLDING_NUMBER } from "../../src/mcp/tools/personal";
import { DEFAULT_EVENTS_LIMIT, insertEvents } from "../../src/store/d1/events";
import { saveCrossings } from "../../src/store/d1/personal";
import { clearState, restoreBindings, setBindings } from "../helpers/bindings";
import { callTool, errorCodeOf, payloadOf as structuredPayloadOf, type ToolResult } from "../helpers/mcp";
import { seedKey, seedSnapshot, seedSymbols, seedUser, setNow, stockSymbol, syntheticIsin } from "../helpers/seed";
import { MS_PER_SECOND } from "../helpers/time";

const GIVEN_NOW = Date.UTC(2026, 9, 25, 12, 0, 0) / MS_PER_SECOND;
const GIVEN_DAY = "2026-10-25";
const NEXT_MIDNIGHT = Date.UTC(2026, 9, 26);
const SECONDS_PER_DAY = 86_400;
const MAX_AGE_DAYS = 30;
const MAX_ITEMS = 50;
const PERSONAL_ROWS_CAP = 10;
const HOLDING_INSERT_ROWS = 2;
const USER_EMAIL = "user@example.com";
const OTHER_EMAIL = "other@example.com";
const QUOTE_TIME = Date.UTC(2026, 9, 25, 8, 30, 0) / MS_PER_SECOND;
const SESSION_DATE = "2026-10-25";
const COMI_ISIN = "EGS60121C018";
const COMI_TICKER = "COMI";
const ETEL_ISIN = "EGS48031C016";
const ETEL_TICKER = "ETEL";
const OLD_ISIN = "EGS00000OLD1";
const OLD_TICKER = "OLDC";
const NO_QUOTE_ISIN = "EGS00000NOQ1";
const NO_QUOTE_TICKER = "NOQC";
const BANKS = "Banks";
const TELECOM = "Telecom";
const COMI_PRICE = 100;
const ETEL_PRICE = 50;
const INACTIVE_PRICE = 20;
const ABOVE_LEVEL = 110;
const PRICE_ABOVE_LEVEL = 120;
const PRICE_BELOW_LEVEL = 105;
const NOT_AVAILABLE_REASON = "not available from current sources";
const LIMIT_MESSAGE = "Limit 50 per user";
const UPSERT_TOOL = "portfolio_upsert_holding";
const LEVEL_SET_TOOL = "price_level_set";
const LEVELS_LIST_TOOL = "price_levels_list";
const PORTFOLIO_TOOL = "portfolio_get";
const CHANGES_TOOL = "what_changed_since";
const HOLDING_REMOVE_TOOL = "portfolio_remove_holding";
const LEVEL_REMOVE_TOOL = "price_level_remove";
const AMBIGUOUS_QUERY = "Company";
const UNKNOWN_QUERY = "COMZ";
const NO_MATCH_QUERY = "XYZ123";
const EVENTS_FIELD = "events";

type Holding = Record<string, unknown> & { ticker: string; status: string };
type PortfolioPayload = {
  data: {
    holdings: Holding[];
    totals: { cost: number; value: number; gain: number; gainPct: number };
    allocationBySector: { sector: string; value: number }[];
    levelsCrossed: { ticker: string; direction: string; level: number; lastCrossedAt: unknown }[];
  };
};
type ChangesPayload = {
  data: {
    newNavs: unknown[];
    bigMoves: unknown[];
    levelsCrossed: unknown[];
    newListings: unknown[];
    corporateActions: unknown[];
    disclosures: unknown;
  };
};
type LevelItem = { id: number; ticker: string; direction: string; level: number; armed: boolean; lastCrossedAt: unknown };
type ListPayload = { data: { items: LevelItem[] } };
type IdPayload = { data: { id: number } };
type GlobalUsage = { calls: number; personal_rows: number };
type Identity = { isin: string; ticker: string; nameEn: string | null; nameAr: string | null };
type ResolutionError = { code: string; message: string; candidates?: Identity[]; suggestions?: Identity[] };
type NotAvailableMeta = { meta: { notAvailable: { field: string; reason: string }[] } };

function stock(isin: string, ticker: string, sector: string, status: "active" | "inactive" = "active"): DirectorySymbol {
  return stockSymbol(isin, ticker, { nameEn: `${ticker} Company`, sector, status });
}

function quote(ticker: string, price: number): QuoteEntry {
  return {
    t: ticker,
    p: price,
    o: price,
    h: price,
    l: price,
    pc: price,
    ch: 0,
    chp: 0,
    v: 1000,
    val: price * 1000,
    tt: QUOTE_TIME,
    td: SESSION_DATE,
    src: "tradingview",
  };
}

function payloadOf<T>(result: ToolResult): T {
  return structuredPayloadOf<T>(result);
}

function errorOf(result: ToolResult): ResolutionError {
  return (result.structuredContent as unknown as { error: ResolutionError }).error;
}

function identityOf(isin: string, ticker: string): Identity {
  return { isin, ticker, nameEn: `${ticker} Company`, nameAr: null };
}

function retryAtOf(result: ToolResult): number {
  const error = (result.structuredContent as unknown as { error: { retryAt: string } }).error;
  return Date.parse(error.retryAt);
}

function holdingArgs(symbol: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { symbol, quantity: 10, costPerShare: 80, acquiredOn: "2026-01-15", ...overrides };
}

async function seedMarket(comiPrice: number = COMI_PRICE): Promise<void> {
  await seedSymbols([
    stock(COMI_ISIN, COMI_TICKER, BANKS),
    stock(ETEL_ISIN, ETEL_TICKER, TELECOM),
    stock(OLD_ISIN, OLD_TICKER, BANKS, "inactive"),
  ]);
  await seedSnapshot({
    quotes: {
      [COMI_ISIN]: quote(COMI_TICKER, comiPrice),
      [ETEL_ISIN]: quote(ETEL_TICKER, ETEL_PRICE),
      [OLD_ISIN]: quote(OLD_TICKER, INACTIVE_PRICE),
    },
  });
}

async function seedHoldingRows(userId: string, count: number): Promise<void> {
  const insert = env.DB.prepare(
    "INSERT INTO holdings (user_id, isin, quantity, cost_per_share, acquired_on, created_at) VALUES (?1, ?2, 1, 1, '2026-01-01', ?3)",
  );
  await env.DB.batch(Array.from({ length: count }, (_, index) => insert.bind(userId, syntheticIsin(index), GIVEN_NOW)));
}

async function seedLevelRows(userId: string, count: number): Promise<void> {
  const insert = env.DB.prepare(
    "INSERT INTO price_levels (user_id, isin, direction, level, armed, created_at) VALUES (?1, ?2, 'above', 1, 1, ?3)",
  );
  await env.DB.batch(Array.from({ length: count }, (_, index) => insert.bind(userId, syntheticIsin(index), GIVEN_NOW)));
}

async function seedPersonalRows(personalRows: number): Promise<void> {
  await env.DB.prepare("INSERT INTO usage_global (day, calls, rows_read, personal_rows) VALUES (?1, 0, 0, ?2)")
    .bind(GIVEN_DAY, personalRows)
    .run();
}

async function countRows(table: "holdings" | "price_levels", userId: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE user_id = ?1`)
    .bind(userId)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

async function readGlobal(): Promise<GlobalUsage> {
  const row = await env.DB.prepare("SELECT calls, personal_rows FROM usage_global WHERE day = ?1")
    .bind(GIVEN_DAY)
    .first<GlobalUsage>();
  return row ?? { calls: 0, personal_rows: 0 };
}

async function countUsageRows(): Promise<number> {
  const daily = await env.DB.prepare("SELECT COUNT(*) AS total FROM usage_daily WHERE day = ?1")
    .bind(GIVEN_DAY)
    .first<{ total: number }>();
  const global = await env.DB.prepare("SELECT COUNT(*) AS total FROM usage_global WHERE day = ?1")
    .bind(GIVEN_DAY)
    .first<{ total: number }>();
  return (daily?.total ?? 0) + (global?.total ?? 0);
}

function setLevel(key: string, direction: "above" | "below", level: number): Promise<ToolResult> {
  return callTool(LEVEL_SET_TOOL, { symbol: COMI_TICKER, direction, level }, key);
}

async function getPortfolio(key: string): Promise<PortfolioPayload> {
  return payloadOf<PortfolioPayload>(await callTool(PORTFOLIO_TOOL, {}, key));
}

async function listLevels(key: string): Promise<LevelItem[]> {
  return payloadOf<ListPayload>(await callTool(LEVELS_LIST_TOOL, {}, key)).data.items;
}

describe("personal tools contract", () => {
  let userId: string;
  let key: string;

  beforeEach(async () => {
    setNow(GIVEN_NOW);
    await clearState();
    userId = await seedUser(USER_EMAIL);
    key = await seedKey(userId);
    await seedMarket();
  });

  afterEach(() => {
    restoreBindings();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("portfolio_upsert_holding", () => {
    it("stores a valid holding and returns its id", async () => {
      const result = await callTool(UPSERT_TOOL, holdingArgs(COMI_TICKER), key);

      expect(payloadOf<IdPayload>(result).data.id).toEqual(expect.any(Number));
      expect(await countRows("holdings", userId)).toBe(1);
    });

    it.each([
      ["a zero quantity", { quantity: 0 }],
      ["a negative quantity", { quantity: -5 }],
      ["a negative cost", { costPerShare: -1 }],
      ["a malformed acquisition date", { acquiredOn: "15/01/2026" }],
      ["an impossible acquisition date", { acquiredOn: "2026-02-30" }],
    ])("rejects %s as invalid_input", async (_label, overrides) => {
      const result = await callTool(UPSERT_TOOL, holdingArgs(COMI_TICKER, overrides), key);

      expect(result.isError).toBe(true);
      expect(errorCodeOf(result)).toBe("invalid_input");
      expect(await countRows("holdings", userId)).toBe(0);
    });

    it("accepts a zero cost per share", async () => {
      const result = await callTool(UPSERT_TOOL, holdingArgs(COMI_TICKER, { costPerShare: 0 }), key);

      expect(result.isError).toBeFalsy();
    });

    it("refuses the 51st holding with the limit message", async () => {
      await seedHoldingRows(userId, MAX_ITEMS);

      const result = await callTool(UPSERT_TOOL, holdingArgs(COMI_TICKER), key);

      expect(result.isError).toBe(true);
      expect(errorCodeOf(result)).toBe("invalid_input");
      expect(JSON.stringify(result.structuredContent)).toContain(LIMIT_MESSAGE);
      expect(await countRows("holdings", userId)).toBe(MAX_ITEMS);
    });

    it.each([
      ["a quantity above the maximum", { quantity: MAX_HOLDING_NUMBER + 1 }],
      ["a cost above the maximum", { costPerShare: MAX_HOLDING_NUMBER + 1 }],
    ])("rejects %s as invalid_input", async (_label, overrides) => {
      const result = await callTool(UPSERT_TOOL, holdingArgs(COMI_TICKER, overrides), key);

      expect(errorCodeOf(result)).toBe("invalid_input");
      expect(await countRows("holdings", userId)).toBe(0);
    });

    it("accepts a quantity and a cost equal to the maximum", async () => {
      const overrides = { quantity: MAX_HOLDING_NUMBER, costPerShare: MAX_HOLDING_NUMBER };

      const result = await callTool(UPSERT_TOOL, holdingArgs(COMI_TICKER, overrides), key);

      expect(result.isError).toBeFalsy();
    });

    it("answers ambiguous with identity candidates when the symbol matches several", async () => {
      const result = await callTool(UPSERT_TOOL, holdingArgs(AMBIGUOUS_QUERY), key);

      expect(errorCodeOf(result)).toBe("ambiguous");
      expect(errorOf(result).message).toMatch(/^No single symbol matches "Company": .*COMI.*\.$/);
      expect(errorOf(result).candidates).toEqual(
        expect.arrayContaining([identityOf(COMI_ISIN, COMI_TICKER), identityOf(ETEL_ISIN, ETEL_TICKER)]),
      );
      expect(await countRows("holdings", userId)).toBe(0);
    });

    it("answers not_found with identity suggestions when the symbol is unknown", async () => {
      const result = await callTool(UPSERT_TOOL, holdingArgs(UNKNOWN_QUERY), key);

      expect(errorCodeOf(result)).toBe("not_found");
      expect(errorOf(result).suggestions).toEqual(expect.arrayContaining([identityOf(COMI_ISIN, COMI_TICKER)]));
      expect(await countRows("holdings", userId)).toBe(0);
    });

    it("still updates an existing holding when the user is at the limit", async () => {
      await seedHoldingRows(userId, MAX_ITEMS - 1);
      const { data } = payloadOf<IdPayload>(await callTool(UPSERT_TOOL, holdingArgs(COMI_TICKER), key));

      const updated = await callTool(UPSERT_TOOL, holdingArgs(COMI_TICKER, { id: data.id, quantity: 20 }), key);

      expect(updated.isError).toBeFalsy();
      expect(await countRows("holdings", userId)).toBe(MAX_ITEMS);
    });

    it("answers not_found for a holding id that belongs to another user", async () => {
      const otherKey = await seedKey(await seedUser(OTHER_EMAIL));
      const { data } = payloadOf<IdPayload>(await callTool(UPSERT_TOOL, holdingArgs(COMI_TICKER), otherKey));

      const result = await callTool(UPSERT_TOOL, holdingArgs(COMI_TICKER, { id: data.id }), key);

      expect(errorCodeOf(result)).toBe("not_found");
    });
  });

  describe("portfolio_remove_holding", () => {
    it("removes the caller's own holding and returns removed", async () => {
      const { data } = payloadOf<IdPayload>(await callTool(UPSERT_TOOL, holdingArgs(COMI_TICKER), key));

      const result = await callTool(HOLDING_REMOVE_TOOL, { id: data.id }, key);

      expect(payloadOf<{ data: { removed: boolean } }>(result).data).toEqual({ removed: true });
      expect(await countRows("holdings", userId)).toBe(0);
    });

    it("answers not_found for a holding id that belongs to another user", async () => {
      const otherId = await seedUser(OTHER_EMAIL);
      const { data } = payloadOf<IdPayload>(await callTool(UPSERT_TOOL, holdingArgs(COMI_TICKER), await seedKey(otherId)));

      const result = await callTool(HOLDING_REMOVE_TOOL, { id: data.id }, key);

      expect(errorCodeOf(result)).toBe("not_found");
      expect(await countRows("holdings", otherId)).toBe(1);
    });
  });

  describe("portfolio_get", () => {
    beforeEach(async () => {
      await callTool(UPSERT_TOOL, holdingArgs(COMI_TICKER, { quantity: 10, costPerShare: 80 }), key);
      await callTool(UPSERT_TOOL, holdingArgs(ETEL_TICKER, { quantity: 20, costPerShare: 60 }), key);
    });

    it("returns value and gain per holding and in total", async () => {
      const { data } = await getPortfolio(key);

      const comi = data.holdings.find((holding) => holding.ticker === COMI_TICKER);
      expect(comi).toMatchObject({ isin: COMI_ISIN, status: "active", quantity: 10, costPerShare: 80, price: COMI_PRICE });
      expect(comi).toMatchObject({ value: 1000, gain: 200, gainPct: 25 });
      expect(data.totals).toMatchObject({ cost: 2000, value: 2000, gain: 0, gainPct: 0 });
    });

    it("returns the allocation by sector", async () => {
      const { data } = await getPortfolio(key);

      expect(data.allocationBySector).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ sector: BANKS, value: 1000 }),
          expect.objectContaining({ sector: TELECOM, value: 1000 }),
        ]),
      );
    });

    it("returns an inactive symbol as inactive with its last known data", async () => {
      await callTool(UPSERT_TOOL, holdingArgs(OLD_TICKER, { quantity: 5, costPerShare: 10 }), key);

      const { data } = await getPortfolio(key);

      const inactive = data.holdings.find((holding) => holding.ticker === OLD_TICKER);
      expect(inactive).toMatchObject({ isin: OLD_ISIN, status: "inactive", price: INACTIVE_PRICE, value: 100 });
    });

    it("returns a holding without a quote as no_data_yet with null figures", async () => {
      await seedSymbols([stock(COMI_ISIN, COMI_TICKER, BANKS), stock(NO_QUOTE_ISIN, NO_QUOTE_TICKER, BANKS)]);
      await seedSnapshot({ quotes: { [COMI_ISIN]: quote(COMI_TICKER, COMI_PRICE) } });
      await callTool(UPSERT_TOOL, holdingArgs(NO_QUOTE_TICKER), key);

      const { data } = await getPortfolio(key);

      const unquoted = data.holdings.find((holding) => holding.ticker === NO_QUOTE_TICKER);
      expect(unquoted).toMatchObject({ status: "no_data_yet", price: null, value: null, gain: null, gainPct: null });
    });

    it("never returns holdings of another user", async () => {
      const otherKey = await seedKey(await seedUser(OTHER_EMAIL));

      const { data } = await getPortfolio(otherKey);

      expect(data.holdings).toEqual([]);
    });
  });

  describe("price levels", () => {
    it("lists the caller's levels with their armed state", async () => {
      await setLevel(key, "above", ABOVE_LEVEL);

      const items = await listLevels(key);

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ ticker: COMI_TICKER, direction: "above", level: ABOVE_LEVEL, armed: true });
      expect(items[0]?.lastCrossedAt).toBeNull();
    });

    it("removes the caller's own level and returns removed", async () => {
      const { data } = payloadOf<IdPayload>(await setLevel(key, "above", ABOVE_LEVEL));

      const result = await callTool(LEVEL_REMOVE_TOOL, { id: data.id }, key);

      expect(payloadOf<{ data: { removed: boolean } }>(result).data).toEqual({ removed: true });
      expect(await countRows("price_levels", userId)).toBe(0);
    });

    it("answers ambiguous with identity candidates when the symbol matches several", async () => {
      const result = await callTool(LEVEL_SET_TOOL, { symbol: AMBIGUOUS_QUERY, direction: "above", level: ABOVE_LEVEL }, key);

      expect(errorCodeOf(result)).toBe("ambiguous");
      expect(errorOf(result).candidates).toEqual(
        expect.arrayContaining([identityOf(COMI_ISIN, COMI_TICKER), identityOf(ETEL_ISIN, ETEL_TICKER)]),
      );
    });

    it("answers not_found with identity suggestions when the symbol is unknown", async () => {
      const result = await callTool(LEVEL_SET_TOOL, { symbol: UNKNOWN_QUERY, direction: "above", level: ABOVE_LEVEL }, key);

      expect(errorCodeOf(result)).toBe("not_found");
      expect(errorOf(result).message).toMatch(/^No symbol matches "COMZ"\. Did you mean: .*COMI.*\?$/);
      expect(errorOf(result).suggestions).toEqual(expect.arrayContaining([identityOf(COMI_ISIN, COMI_TICKER)]));
    });

    it("answers not_found with a plain message when nothing resembles the symbol", async () => {
      const result = await callTool(LEVEL_SET_TOOL, { symbol: NO_MATCH_QUERY, direction: "above", level: ABOVE_LEVEL }, key);

      expect(errorCodeOf(result)).toBe("not_found");
      expect(errorOf(result).message).toBe(`No symbol matches "${NO_MATCH_QUERY}".`);
      expect(errorOf(result).suggestions).toEqual([]);
    });

    it("refuses a level of zero as invalid_input", async () => {
      const result = await setLevel(key, "above", 0);

      expect(errorCodeOf(result)).toBe("invalid_input");
    });

    it("refuses the 51st level with the limit message", async () => {
      await seedLevelRows(userId, MAX_ITEMS);

      const result = await setLevel(key, "above", ABOVE_LEVEL);

      expect(result.isError).toBe(true);
      expect(errorCodeOf(result)).toBe("invalid_input");
      expect(JSON.stringify(result.structuredContent)).toContain(LIMIT_MESSAGE);
      expect(await countRows("price_levels", userId)).toBe(MAX_ITEMS);
    });
  });

  describe("level crossings", () => {
    it("reports a crossing once with lastCrossedAt and not on the next call", async () => {
      await setLevel(key, "above", ABOVE_LEVEL);
      await seedMarket(PRICE_ABOVE_LEVEL);

      const first = await getPortfolio(key);
      const second = await getPortfolio(key);

      expect(first.data.levelsCrossed).toHaveLength(1);
      expect(first.data.levelsCrossed[0]).toMatchObject({ ticker: COMI_TICKER, direction: "above", level: ABOVE_LEVEL });
      expect(first.data.levelsCrossed[0]?.lastCrossedAt).toBeTruthy();
      expect(second.data.levelsCrossed).toEqual([]);
      expect((await listLevels(key))[0]).toMatchObject({ armed: false });
    });

    it("reports again only after the price returns to the other side and crosses again", async () => {
      await setLevel(key, "above", ABOVE_LEVEL);
      await seedMarket(PRICE_ABOVE_LEVEL);
      await getPortfolio(key);

      await seedMarket(PRICE_BELOW_LEVEL);
      const rearmed = await getPortfolio(key);
      expect(rearmed.data.levelsCrossed).toEqual([]);
      expect((await listLevels(key))[0]).toMatchObject({ armed: true });

      await seedMarket(PRICE_ABOVE_LEVEL);
      const crossedAgain = await getPortfolio(key);
      expect(crossedAgain.data.levelsCrossed).toHaveLength(1);
    });

    it("reports a below level when the price falls under it", async () => {
      await setLevel(key, "below", PRICE_BELOW_LEVEL);
      await seedMarket(PRICE_BELOW_LEVEL - 1);

      const { data } = await getPortfolio(key);

      expect(data.levelsCrossed[0]).toMatchObject({ ticker: COMI_TICKER, direction: "below" });
    });

    it("does not mark a level crossed when it was edited after the evaluation", async () => {
      const { data } = payloadOf<IdPayload>(await setLevel(key, "above", ABOVE_LEVEL));
      const staleChange = { id: data.id, isin: COMI_ISIN, direction: "above" as const, level: ABOVE_LEVEL, armed: 0 as const, lastCrossedAt: GIVEN_NOW };
      await callTool(LEVEL_SET_TOOL, { id: data.id, symbol: COMI_TICKER, direction: "above", level: PRICE_ABOVE_LEVEL + 1 }, key);

      const saved = await saveCrossings(env.DB, userId, [staleChange]);

      expect(saved.changedIds.size).toBe(0);
      expect((await listLevels(key))[0]).toMatchObject({ level: PRICE_ABOVE_LEVEL + 1, armed: true, lastCrossedAt: null });
    });

    it("does not mark a level crossed when only its symbol was edited after the evaluation", async () => {
      const { data } = payloadOf<IdPayload>(await setLevel(key, "above", ABOVE_LEVEL));
      const staleChange = { id: data.id, isin: COMI_ISIN, direction: "above" as const, level: ABOVE_LEVEL, armed: 0 as const, lastCrossedAt: GIVEN_NOW };
      await callTool(LEVEL_SET_TOOL, { id: data.id, symbol: ETEL_TICKER, direction: "above", level: ABOVE_LEVEL }, key);

      const saved = await saveCrossings(env.DB, userId, [staleChange]);

      expect(saved.changedIds.size).toBe(0);
      expect((await listLevels(key))[0]).toMatchObject({ armed: true, lastCrossedAt: null });
    });

    it("does not report a level of another user", async () => {
      const otherKey = await seedKey(await seedUser(OTHER_EMAIL));
      await setLevel(otherKey, "above", ABOVE_LEVEL);
      await seedMarket(PRICE_ABOVE_LEVEL);

      const { data } = await getPortfolio(key);

      expect(data.levelsCrossed).toEqual([]);
    });
  });

  describe("what_changed_since", () => {
    const SINCE = GIVEN_NOW - SECONDS_PER_DAY;
    const BEFORE_SINCE = SINCE - 60;
    const AFTER_SINCE = SINCE + 60;

    function changesSince(since: number): Promise<ToolResult> {
      return callTool(CHANGES_TOOL, { since: new Date(since * MS_PER_SECOND).toISOString() }, key);
    }

    beforeEach(async () => {
      await insertEvents(env.DB, [
        { kind: "new_nav", occurredAt: BEFORE_SINCE, isin: null, fundId: "OLD-FUND", payload: { nav: 1 } },
        { kind: "new_nav", occurredAt: AFTER_SINCE, isin: null, fundId: "FUND-1", payload: { nav: 2 } },
        { kind: "big_move", occurredAt: AFTER_SINCE, isin: COMI_ISIN, fundId: null, payload: { changePct: 6.2 } },
        { kind: "big_move", occurredAt: AFTER_SINCE + 1, isin: ETEL_ISIN, fundId: null, payload: { changePct: -7.1 } },
        { kind: "new_listing", occurredAt: AFTER_SINCE, isin: syntheticIsin(1), fundId: null, payload: {} },
        { kind: "corporate_action", occurredAt: AFTER_SINCE, isin: COMI_ISIN, fundId: null, payload: { kind: "cash" } },
      ]);
    });

    it("returns only events after since, grouped by type", async () => {
      const { data } = payloadOf<ChangesPayload>(await changesSince(SINCE));

      expect(data.newNavs).toHaveLength(1);
      expect(data.bigMoves).toHaveLength(2);
      expect(data.newListings).toHaveLength(1);
      expect(data.corporateActions).toHaveLength(1);
    });

    it("reports no gap below the events limit and flags the truncation above it", async () => {
      const bulk = (count: number) =>
        Array.from({ length: count }, (_, offset) => ({
          kind: "big_move" as const,
          occurredAt: AFTER_SINCE + offset,
          isin: COMI_ISIN,
          fundId: null,
          payload: {},
        }));
      const belowLimit = payloadOf<NotAvailableMeta>(await changesSince(SINCE));
      await insertEvents(env.DB, bulk(DEFAULT_EVENTS_LIMIT));

      const overLimit = payloadOf<ChangesPayload & NotAvailableMeta>(await changesSince(SINCE));

      expect(belowLimit.meta.notAvailable).toEqual([]);
      expect(overLimit.meta.notAvailable).toEqual([{ field: EVENTS_FIELD, reason: expect.any(String) }]);
      const { newNavs, bigMoves, newListings, corporateActions } = overLimit.data;
      expect(newNavs.length + bigMoves.length + newListings.length + corporateActions.length).toBe(DEFAULT_EVENTS_LIMIT);
    });

    it("returns nothing for a since after every event", async () => {
      const { data } = payloadOf<ChangesPayload>(await changesSince(AFTER_SINCE + 10));

      expect(data.newNavs).toEqual([]);
      expect(data.bigMoves).toEqual([]);
      expect(data.newListings).toEqual([]);
      expect(data.corporateActions).toEqual([]);
    });

    it("reports disclosures as not available", async () => {
      const { data } = payloadOf<ChangesPayload>(await changesSince(SINCE));

      expect(data.disclosures).toEqual({ status: "not_available", reason: NOT_AVAILABLE_REASON });
    });

    it("includes levels crossed since the last check", async () => {
      await setLevel(key, "above", ABOVE_LEVEL);
      await seedMarket(PRICE_ABOVE_LEVEL);

      const { data } = payloadOf<ChangesPayload>(await changesSince(SINCE));

      expect(data.levelsCrossed).toHaveLength(1);
    });

    it("rejects a since older than 30 days as invalid_input", async () => {
      const result = await changesSince(GIVEN_NOW - (MAX_AGE_DAYS + 1) * SECONDS_PER_DAY);

      expect(result.isError).toBe(true);
      expect(errorCodeOf(result)).toBe("invalid_input");
    });

    it("rejects a since that is not an instant as invalid_input", async () => {
      const result = await callTool(CHANGES_TOOL, { since: "yesterday" }, key);

      expect(errorCodeOf(result)).toBe("invalid_input");
    });
  });

  describe("personal-write cap", () => {
    beforeEach(() => {
      setBindings({ PERSONAL_DAILY_ROWS: String(PERSONAL_ROWS_CAP) });
    });

    it("adds the rows written by a served upsert to personal_rows in the same accounting batch", async () => {
      await callTool(LEVELS_LIST_TOOL, {}, key);
      const before = await readGlobal();
      const usageRowsBefore = await countUsageRows();

      const served = await callTool(UPSERT_TOOL, holdingArgs(COMI_TICKER), key);

      expect(served.isError).toBeFalsy();
      const after = await readGlobal();
      expect(after.personal_rows - before.personal_rows).toBe(HOLDING_INSERT_ROWS);
      expect(after.calls - before.calls).toBe(1);
      expect(await countUsageRows()).toBe(usageRowsBefore + 1);
    });

    it("refuses portfolio_upsert_holding with capacity when its worst case would pass the cap", async () => {
      await seedPersonalRows(PERSONAL_ROWS_CAP - 1);

      const refused = await callTool(UPSERT_TOOL, holdingArgs(COMI_TICKER), key);

      expect(refused.isError).toBe(true);
      expect(errorCodeOf(refused)).toBe("capacity");
      expect(retryAtOf(refused)).toBe(NEXT_MIDNIGHT);
      expect(await countRows("holdings", userId)).toBe(0);
    });

    it("refuses price_level_set with capacity when its worst case would pass the cap", async () => {
      await seedPersonalRows(PERSONAL_ROWS_CAP - 1);

      const refused = await setLevel(key, "above", ABOVE_LEVEL);

      expect(refused.isError).toBe(true);
      expect(errorCodeOf(refused)).toBe("capacity");
      expect(retryAtOf(refused)).toBe(NEXT_MIDNIGHT);
      expect(await countRows("price_levels", userId)).toBe(0);
    });

    it("still serves price_levels_list at the cap", async () => {
      await seedPersonalRows(PERSONAL_ROWS_CAP);

      const served = await callTool(LEVELS_LIST_TOOL, {}, key);

      expect(served.isError).toBeFalsy();
    });
  });
});
