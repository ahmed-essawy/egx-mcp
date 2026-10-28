import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuoteEntry } from "../../src/store/kv";
import { clearState, restoreBindings } from "../helpers/bindings";
import { callTool, errorCodeOf, payloadOf, type ToolResult } from "../helpers/mcp";
import { seedKey, seedSnapshot, seedSymbols, seedUser, setNow, stockSymbol } from "../helpers/seed";
import { MS_PER_SECOND } from "../helpers/time";

const GIVEN_NOW = Date.UTC(2026, 9, 25, 12, 0, 0) / MS_PER_SECOND;
const QUOTE_TIME = Date.UTC(2026, 9, 25, 8, 30, 0) / MS_PER_SECOND;
const SESSION_DATE = "2026-10-25";
const USER_A_EMAIL = "user-a@example.com";
const USER_B_EMAIL = "user-b@example.com";
const COMI_ISIN = "EGS60121C018";
const COMI_TICKER = "COMI";
const ETEL_ISIN = "EGS48031C016";
const ETEL_TICKER = "ETEL";
const COMI_PRICE = 100;
const ETEL_PRICE = 50;
const ABOVE_LEVEL = 110;
const BELOW_LEVEL = 90;
const UPSERT_TOOL = "portfolio_upsert_holding";
const REMOVE_HOLDING_TOOL = "portfolio_remove_holding";
const PORTFOLIO_TOOL = "portfolio_get";
const LEVEL_SET_TOOL = "price_level_set";
const LEVEL_REMOVE_TOOL = "price_level_remove";
const LEVELS_LIST_TOOL = "price_levels_list";

type Holding = { ticker: string };
type PortfolioPayload = { data: { holdings: Holding[] } };
type LevelItem = { id: number; ticker: string };
type ListPayload = { data: { items: LevelItem[] } };
type IdPayload = { data: { id: number } };

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

async function seedMarket(): Promise<void> {
  await seedSymbols([
    stockSymbol(COMI_ISIN, COMI_TICKER, { nameEn: "COMI Company", sector: "Banks", status: "active" }),
    stockSymbol(ETEL_ISIN, ETEL_TICKER, { nameEn: "ETEL Company", sector: "Telecom", status: "active" }),
  ]);
  await seedSnapshot({
    quotes: { [COMI_ISIN]: quote(COMI_TICKER, COMI_PRICE), [ETEL_ISIN]: quote(ETEL_TICKER, ETEL_PRICE) },
  });
}

async function addHolding(key: string, symbol: string): Promise<number> {
  const args = { symbol, quantity: 10, costPerShare: 80, acquiredOn: "2026-01-15" };
  return payloadOf<IdPayload>(await callTool(UPSERT_TOOL, args, key)).data.id;
}

async function addLevel(key: string, symbol: string, direction: "above" | "below", level: number): Promise<number> {
  return payloadOf<IdPayload>(await callTool(LEVEL_SET_TOOL, { symbol, direction, level }, key)).data.id;
}

async function holdingTickers(key: string): Promise<string[]> {
  const { data } = payloadOf<PortfolioPayload>(await callTool(PORTFOLIO_TOOL, {}, key));
  return data.holdings.map((holding) => holding.ticker);
}

async function listLevels(key: string): Promise<LevelItem[]> {
  return payloadOf<ListPayload>(await callTool(LEVELS_LIST_TOOL, {}, key)).data.items;
}

async function countRows(table: "holdings" | "price_levels", userId: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE user_id = ?1`)
    .bind(userId)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

function expectNotFound(result: ToolResult): void {
  expect(result.isError).toBe(true);
  expect(errorCodeOf(result)).toBe("not_found");
}

describe("cross-user isolation", () => {
  let userA: string;
  let keyA: string;
  let userB: string;
  let keyB: string;

  beforeEach(async () => {
    setNow(GIVEN_NOW);
    await clearState();
    userA = await seedUser(USER_A_EMAIL);
    keyA = await seedKey(userA);
    userB = await seedUser(USER_B_EMAIL);
    keyB = await seedKey(userB);
    await seedMarket();
  });

  afterEach(() => {
    restoreBindings();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("reads", () => {
    it("portfolio_get never includes the holdings of another user", async () => {
      await addHolding(keyA, COMI_TICKER);
      await addHolding(keyB, ETEL_TICKER);

      expect(await holdingTickers(keyA)).toEqual([COMI_TICKER]);
      expect(await holdingTickers(keyB)).toEqual([ETEL_TICKER]);
    });

    it("price_levels_list never includes the levels of another user", async () => {
      const levelA = await addLevel(keyA, COMI_TICKER, "above", ABOVE_LEVEL);
      const levelB = await addLevel(keyB, ETEL_TICKER, "below", BELOW_LEVEL);

      const itemsA = await listLevels(keyA);
      const itemsB = await listLevels(keyB);

      expect(itemsA.map((item) => item.id)).toEqual([levelA]);
      expect(itemsB.map((item) => item.id)).toEqual([levelB]);
      expect(itemsB.map((item) => item.ticker)).toEqual([ETEL_TICKER]);
    });
  });

  describe("removals", () => {
    it("portfolio_remove_holding answers not_found for a holding of another user and leaves it in place", async () => {
      const holdingA = await addHolding(keyA, COMI_TICKER);

      const result = await callTool(REMOVE_HOLDING_TOOL, { id: holdingA }, keyB);

      expectNotFound(result);
      expect(await countRows("holdings", userA)).toBe(1);
      expect(await holdingTickers(keyA)).toEqual([COMI_TICKER]);
    });

    it("price_level_remove answers not_found for a level of another user and leaves it in place", async () => {
      const levelA = await addLevel(keyA, COMI_TICKER, "above", ABOVE_LEVEL);

      const result = await callTool(LEVEL_REMOVE_TOOL, { id: levelA }, keyB);

      expectNotFound(result);
      expect(await countRows("price_levels", userA)).toBe(1);
      expect((await listLevels(keyA)).map((item) => item.id)).toEqual([levelA]);
    });

    it("does not touch the rows of user B when B's removal of A's ids is refused", async () => {
      const holdingA = await addHolding(keyA, COMI_TICKER);
      const levelA = await addLevel(keyA, COMI_TICKER, "above", ABOVE_LEVEL);
      await addHolding(keyB, ETEL_TICKER);
      await addLevel(keyB, ETEL_TICKER, "below", BELOW_LEVEL);

      await callTool(REMOVE_HOLDING_TOOL, { id: holdingA }, keyB);
      await callTool(LEVEL_REMOVE_TOOL, { id: levelA }, keyB);

      expect(await countRows("holdings", userB)).toBe(1);
      expect(await countRows("price_levels", userB)).toBe(1);
      expect(await countRows("holdings", userA)).toBe(1);
      expect(await countRows("price_levels", userA)).toBe(1);
    });
  });
});
