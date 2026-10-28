import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toCairoIso } from "../../src/domain/calendar";
import { NOTICE } from "../../src/mcp/envelope";
import type { Directory, Snapshot, Stats } from "../../src/store/kv";
import { callNodeTool, createNodeStores, listNodeTools, NODE_AUTH, putJson, type NodeStores } from "../helpers/node-mcp";
import { defaultSnapshot } from "../helpers/snapshot-fixture";

const NOW_MS = Date.UTC(2026, 9, 27, 10, 0, 0);
const NOW_SECONDS = Math.floor(NOW_MS / 1000);
const SECONDS_PER_DAY = 86_400;
const MS_PER_DAY = 86_400_000;
const TRADE_TIME = NOW_SECONDS - 600;
const SESSION_DATE = "2026-10-26";
const WINDOW = { from: "2026-09-01", to: "2026-10-27" };
const FUND_WINDOW = { from: "2026-09-25", to: "2026-10-26" };
const INDEX_ROWS = 60;
const INDEX_CODES = ["EGX30", "EGX70EWI"];
const ISIN = "EGS60081C017";
const SECOND_ISIN = "EGS69101C011";
const FUND_ID = "fund-1";
const SECOND_FUND_ID = "fund-2";
const ERROR_CODES = ["unauthorized", "rate_limited", "capacity", "not_found", "ambiguous", "invalid_input", "not_available", "forbidden"];
const NO_MARKET_VALUE_TOOLS = ["portfolio_upsert_holding", "portfolio_remove_holding", "price_level_set", "price_level_remove", "price_levels_list", "admin"];
const ADVICE_WORDS = /\b(buy|sell|hold|recommend\w*)\b/i;
const MISSING_ID = 999_999;

const SAMPLE_ARGS: Record<string, Record<string, unknown>> = {
  search: { query: "COMI" },
  get_quotes: { symbols: ["COMI"] },
  get_market_overview: {},
  admin: { action: "usage_summary" },
  get_indices: { names: [] },
  get_index_history: { index: "EGX30" },
  get_index_summary: { indices: INDEX_CODES },
  get_price_history: { symbol: "COMI", ...WINDOW },
  compare_symbols: { symbols: ["COMI", "ETEL"], ...WINDOW },
  get_movers: { kind: "gainers" },
  get_52_week_range: { symbols: ["COMI"] },
  get_sector_performance: { period: "1m" },
  get_daily_summary: {},
  get_fund: { fund: FUND_ID },
  get_fund_history: { fund: FUND_ID, ...FUND_WINDOW },
  compare_funds: { funds: [FUND_ID, SECOND_FUND_ID], period: "1m", includeEgx30: true },
  get_real_return: { fund: FUND_ID, ...FUND_WINDOW },
  get_company_profile: { symbol: "COMI" },
  get_dividends: {},
  get_corporate_actions: { symbol: "COMI" },
  get_financials: { symbol: "COMI" },
  get_metals: {},
  get_usd_egp: {},
  portfolio_get: {},
  portfolio_upsert_holding: { symbol: "COMI", quantity: 10, costPerShare: 50, acquiredOn: "2026-10-01" },
  portfolio_remove_holding: { id: MISSING_ID },
  price_level_set: { symbol: "COMI", direction: "above", level: 60 },
  price_level_remove: { id: MISSING_ID },
  price_levels_list: {},
  what_changed_since: { since: toCairoIso(NOW_SECONDS - SECONDS_PER_DAY) },
};

const DIRECTORY: Directory = {
  v: 1,
  builtAt: NOW_SECONDS - 3600,
  symbols: [
    [ISIN, "COMI", "البنك التجاري الدولي", "Commercial International Bank", "Banks", "active", "", "commercial international bank", ["comi"]],
    [SECOND_ISIN, "ETEL", "المصرية للاتصالات", "Telecom Egypt", "Telecom", "active", "", "telecom egypt", ["etel"]],
  ],
  tickerToIsin: { COMI: ISIN, ETEL: SECOND_ISIN },
  funds: [
    [FUND_ID, "صندوق اختبار", "Test Fund", null, "EGP", "صندوق اختبار", "test fund"],
    [SECOND_FUND_ID, "صندوق ثان", "Second Fund", null, "EGP", "صندوق ثان", "second fund"],
  ],
};

const EMPTY_DIRECTORY: Directory = { ...DIRECTORY, symbols: [], tickerToIsin: {}, funds: [] };

function quote(ticker: string) {
  return { t: ticker, p: 100, o: 99, h: 101, l: 98, pc: 99, ch: 1, chp: 1, v: 1000, val: 100000, tt: TRADE_TIME, td: SESSION_DATE, src: "tradingview" };
}

function fullSnapshot(): Snapshot {
  return {
    ...defaultSnapshot(),
    session: { ...defaultSnapshot().session, date: SESSION_DATE },
    quotes: { [ISIN]: quote("COMI"), [SECOND_ISIN]: quote("ETEL") },
    indices: {
      EGX30: { v: 30000, chp: 1, tt: TRADE_TIME, src: "tradingview" },
      EGX70EWI: { v: 9000, chp: -0.5, tt: TRADE_TIME, src: "tradingview" },
    },
    fx: { USDEGP: { v: 48.52, tt: TRADE_TIME, src: "tradingview", kind: "market" } },
    metals: {
      egypt: {
        src: "isagha",
        fetchedAt: NOW_SECONDS - 900,
        unit: "EGP/g",
        gold: { "18": { buy: 5360, sell: 5400 }, "21": { buy: 6255, sell: 6300 }, "24": { buy: 7150, sell: 7200 }, pound: { buy: 50040, sell: 50400 } },
        silver: { "925": { buy: 80, sell: 85 }, "999": { buy: 86, sell: 90 } },
      },
      XAUUSD: { v: 4012.5, unit: "USD/oz", tt: TRADE_TIME, src: "tradingview" },
      XAGUSD: { v: 48.25, unit: "USD/oz", tt: TRADE_TIME, src: "tradingview" },
    },
    top: { gainers: [ISIN], losers: [SECOND_ISIN], byVolume: [ISIN], byValue: [ISIN] },
  };
}

function fullStats(): Stats {
  const symbolStats = {
    h52: 105,
    h52d: "2026-09-01",
    l52: 60,
    l52d: "2026-02-01",
    avgVol20: 500,
    ret: { "1d": 1, "1w": 2, "1m": 3, "3m": 4, ytd: 5, "1y": 6 },
    pendingAdj: [],
  };
  return { v: 1, asOf: SESSION_DATE, symbols: { [ISIN]: symbolStats, [SECOND_ISIN]: symbolStats } };
}

function isoDaysBefore(days: number): string {
  return new Date(Date.UTC(2026, 9, 26) - days * MS_PER_DAY).toISOString().slice(0, 10);
}

function seedFull(stores: NodeStores): void {
  const { sqlite } = stores;
  putJson(stores, "directory:v1", DIRECTORY);
  putJson(stores, "snapshot:v1", fullSnapshot());
  putJson(stores, "snapshot:last-session", fullSnapshot());
  putJson(stores, "stats:v1", fullStats());
  for (const [isin, ticker, sector] of [[ISIN, "COMI", "Banks"], [SECOND_ISIN, "ETEL", "Telecom"]] as const) {
    sqlite
      .prepare("INSERT INTO symbols (isin, ticker, sector, status, created_at, updated_at) VALUES (?1, ?2, ?3, 'active', 0, ?4)")
      .run(isin, ticker, sector, NOW_SECONDS - 7200);
  }
  for (let offset = 0; offset < INDEX_ROWS; offset += 1) {
    for (const code of INDEX_CODES) {
      sqlite
        .prepare("INSERT INTO index_values (index_code, session_date, close, source) VALUES (?1, ?2, ?3, 'tradingview')")
        .run(code, isoDaysBefore(offset), 1000 + offset);
    }
  }
  for (const isin of [ISIN, SECOND_ISIN]) {
    for (const date of ["2026-09-10", "2026-09-20", "2026-10-05", "2026-10-20"]) {
      sqlite
        .prepare(
          `INSERT INTO daily_bars
            (isin, session_date, open, high, low, close, volume, adj_open, adj_high, adj_low, adj_close, source)
           VALUES (?1, ?2, 10, 11, 9, 10, 1000, 10, 11, 9, 10, 'tradingview')`,
        )
        .run(isin, date);
    }
  }
  for (const [id, nameAr, nameEn] of [[FUND_ID, "صندوق اختبار", "Test Fund"], [SECOND_FUND_ID, "صندوق ثان", "Second Fund"]] as const) {
    sqlite
      .prepare("INSERT INTO funds (fund_id, name_ar, name_en, currency, cycle_days, status) VALUES (?1, ?2, ?3, 'EGP', 1, 'active')")
      .run(id, nameAr, nameEn);
    for (const [date, nav] of [["2026-09-25", 10], ["2026-10-26", 11]] as const) {
      sqlite.prepare("INSERT INTO nav_records (fund_id, nav_date, nav, source) VALUES (?1, ?2, ?3, 'mubasher')").run(id, date, nav);
    }
  }
  for (const [month, cpi] of [["2026-09", 100], ["2026-10", 101]] as const) {
    sqlite.prepare("INSERT INTO inflation_figures (month, cpi_index, source) VALUES (?1, ?2, 'capmas')").run(month, cpi);
  }
  sqlite
    .prepare(
      `INSERT INTO corporate_actions (isin, kind, ex_date, amount, currency, status, source)
       VALUES (?1, 'cash_dividend', '2026-11-15', 1.5, 'EGP', 'recorded', 'mubasher')`,
    )
    .run(ISIN);
  for (const [metric, periodEnd] of [["eps_basic", "2025-12-31"], ["revenue", "2025-12-31"]] as const) {
    sqlite
      .prepare(
        `INSERT INTO financial_figures (isin, metric, period_type, period_end, value, currency, source)
         VALUES (?1, ?2, 'FY', ?3, 10, 'EGP', 'mubasher')`,
      )
      .run(ISIN, metric, periodEnd);
  }
  sqlite
    .prepare("INSERT INTO market_events (kind, occurred_at, isin, fund_id, payload) VALUES ('big_move', ?1, ?2, NULL, '{}')")
    .run(NOW_SECONDS - 1800, ISIN);
  sqlite
    .prepare(
      `INSERT INTO holdings (user_id, isin, quantity, cost_per_share, acquired_on, created_at)
       VALUES (?1, ?2, 10, 90, '2026-01-01', 0)`,
    )
    .run(NODE_AUTH.userId, ISIN);
  sqlite
    .prepare(
      `INSERT INTO price_levels (user_id, isin, direction, level, armed, last_crossed_at, created_at)
       VALUES (?1, ?2, 'below', 200, 1, NULL, 0)`,
    )
    .run(NODE_AUTH.userId, ISIN);
}

function seedEmpty(stores: NodeStores): void {
  putJson(stores, "directory:v1", EMPTY_DIRECTORY);
}

const STATES = [
  { name: "full", seed: seedFull },
  { name: "empty", seed: seedEmpty },
] as const;

type Envelope = {
  data?: Record<string, unknown>;
  error?: { code: string };
  meta: { provenance: { fields: string[] }[] };
  notice: string;
};

type ListedSchema = { outputSchema?: { properties?: { meta?: { required?: string[] } } } };

function collectProblems(value: unknown, path: string, problems: string[]): void {
  if (value === undefined) problems.push(`${path} is undefined`);
  else if (typeof value === "number" && !Number.isFinite(value)) problems.push(`${path} is not finite`);
  else if (Array.isArray(value)) value.forEach((item, index) => collectProblems(item, `${path}[${index}]`, problems));
  else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) collectProblems(item, `${path}.${key}`, problems);
  }
}

function collectStrings(value: unknown, strings: string[]): string[] {
  if (typeof value === "string") strings.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, strings));
  else if (value !== null && typeof value === "object") Object.values(value).forEach((item) => collectStrings(item, strings));
  return strings;
}

describe("all tools contract guard", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW_MS);
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("a tool must not call fetch");
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.useRealTimers();
  });

  it("has sample args for every registered tool and a contract on each", async () => {
    const tools = await listNodeTools(createNodeStores().env);
    const missing = tools.filter((tool) => !(tool.name in SAMPLE_ARGS)).map((tool) => `missing sample args for ${tool.name}`);
    expect(missing).toEqual([]);
    expect(Object.keys(SAMPLE_ARGS).sort()).toEqual(tools.map((tool) => tool.name).sort());
    for (const tool of tools as (typeof tools[number] & ListedSchema)[]) {
      expect(tool.outputSchema, tool.name).toBeDefined();
      expect(tool.description, tool.name).toContain(NOTICE);
      expect(tool.outputSchema?.properties?.meta?.required, tool.name).toContain("provenance");
    }
  });

  for (const state of STATES) {
    describe(`${state.name} state`, () => {
      for (const name of Object.keys(SAMPLE_ARGS)) {
        it(`${name} honours the envelope contract`, async () => {
          const stores = createNodeStores();
          state.seed(stores);
          const result = await callNodeTool(stores.env, name, SAMPLE_ARGS[name]!);
          const text = (result.content[0] as { text: string }).text;
          const payload = result.structuredContent as unknown as Envelope;

          expect(JSON.parse(text)).toEqual(payload);
          const problems: string[] = [];
          collectProblems(payload, name, problems);
          expect(problems).toEqual([]);
          expect(payload.notice).toBe(NOTICE);
          expect(Array.isArray(payload.meta.provenance)).toBe(true);
          expect(collectStrings(payload, []).filter((value) => ADVICE_WORDS.test(value))).toEqual([]);

          if (result.isError) {
            expect(ERROR_CODES).toContain(payload.error?.code);
            expect(payload.meta.provenance).toEqual([]);
            return;
          }
          expect(payload.data).toBeDefined();
          if (state.name !== "full" || NO_MARKET_VALUE_TOOLS.includes(name)) return;
          expect(payload.meta.provenance.length, `${name} provenance`).toBeGreaterThan(0);
          for (const field of payload.meta.provenance.flatMap((entry) => entry.fields)) {
            expect(Object.keys(payload.data!), `${name} field ${field}`).toContain(field);
          }
        });
      }
    });
  }

  it("never calls fetch", async () => {
    const stores = createNodeStores();
    seedFull(stores);
    for (const name of Object.keys(SAMPLE_ARGS)) await callNodeTool(stores.env, name, SAMPLE_ARGS[name]!);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
