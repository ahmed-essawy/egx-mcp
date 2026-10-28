import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectoryFund, DirectorySymbol } from "../../src/store/kv";
import { normalizeArabic } from "../../src/domain/arabic";
import { clearState, restoreBindings } from "../helpers/bindings";
import { callTool, errorCodeOf, payloadOf as structuredPayloadOf, postMcp, type ToolResult } from "../helpers/mcp";
import { seedBars, seedCalendar, seedKey, seedSnapshot, seedSymbols, seedUser, setNow, stockSymbol } from "../helpers/seed";
import { MS_PER_SECOND } from "../helpers/time";

const GIVEN_NOW = Date.UTC(2026, 9, 25, 12, 0, 0) / MS_PER_SECOND;
const MS_PER_DAY = 86_400_000;
const JANUARY_NOW = Date.UTC(2027, 0, 15, 12, 0, 0) / MS_PER_SECOND;
const FUND_TOOL = "get_fund";
const HISTORY_TOOL = "get_fund_history";
const COMPARE_TOOL = "compare_funds";
const REAL_RETURN_TOOL = "get_real_return";
const USER_EMAIL = "user@example.com";
const NAV_SOURCE = "mubasher";
const CPI_SOURCE = "CAPMAS urban CPI";
const INDEX_SOURCE = "tradingview";
const TODAY = "2026-10-25";
const YEAR_AGO_SESSION = "2025-10-23";
const YEAR_AGO = "2025-10-25";
const PAGE_SIZE = 500;
const HISTORY_LENGTH = 520;
const COMI_ISIN = "EGS60121C018";
const COMI_TICKER = "COMI";

const GROWTH_FUND = "mubasher:6401";
const USD_FUND = "mubasher:6402";
const WEEKLY_FUND = "mubasher:6403";
const NEW_FUND = "mubasher:6404";
const INFERRED_FUND = "mubasher:6405";
const STALE_FUND = "mubasher:6406";
const MONTHLY_FUND = "mubasher:6501";
const SINGLE_NAV_FUND = "mubasher:6502";
const OLD_HOLIDAY = "2026-10-06";
const HISTORY_FUND = "mubasher:6407";

type FundSeed = {
  fundId: string;
  nameAr: string;
  nameEn: string | null;
  manager: string | null;
  currency: string;
  currencyInferred?: number;
  category?: string | null;
  cycleDays?: number;
  status?: "active" | "stale";
};

type NavSeed = [date: string, nav: number];

type Performance = { pct: number } | { status: string; longestAvailable: unknown };
type FundData = {
  fundId: string;
  nameAr: string;
  nameEn: string | null;
  manager: string | null;
  currency: string;
  category: string | null;
  nav: number;
  navDate: string;
  stale: boolean;
  cycleDays: number;
  performance: Record<"1m" | "3m" | "1y" | "ytd", Performance>;
};
type NotAvailable = { field: string; reason: string };
type FundsMeta = {
  label: string;
  source: string | null;
  stale: boolean;
  notAvailable?: NotAvailable[];
};
type FundPayload = { data: FundData; meta: FundsMeta };
type HistoryPayload = {
  data: { navs: { date: string; nav: number }[]; earliestAvailable: string | null; nextCursor: string | null };
  meta: FundsMeta;
};
type ComparePayload = {
  data: {
    items: { fundId: string; currency: string; returnPct: number }[];
    egx30ReturnPct?: number | null;
    currenciesDiffer: boolean;
  };
  meta: FundsMeta;
};
type RealReturnPayload = {
  data: Record<string, unknown> & {
    nominalPct?: number;
    inflationPct?: number;
    realPct?: number;
    inflationSource?: string;
    inflationMonths?: [string, string];
    status?: string;
    reason?: string;
  };
  meta: FundsMeta;
};

const GROWTH_NAVS: NavSeed[] = [
  [YEAR_AGO_SESSION, 100],
  ["2025-12-31", 110],
  ["2026-07-23", 120],
  ["2026-09-24", 125],
  [TODAY, 130],
];

const USD_NAVS: NavSeed[] = [
  [YEAR_AGO_SESSION, 50],
  [TODAY, 60],
];

const NEW_FUND_NAVS: NavSeed[] = [
  ["2026-08-20", 10],
  ["2026-09-24", 10.5],
  [TODAY, 11],
];

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

function fundSeed(fundId: string, overrides: Partial<FundSeed> = {}): FundSeed {
  return {
    fundId,
    nameAr: `صندوق ${fundId}`,
    nameEn: null,
    manager: "Test Manager",
    currency: "EGP",
    ...overrides,
  };
}

function directoryFund(seed: FundSeed): DirectoryFund {
  return [
    seed.fundId,
    seed.nameAr,
    seed.nameEn,
    seed.manager,
    seed.currency,
    normalizeArabic(seed.nameAr),
    normalizeArabic(seed.nameEn ?? ""),
  ];
}

async function seedFunds(seeds: FundSeed[], symbols: DirectorySymbol[] = []): Promise<void> {
  const insert = env.DB.prepare(
    `INSERT INTO funds
       (fund_id, name_ar, name_en, manager, currency, currency_inferred, category, cycle_days, status, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)`,
  );
  await env.DB.batch(
    seeds.map((seed) =>
      insert.bind(
        seed.fundId,
        seed.nameAr,
        seed.nameEn,
        seed.manager,
        seed.currency,
        seed.currencyInferred ?? 0,
        seed.category ?? null,
        seed.cycleDays ?? 1,
        seed.status ?? "active",
        GIVEN_NOW,
      ),
    ),
  );
  await seedSymbols(symbols, seeds.map(directoryFund));
}

async function seedNavs(fundId: string, rows: NavSeed[]): Promise<void> {
  const insert = env.DB.prepare(
    "INSERT INTO nav_records (fund_id, nav_date, nav, source, fetched_at) VALUES (?1, ?2, ?3, ?4, ?5)",
  );
  await env.DB.batch(rows.map(([date, nav]) => insert.bind(fundId, date, nav, NAV_SOURCE, GIVEN_NOW)));
}

async function seedIndexValues(rows: [sessionDate: string, close: number][]): Promise<void> {
  const insert = env.DB.prepare(
    "INSERT INTO index_values (index_code, session_date, close, change_pct, source) VALUES ('EGX30', ?1, ?2, NULL, ?3)",
  );
  await env.DB.batch(rows.map(([sessionDate, close]) => insert.bind(sessionDate, close, INDEX_SOURCE)));
}

async function seedInflation(rows: [month: string, cpiIndex: number][]): Promise<void> {
  const insert = env.DB.prepare(
    "INSERT INTO inflation_figures (month, cpi_index, yoy_pct, source, entered_by, entered_at) VALUES (?1, ?2, NULL, ?3, 'owner', ?4)",
  );
  await env.DB.batch(rows.map(([month, cpiIndex]) => insert.bind(month, cpiIndex, CPI_SOURCE, GIVEN_NOW)));
}

async function clearFundState(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM nav_records"),
    env.DB.prepare("DELETE FROM funds"),
    env.DB.prepare("DELETE FROM index_values"),
    env.DB.prepare("DELETE FROM inflation_figures"),
    env.DB.prepare("DELETE FROM market_calendar"),
  ]);
}

function getFund(key: string, fund: string): Promise<ToolResult> {
  return callTool(FUND_TOOL, { fund }, key);
}

function fundPayload(result: ToolResult): FundPayload {
  return structuredPayloadOf<FundPayload>(result);
}

function historyPayload(result: ToolResult): HistoryPayload {
  return structuredPayloadOf<HistoryPayload>(result);
}

function comparePayload(result: ToolResult): ComparePayload {
  return structuredPayloadOf<ComparePayload>(result);
}

function realReturnPayload(result: ToolResult): RealReturnPayload {
  return structuredPayloadOf<RealReturnPayload>(result);
}

function realReturn(key: string, args: Record<string, unknown>): Promise<ToolResult> {
  return callTool(REAL_RETURN_TOOL, { from: YEAR_AGO, to: TODAY, ...args }, key);
}

describe("fund tools contract", () => {
  let userId: string;
  let key: string;

  beforeEach(async () => {
    setNow(GIVEN_NOW);
    await clearState();
    await clearFundState();
    await seedSnapshot();
    userId = await seedUser(USER_EMAIL);
    key = await seedKey(userId);
  });

  afterEach(() => {
    restoreBindings();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("get_fund", () => {
    beforeEach(async () => {
      await seedFunds([
        fundSeed(GROWTH_FUND, { nameEn: "Growth Fund", category: "Equity" }),
        fundSeed(NEW_FUND),
        fundSeed(WEEKLY_FUND, { cycleDays: 5 }),
        fundSeed(STALE_FUND, { cycleDays: 1 }),
        fundSeed(INFERRED_FUND, { currencyInferred: 1 }),
        fundSeed(MONTHLY_FUND, { cycleDays: 20 }),
        fundSeed(SINGLE_NAV_FUND, { cycleDays: 5 }),
      ]);
      await seedNavs(MONTHLY_FUND, [["2026-08-26", 50], ["2026-09-23", 51]]);
      await seedNavs(SINGLE_NAV_FUND, [["2026-10-21", 60]]);
      await seedNavs(GROWTH_FUND, GROWTH_NAVS);
      await seedNavs(NEW_FUND, NEW_FUND_NAVS);
      await seedNavs(WEEKLY_FUND, [["2026-10-14", 20], ["2026-10-21", 21]]);
      await seedNavs(STALE_FUND, [["2026-10-14", 30], ["2026-10-18", 31]]);
      await seedNavs(INFERRED_FUND, [[TODAY, 40]]);
    });

    it("returns the identity, latest NAV, cycle and daily_nav label", async () => {
      const { data, meta } = fundPayload(await getFund(key, GROWTH_FUND));

      expect(data).toMatchObject({
        fundId: GROWTH_FUND,
        nameAr: `صندوق ${GROWTH_FUND}`,
        nameEn: "Growth Fund",
        manager: "Test Manager",
        currency: "EGP",
        category: "Equity",
        nav: 130,
        navDate: TODAY,
        stale: false,
        cycleDays: 1,
      });
      expect(meta.label).toBe("daily_nav");
      expect(meta.source).toContain(NAV_SOURCE);
    });

    it("returns null for a name and category the source does not give", async () => {
      const { data } = fundPayload(await getFund(key, NEW_FUND));

      expect(data.nameEn).toBeNull();
      expect(data.category).toBeNull();
    });

    it("names the period with the earliest start as the longest available", async () => {
      setNow(JANUARY_NOW);
      await seedFunds([fundSeed(HISTORY_FUND)]);
      await seedNavs(HISTORY_FUND, [["2026-10-01", 100], ["2026-12-31", 110], ["2027-01-14", 120]]);

      const { data } = fundPayload(await getFund(key, HISTORY_FUND));

      expect(data.performance["1y"]).toEqual({ status: "not_available", longestAvailable: "3m" });
      expect(data.performance.ytd).toMatchObject({ pct: expect.any(Number) });
    });

    it("computes performance for every period with at least one year of history", async () => {
      const { data } = fundPayload(await getFund(key, GROWTH_FUND));

      expect(data.performance).toEqual({
        "1m": { pct: 4 },
        "3m": { pct: 8.33 },
        "1y": { pct: 30 },
        ytd: { pct: 18.18 },
      });
    });

    it("marks a period beyond the history not_available and names the longest available one", async () => {
      const { data } = fundPayload(await getFund(key, NEW_FUND));

      expect(data.performance["1m"]).toEqual({ pct: 4.76 });
      expect(data.performance["1y"]).toEqual({ status: "not_available", longestAvailable: "1m" });
      expect(data.performance["3m"]).toEqual({ status: "not_available", longestAvailable: "1m" });
      expect(data.performance.ytd).toEqual({ status: "not_available", longestAvailable: "1m" });
    });

    it("does not flag a weekly fund stale midweek", async () => {
      const { data, meta } = fundPayload(await getFund(key, WEEKLY_FUND));

      expect(data).toMatchObject({ navDate: "2026-10-21", cycleDays: 5, stale: false });
      expect(meta.stale).toBe(false);
    });

    it("counts a holiday older than 14 days for a long cycle fund", async () => {
      await seedCalendar([{ date: OLD_HOLIDAY, kind: "holiday" }]);

      const { data, meta } = fundPayload(await getFund(key, MONTHLY_FUND));

      expect(data).toMatchObject({ navDate: "2026-09-23", cycleDays: 20, stale: false });
      expect(meta.stale).toBe(false);
    });

    it("flags the same long cycle fund stale when that holiday is missing", async () => {
      const { data } = fundPayload(await getFund(key, MONTHLY_FUND));

      expect(data.stale).toBe(true);
    });

    it("does not judge staleness for a fund with a single NAV", async () => {
      await env.DB.prepare("DELETE FROM nav_records WHERE fund_id = ?1").bind(SINGLE_NAV_FUND).run();
      await seedNavs(SINGLE_NAV_FUND, [["2026-10-01", 60]]);

      const { data, meta } = fundPayload(await getFund(key, SINGLE_NAV_FUND));

      expect(data.stale).toBe(false);
      expect(meta.stale).toBe(false);
    });

    it("flags a daily fund stale after a missed publication cycle", async () => {
      const { data, meta } = fundPayload(await getFund(key, STALE_FUND));

      expect(data).toMatchObject({ navDate: "2026-10-18", stale: true });
      expect(meta.stale).toBe(true);
    });

    it("reports an assumed currency in meta.notAvailable", async () => {
      const { data, meta } = fundPayload(await getFund(key, INFERRED_FUND));

      expect(data.currency).toBe("EGP");
      expect(meta.notAvailable).toContainEqual({ field: "currency", reason: "currency assumed EGP" });
    });

    it("does not report a currency gap for a fund whose source gave the currency", async () => {
      const { meta } = fundPayload(await getFund(key, GROWTH_FUND));

      expect(meta.notAvailable ?? []).not.toContainEqual(expect.objectContaining({ field: "currency" }));
    });

    it("fails with not_found for an unknown fund", async () => {
      const result = await getFund(key, "mubasher:9999");

      expect(result.isError).toBe(true);
      expect(errorCodeOf(result)).toBe("not_found");
    });
  });

  describe("get_fund_history", () => {
    const earliest = addDays(TODAY, -(HISTORY_LENGTH - 1));

    beforeEach(async () => {
      await seedFunds([fundSeed(HISTORY_FUND)]);
      await seedNavs(
        HISTORY_FUND,
        Array.from({ length: HISTORY_LENGTH }, (_, index): NavSeed => [addDays(earliest, index), 100 + index / 100]),
      );
    });

    it("pages by 500 and carries the earliest available date", async () => {
      const first = historyPayload(await callTool(HISTORY_TOOL, { fund: HISTORY_FUND, from: earliest, to: TODAY }, key));

      expect(first.data.navs).toHaveLength(PAGE_SIZE);
      expect(first.data.navs[0]).toEqual({ date: earliest, nav: 100 });
      expect(first.data.earliestAvailable).toBe(earliest);
      expect(first.data.nextCursor).toEqual(expect.any(String));
      expect(first.meta.label).toBe("daily_nav");
    });

    it("adds the rows it read to usage_global.rows_read", async () => {
      const served = await callTool(HISTORY_TOOL, { fund: HISTORY_FUND, from: earliest, to: TODAY }, key);

      const row = await env.DB.prepare("SELECT rows_read FROM usage_global WHERE day = ?1")
        .bind(TODAY)
        .first<{ rows_read: number }>();
      expect(served.isError).toBeFalsy();
      expect(row?.rows_read).toBeGreaterThanOrEqual(PAGE_SIZE);
    });

    it("serves the rest on the next page with no further cursor", async () => {
      const first = historyPayload(await callTool(HISTORY_TOOL, { fund: HISTORY_FUND, from: earliest, to: TODAY }, key));

      const second = historyPayload(
        await callTool(HISTORY_TOOL, { fund: HISTORY_FUND, from: earliest, to: TODAY, cursor: first.data.nextCursor }, key),
      );

      expect(second.data.navs).toHaveLength(HISTORY_LENGTH - PAGE_SIZE);
      expect(second.data.nextCursor).toBeNull();
      expect(second.data.navs[0]?.date).toBe(addDays(earliest, PAGE_SIZE));
      expect(second.data.navs.at(-1)?.date).toBe(TODAY);
    });

    it("states the earliest available date when the range starts before it", async () => {
      const { data } = historyPayload(
        await callTool(HISTORY_TOOL, { fund: HISTORY_FUND, from: addDays(earliest, -30), to: addDays(earliest, 2) }, key),
      );

      expect(data.earliestAvailable).toBe(earliest);
      expect(data.navs.map((entry) => entry.date)).toEqual([earliest, addDays(earliest, 1), addDays(earliest, 2)]);
      expect(data.nextCursor).toBeNull();
    });
  });

  describe("compare_funds", () => {
    beforeEach(async () => {
      await seedFunds([fundSeed(GROWTH_FUND), fundSeed(USD_FUND, { currency: "USD" }), fundSeed(WEEKLY_FUND)]);
      await seedNavs(GROWTH_FUND, GROWTH_NAVS);
      await seedNavs(USD_FUND, USD_NAVS);
      await seedNavs(WEEKLY_FUND, [[YEAR_AGO_SESSION, 20], [TODAY, 25]]);
      await seedIndexValues([
        [YEAR_AGO_SESSION, 30000],
        [TODAY, 36000],
      ]);
    });

    it("keeps each fund in its own currency and states that the currencies differ", async () => {
      const { data, meta } = comparePayload(await callTool(COMPARE_TOOL, { funds: [GROWTH_FUND, USD_FUND], period: "1y" }, key));

      expect(data.currenciesDiffer).toBe(true);
      expect(data.items).toEqual([
        { fundId: GROWTH_FUND, currency: "EGP", returnPct: 30 },
        { fundId: USD_FUND, currency: "USD", returnPct: 20 },
      ]);
      expect(meta.label).toBe("daily_nav");
    });

    it("includes the EGX30 return from index_values for the same period", async () => {
      const { data } = comparePayload(await callTool(COMPARE_TOOL, { funds: [GROWTH_FUND, USD_FUND], period: "1y" }, key));

      expect(data.egx30ReturnPct).toBe(20);
    });

    it("leaves the currencies equal for two EGP funds", async () => {
      const { data } = comparePayload(await callTool(COMPARE_TOOL, { funds: [GROWTH_FUND, WEEKLY_FUND], period: "1y" }, key));

      expect(data.currenciesDiffer).toBe(false);
      expect(data.items.map((item) => item.returnPct)).toEqual([30, 25]);
    });

    it("omits the EGX30 return when includeEgx30 is false", async () => {
      const { data } = comparePayload(
        await callTool(COMPARE_TOOL, { funds: [GROWTH_FUND, USD_FUND], period: "1y", includeEgx30: false }, key),
      );

      expect(data.egx30ReturnPct ?? null).toBeNull();
    });

    it("marks the EGX30 return not available when index history does not cover the period", async () => {
      await env.DB.prepare("DELETE FROM index_values").run();

      const { data, meta } = comparePayload(
        await callTool(COMPARE_TOOL, { funds: [GROWTH_FUND, USD_FUND], period: "1y" }, key),
      );

      expect(data.egx30ReturnPct ?? null).toBeNull();
      expect(meta.notAvailable).toContainEqual(expect.objectContaining({ field: "egx30ReturnPct" }));
    });

    it("rejects a single fund as invalid_input", async () => {
      const result = await callTool(COMPARE_TOOL, { funds: [GROWTH_FUND], period: "1y" }, key);

      expect(result.isError).toBe(true);
      expect(errorCodeOf(result)).toBe("invalid_input");
    });

    it("rejects six funds as invalid_input", async () => {
      const funds = Array.from({ length: 6 }, () => GROWTH_FUND);

      const result = await callTool(COMPARE_TOOL, { funds, period: "1y" }, key);

      expect(errorCodeOf(result)).toBe("invalid_input");
    });
  });

  describe("get_real_return", () => {
    beforeEach(async () => {
      await seedFunds([fundSeed(GROWTH_FUND)], [stockSymbol(COMI_ISIN, COMI_TICKER, { nameAr: "التجاري الدولي", nameEn: "CIB" })]);
      await seedNavs(GROWTH_FUND, GROWTH_NAVS);
      await seedInflation([
        ["2025-10", 200],
        ["2026-10", 250],
      ]);
    });

    it("returns nominal, inflation and real return for a fund", async () => {
      const { data, meta } = realReturnPayload(await realReturn(key, { fund: GROWTH_FUND }));

      expect(data).toEqual({
        nominalPct: 30,
        inflationPct: 25,
        realPct: 4,
        inflationSource: CPI_SOURCE,
        inflationMonths: ["2025-10", "2026-10"],
      });
      expect(meta.label).toBe("daily_nav");
      expect(meta.source).toContain(CPI_SOURCE);
      expect(meta.source).toContain(NAV_SOURCE);
    });

    it("returns the same figures for a symbol from its stored bars", async () => {
      await seedBars(COMI_ISIN, [
        { sessionDate: YEAR_AGO_SESSION, open: 50, high: 50, low: 50, close: 50 },
        { sessionDate: TODAY, open: 75, high: 75, low: 75, close: 75 },
      ]);

      const { data } = realReturnPayload(await realReturn(key, { symbol: COMI_TICKER }));

      expect(data).toMatchObject({
        nominalPct: 50,
        inflationPct: 25,
        realPct: 20,
        inflationSource: CPI_SOURCE,
        inflationMonths: ["2025-10", "2026-10"],
      });
    });

    it("answers not_available and names the missing month when a CPI month is absent", async () => {
      await env.DB.prepare("DELETE FROM inflation_figures WHERE month = '2026-10'").run();

      const { data } = realReturnPayload(await realReturn(key, { fund: GROWTH_FUND }));

      expect(data.status).toBe("not_available");
      expect(data.reason).toContain("2026-10");
      expect(data).not.toHaveProperty("realPct");
    });

    it("rejects a call with both fund and symbol as invalid_input", async () => {
      const result = await realReturn(key, { fund: GROWTH_FUND, symbol: COMI_TICKER });

      expect(result.isError).toBe(true);
      expect(errorCodeOf(result)).toBe("invalid_input");
    });

    it("rejects a call with neither fund nor symbol as invalid_input", async () => {
      const result = await realReturn(key, {});

      expect(result.isError).toBe(true);
      expect(errorCodeOf(result)).toBe("invalid_input");
    });
  });

  describe("access", () => {
    it("returns 401 when no bearer is sent", async () => {
      const response = await postMcp({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: FUND_TOOL, arguments: { fund: GROWTH_FUND } },
      });

      expect(response.status).toBe(401);
    });
  });
});
