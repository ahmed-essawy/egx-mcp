import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectorySymbol, QuoteEntry } from "../../src/store/kv";
import { clearState, restoreBindings } from "../helpers/bindings";
import { callTool, errorCodeOf, payloadOf as structuredPayloadOf, postMcp, type ToolResult } from "../helpers/mcp";
import { seedKey, seedSnapshot, seedSymbols, seedUser, setNow, stockSymbol } from "../helpers/seed";
import { MS_PER_SECOND } from "../helpers/time";

const GIVEN_NOW = Date.UTC(2026, 9, 25, 12, 0, 0) / MS_PER_SECOND;
const PROFILE_TOOL = "get_company_profile";
const DIVIDENDS_TOOL = "get_dividends";
const ACTIONS_TOOL = "get_corporate_actions";
const FINANCIALS_TOOL = "get_financials";
const USER_EMAIL = "user@example.com";
const SESSION_DATE = "2026-10-25";
const NOT_AVAILABLE_REASON = "not available from current sources";
const SOURCE = "tradingview";
const ACTION_SOURCE = "mubasher";
const COMI_ISIN = "EGS60121C018";
const COMI_TICKER = "COMI";
const HRHO_ISIN = "EGS69101C011";
const HRHO_TICKER = "HRHO";
const EMPTY_ISIN = "EGS70041C017";
const EMPTY_TICKER = "EMPT";
const PRICE = 80;
const EPS = 8;
const EQUITY = 5_000_000;
const SHARES = 100_000;
const FREE_FLOAT = 40_000;
const FIRST_TRADE_DATE = "1995-01-02";
const FY_END = "2025-12-31";
const FQ_END = "2026-06-30";
const TTM_END = "2026-06-30";
const UPCOMING_EX_DATE = "2026-11-10";
const LATE_EX_DATE = "2027-01-23";
const BEYOND_EX_DATE = "2027-01-24";
const PAST_EX_DATE_ONE = "2026-03-15";
const PAST_EX_DATE_TWO = "2026-06-01";
const OLD_EX_DATE = "2025-06-01";
const FOREIGN_EX_DATE = "2026-07-01";
const UNKNOWN_PERIOD_END = "";
const NEWER_UNDATED_EPS = 4;
const BONUS_EX_DATE = "2026-12-01";
const SPLIT_EX_DATE = "2026-05-10";
const RIGHTS_EX_DATE = "2026-02-01";
const OTHER_EX_DATE = "2025-12-20";
const UPCOMING_AMOUNT = 1.5;
const PAST_AMOUNT = 2;
const OLD_AMOUNT = 9;
const FUTURE_BEYOND_AMOUNT = 7;
const HRHO_AMOUNT = 0.75;
const DIVIDENDS_365 = 4;
const EXPECTED_YIELD = 0.05;

type ActionSeed = {
  isin: string;
  kind: string;
  exDate: string;
  announcedOn?: string | null;
  ratio?: number | null;
  amount?: number | null;
  currency?: string | null;
  status: "needs_ratio" | "recorded" | "applied";
};

type FigureSeed = {
  isin: string;
  metric: string;
  periodType: "FY" | "FQ" | "TTM";
  periodEnd: string | null;
  value: number;
  currency?: string;
  fetchedAt?: number;
};

type NotAvailable = { field: string; reason: string };
type ToolMeta = {
  label: string;
  source: string | null;
  dataTime: string | null;
  stale: boolean;
  staleReason: string | null;
  notAvailable?: NotAvailable[];
};
type Profile = {
  isin: string;
  ticker: string;
  nameAr: string | null;
  nameEn: string | null;
  sector: string | null;
  market: string;
  sharesOutstanding: number | null;
  freeFloatShares: number | null;
  firstTradeDate: string | null;
  indexCodes: string[];
  status: string;
};
type ActionItem = {
  isin: string;
  ticker: string;
  kind: string;
  exDate: string;
  announcedOn: string | null;
  amount: number | null;
  currency: string | null;
  ratio: number | null;
  status: string;
  source: string;
};
type Figure = {
  metric: string;
  periodType: string;
  periodEnd: string | null;
  value: number;
  currency: string;
  source: string;
};
type Ratio = { value: number; inputs: Record<string, number> } | { status: "not_computable"; reason: string };
type FinancialsData = {
  figures: Figure[];
  missing: string[];
  ratios: { pe: Ratio; pb: Ratio; dividendYield: Ratio };
};
type ProfilePayload = { data: Profile; meta: ToolMeta };
type ActionsPayload = { data: { items: ActionItem[] }; meta: ToolMeta };
type FinancialsPayload = { data: FinancialsData; meta: ToolMeta };

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
    tt: GIVEN_NOW,
    td: SESSION_DATE,
    src: SOURCE,
  };
}

async function seedCompanies(): Promise<void> {
  const symbols: DirectorySymbol[] = [
    stockSymbol(COMI_ISIN, COMI_TICKER, { nameAr: "التجاري الدولي", nameEn: "CIB", sector: "Banks" }),
    stockSymbol(HRHO_ISIN, HRHO_TICKER, { nameAr: "هيرميس", nameEn: "EFG Hermes", sector: "Financial Services" }),
    stockSymbol(EMPTY_ISIN, EMPTY_TICKER, { nameAr: "شركة فارغة", nameEn: "Empty Co" }),
  ];
  await seedSymbols(symbols);
  const insert = env.DB.prepare(
    `INSERT INTO symbols
       (isin, ticker, name_ar, name_en, sector, market, index_codes, status, shares_outstanding, free_float_shares, first_trade_date, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 'main', '[]', 'active', ?6, ?7, ?8, ?9, ?9)`,
  );
  await env.DB.batch([
    insert.bind(COMI_ISIN, COMI_TICKER, "التجاري الدولي", "CIB", "Banks", SHARES, FREE_FLOAT, FIRST_TRADE_DATE, GIVEN_NOW),
    insert.bind(HRHO_ISIN, HRHO_TICKER, "هيرميس", "EFG Hermes", "Financial Services", null, null, null, GIVEN_NOW),
    insert.bind(EMPTY_ISIN, EMPTY_TICKER, "شركة فارغة", "Empty Co", null, null, null, null, GIVEN_NOW),
  ]);
}

async function seedActions(rows: ActionSeed[]): Promise<void> {
  const insert = env.DB.prepare(
    `INSERT INTO corporate_actions
       (isin, kind, announced_on, ex_date, ratio, amount, currency, status, source, source_text, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, ?10, ?10)`,
  );
  await env.DB.batch(
    rows.map((row) =>
      insert.bind(
        row.isin,
        row.kind,
        row.announcedOn ?? null,
        row.exDate,
        row.ratio ?? null,
        row.amount ?? null,
        row.currency ?? null,
        row.status,
        ACTION_SOURCE,
        GIVEN_NOW,
      ),
    ),
  );
}

async function seedFigures(rows: FigureSeed[]): Promise<void> {
  const insert = env.DB.prepare(
    `INSERT INTO financial_figures (isin, metric, period_type, period_end, period_inferred, value, currency, source, fetched_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
  );
  await env.DB.batch(
    rows.map((row) =>
      insert.bind(
        row.isin,
        row.metric,
        row.periodType,
        row.periodEnd ?? UNKNOWN_PERIOD_END,
        row.periodEnd === null ? 1 : 0,
        row.value,
        row.currency ?? "EGP",
        SOURCE,
        row.fetchedAt ?? GIVEN_NOW,
      ),
    ),
  );
}

async function clearFundamentalState(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM corporate_actions"),
    env.DB.prepare("DELETE FROM financial_figures"),
    env.DB.prepare("DELETE FROM symbols"),
  ]);
}

function cashDividend(isin: string, exDate: string, amount: number): ActionSeed {
  return { isin, kind: "cash_dividend", exDate, announcedOn: "2026-10-01", amount, currency: "EGP", status: "recorded" };
}

function comiFigures(): FigureSeed[] {
  return [
    { isin: COMI_ISIN, metric: "revenue", periodType: "FY", periodEnd: FY_END, value: 90_000_000 },
    { isin: COMI_ISIN, metric: "net_income", periodType: "FY", periodEnd: FY_END, value: 12_000_000 },
    { isin: COMI_ISIN, metric: "total_equity", periodType: "FQ", periodEnd: FQ_END, value: EQUITY },
    { isin: COMI_ISIN, metric: "eps_basic", periodType: "TTM", periodEnd: TTM_END, value: EPS },
  ];
}

function profilePayload(result: ToolResult): ProfilePayload {
  return structuredPayloadOf<ProfilePayload>(result);
}

function actionsPayload(result: ToolResult): ActionsPayload {
  return structuredPayloadOf<ActionsPayload>(result);
}

function financialsPayload(result: ToolResult): FinancialsPayload {
  return structuredPayloadOf<FinancialsPayload>(result);
}

function itemOfKind(items: ActionItem[], kind: string): ActionItem | undefined {
  return items.find((item) => item.kind === kind);
}

describe("fundamental tools contract", () => {
  let userId: string;
  let key: string;

  beforeEach(async () => {
    setNow(GIVEN_NOW);
    await clearState();
    await clearFundamentalState();
    await seedSnapshot({
      quotes: {
        [COMI_ISIN]: quote(COMI_TICKER, PRICE),
        [HRHO_ISIN]: quote(HRHO_TICKER, PRICE),
        [EMPTY_ISIN]: quote(EMPTY_TICKER, PRICE),
      },
    });
    await seedCompanies();
    userId = await seedUser(USER_EMAIL);
    key = await seedKey(userId);
  });

  afterEach(() => {
    restoreBindings();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("get_company_profile", () => {
    it("returns the contract fields with the first trade date and no index codes", async () => {
      const { data } = profilePayload(await callTool(PROFILE_TOOL, { symbol: COMI_TICKER }, key));

      expect(data).toEqual({
        isin: COMI_ISIN,
        ticker: COMI_TICKER,
        nameAr: "التجاري الدولي",
        nameEn: "CIB",
        sector: "Banks",
        market: "main",
        sharesOutstanding: SHARES,
        freeFloatShares: FREE_FLOAT,
        firstTradeDate: FIRST_TRADE_DATE,
        indexCodes: [],
        status: "active",
      });
    });

    it("lists the listing date and index membership in meta.notAvailable", async () => {
      const { meta } = profilePayload(await callTool(PROFILE_TOOL, { symbol: COMI_TICKER }, key));

      expect(meta.notAvailable).toContainEqual({ field: "listingDate", reason: NOT_AVAILABLE_REASON });
      expect(meta.notAvailable).toContainEqual({ field: "indexMembership", reason: NOT_AVAILABLE_REASON });
    });

    it("returns null for the figures a source has not given", async () => {
      const { data } = profilePayload(await callTool(PROFILE_TOOL, { symbol: HRHO_TICKER }, key));

      expect(data).toMatchObject({
        isin: HRHO_ISIN,
        sharesOutstanding: null,
        freeFloatShares: null,
        firstTradeDate: null,
        indexCodes: [],
      });
    });

    it("resolves an ISIN", async () => {
      const { data } = profilePayload(await callTool(PROFILE_TOOL, { symbol: COMI_ISIN }, key));

      expect(data.ticker).toBe(COMI_TICKER);
    });

    it("fails with not_found for an unknown symbol", async () => {
      const result = await callTool(PROFILE_TOOL, { symbol: "ZZZZ" }, key);

      expect(result.isError).toBe(true);
      expect(errorCodeOf(result)).toBe("not_found");
    });
  });

  describe("get_dividends", () => {
    beforeEach(async () => {
      await seedActions([
        cashDividend(COMI_ISIN, UPCOMING_EX_DATE, UPCOMING_AMOUNT),
        cashDividend(COMI_ISIN, LATE_EX_DATE, UPCOMING_AMOUNT),
        cashDividend(COMI_ISIN, BEYOND_EX_DATE, FUTURE_BEYOND_AMOUNT),
        cashDividend(COMI_ISIN, PAST_EX_DATE_ONE, PAST_AMOUNT),
        cashDividend(HRHO_ISIN, UPCOMING_EX_DATE, HRHO_AMOUNT),
        { isin: COMI_ISIN, kind: "bonus", exDate: BONUS_EX_DATE, ratio: 0.25, status: "recorded" },
      ]);
    });

    it("defaults the range to today through the next 90 days", async () => {
      const { data } = actionsPayload(await callTool(DIVIDENDS_TOOL, { symbol: COMI_TICKER }, key));

      expect(data.items.map((item) => item.exDate)).toEqual([UPCOMING_EX_DATE, LATE_EX_DATE]);
    });

    it("extends a lone from by 90 days", async () => {
      const { data } = actionsPayload(await callTool(DIVIDENDS_TOOL, { symbol: COMI_TICKER, from: UPCOMING_EX_DATE }, key));

      expect(data.items.map((item) => item.exDate)).toEqual([UPCOMING_EX_DATE, LATE_EX_DATE, BEYOND_EX_DATE]);
    });

    it("reaches back 90 days from a lone to", async () => {
      const { data } = actionsPayload(await callTool(DIVIDENDS_TOOL, { symbol: COMI_TICKER, to: PAST_EX_DATE_TWO }, key));

      expect(data.items.map((item) => item.exDate)).toEqual([PAST_EX_DATE_ONE]);
    });

    it("returns the amount, currency and dates of a dividend", async () => {
      const { data, meta } = actionsPayload(await callTool(DIVIDENDS_TOOL, { symbol: COMI_TICKER }, key));

      expect(data.items[0]).toEqual({
        isin: COMI_ISIN,
        ticker: COMI_TICKER,
        kind: "cash_dividend",
        exDate: UPCOMING_EX_DATE,
        announcedOn: "2026-10-01",
        amount: UPCOMING_AMOUNT,
        currency: "EGP",
        ratio: null,
        status: "recorded",
        source: ACTION_SOURCE,
      });
      expect(meta.source).toBeDefined();
    });

    it("returns only cash dividends", async () => {
      const { data } = actionsPayload(await callTool(DIVIDENDS_TOOL, { symbol: COMI_TICKER }, key));

      expect(data.items.every((item) => item.kind === "cash_dividend")).toBe(true);
    });

    it("honours an explicit range", async () => {
      const { data } = actionsPayload(
        await callTool(DIVIDENDS_TOOL, { symbol: COMI_TICKER, from: PAST_EX_DATE_ONE, to: PAST_EX_DATE_TWO }, key),
      );

      expect(data.items.map((item) => item.exDate)).toEqual([PAST_EX_DATE_ONE]);
    });

    it("lists every company when no symbol is given", async () => {
      const { data } = actionsPayload(await callTool(DIVIDENDS_TOOL, {}, key));

      const tickers = data.items.filter((item) => item.exDate === UPCOMING_EX_DATE).map((item) => item.ticker);
      expect(tickers.sort()).toEqual([COMI_TICKER, HRHO_TICKER]);
    });

    it("returns an empty list for a company with no dividends in the range", async () => {
      const { data } = actionsPayload(await callTool(DIVIDENDS_TOOL, { symbol: EMPTY_TICKER }, key));

      expect(data.items).toEqual([]);
    });

    it("fails with not_found for an unknown symbol", async () => {
      const result = await callTool(DIVIDENDS_TOOL, { symbol: "ZZZZ" }, key);

      expect(result.isError).toBe(true);
      expect(errorCodeOf(result)).toBe("not_found");
    });
  });

  describe("get_corporate_actions", () => {
    beforeEach(async () => {
      await seedActions([
        cashDividend(COMI_ISIN, PAST_EX_DATE_TWO, PAST_AMOUNT),
        { isin: COMI_ISIN, kind: "bonus", exDate: BONUS_EX_DATE, status: "needs_ratio" },
        { isin: COMI_ISIN, kind: "split", exDate: SPLIT_EX_DATE, ratio: 2, status: "applied" },
        { isin: COMI_ISIN, kind: "rights", exDate: RIGHTS_EX_DATE, status: "recorded" },
        { isin: COMI_ISIN, kind: "other", exDate: OTHER_EX_DATE, status: "recorded" },
        cashDividend(COMI_ISIN, OLD_EX_DATE, OLD_AMOUNT),
        cashDividend(HRHO_ISIN, PAST_EX_DATE_TWO, HRHO_AMOUNT),
      ]);
    });

    it("returns every kind of action for the symbol", async () => {
      const { data } = actionsPayload(await callTool(ACTIONS_TOOL, { symbol: COMI_TICKER }, key));

      expect(data.items.map((item) => item.kind).sort()).toEqual([
        "bonus",
        "cash_dividend",
        "cash_dividend",
        "other",
        "rights",
        "split",
      ]);
      expect(data.items.every((item) => item.isin === COMI_ISIN && item.ticker === COMI_TICKER)).toBe(true);
    });

    it("returns a needs_ratio action with a null ratio", async () => {
      const { data } = actionsPayload(await callTool(ACTIONS_TOOL, { symbol: COMI_TICKER }, key));

      expect(itemOfKind(data.items, "bonus")).toEqual({
        isin: COMI_ISIN,
        ticker: COMI_TICKER,
        kind: "bonus",
        exDate: BONUS_EX_DATE,
        announcedOn: null,
        amount: null,
        currency: null,
        ratio: null,
        status: "needs_ratio",
        source: ACTION_SOURCE,
      });
    });

    it("returns the stored ratio of an applied action", async () => {
      const { data } = actionsPayload(await callTool(ACTIONS_TOOL, { symbol: COMI_TICKER }, key));

      expect(itemOfKind(data.items, "split")).toMatchObject({ ratio: 2, status: "applied" });
    });

    it("limits the actions to those on or after from", async () => {
      const { data } = actionsPayload(await callTool(ACTIONS_TOOL, { symbol: COMI_TICKER, from: PAST_EX_DATE_TWO }, key));

      expect(data.items.map((item) => item.exDate).sort()).toEqual([PAST_EX_DATE_TWO, BONUS_EX_DATE].sort());
    });

    it("does not return another company's actions", async () => {
      const { data } = actionsPayload(await callTool(ACTIONS_TOOL, { symbol: HRHO_TICKER }, key));

      expect(data.items).toHaveLength(1);
      expect(data.items[0]).toMatchObject({ isin: HRHO_ISIN, kind: "cash_dividend" });
    });

    it("fails with not_found for an unknown symbol", async () => {
      const result = await callTool(ACTIONS_TOOL, { symbol: "ZZZZ" }, key);

      expect(result.isError).toBe(true);
      expect(errorCodeOf(result)).toBe("not_found");
    });
  });

  describe("get_financials", () => {
    beforeEach(async () => {
      await seedFigures(comiFigures());
      await seedActions([
        cashDividend(COMI_ISIN, PAST_EX_DATE_ONE, PAST_AMOUNT),
        cashDividend(COMI_ISIN, PAST_EX_DATE_TWO, PAST_AMOUNT),
        cashDividend(COMI_ISIN, OLD_EX_DATE, OLD_AMOUNT),
        cashDividend(COMI_ISIN, UPCOMING_EX_DATE, FUTURE_BEYOND_AMOUNT),
      ]);
    });

    it("returns each figure with its period type, period end, currency and source", async () => {
      const { data } = financialsPayload(await callTool(FINANCIALS_TOOL, { symbol: COMI_TICKER }, key));

      expect(data.figures).toHaveLength(4);
      expect(data.figures).toContainEqual({
        metric: "net_income",
        periodType: "FY",
        periodEnd: FY_END,
        value: 12_000_000,
        currency: "EGP",
        source: SOURCE,
      });
      expect(data.figures).toContainEqual({
        metric: "eps_basic",
        periodType: "TTM",
        periodEnd: TTM_END,
        value: EPS,
        currency: "EGP",
        source: SOURCE,
      });
    });

    it("returns a figure with no source period end as null and reports periodEnd as not available", async () => {
      await seedFigures([{ isin: COMI_ISIN, metric: "dps", periodType: "FY", periodEnd: null, value: 2 }]);

      const { data, meta } = financialsPayload(await callTool(FINANCIALS_TOOL, { symbol: COMI_TICKER }, key));

      expect(data.figures).toContainEqual({
        metric: "dps",
        periodType: "FY",
        periodEnd: null,
        value: 2,
        currency: "EGP",
        source: SOURCE,
      });
      expect(meta.notAvailable).toContainEqual({ field: "periodEnd", reason: expect.any(String) });
    });

    it("does not report periodEnd as not available when every figure has one", async () => {
      const { meta } = financialsPayload(await callTool(FINANCIALS_TOOL, { symbol: COMI_TICKER }, key));

      expect(meta.notAvailable ?? []).toEqual([]);
    });

    it("prefers a dated figure over one with no period end for the ratios", async () => {
      await seedFigures([{ isin: COMI_ISIN, metric: "eps_basic", periodType: "TTM", periodEnd: null, value: 1 }]);

      const { data } = financialsPayload(await callTool(FINANCIALS_TOOL, { symbol: COMI_TICKER }, key));

      expect(data.ratios.pe).toEqual({ value: 10, inputs: { price: PRICE, eps: EPS } });
    });

    it("uses the most recently fetched figure for the ratios even when it has no period end", async () => {
      await seedFigures([
        {
          isin: COMI_ISIN,
          metric: "eps_basic",
          periodType: "TTM",
          periodEnd: null,
          value: NEWER_UNDATED_EPS,
          fetchedAt: GIVEN_NOW + 1,
        },
      ]);

      const { data } = financialsPayload(await callTool(FINANCIALS_TOOL, { symbol: COMI_TICKER }, key));

      expect(data.ratios.pe).toMatchObject({ inputs: { eps: NEWER_UNDATED_EPS } });
    });

    it("does not compute P/E or P/B from a figure whose currency differs from the price currency", async () => {
      await env.DB.prepare("UPDATE financial_figures SET currency = 'USD' WHERE metric IN ('eps_basic', 'total_equity')").run();

      const { data } = financialsPayload(await callTool(FINANCIALS_TOOL, { symbol: COMI_TICKER }, key));

      const reason = "figure currency USD differs from price currency EGP";
      expect(data.ratios.pe).toEqual({ status: "not_computable", reason });
      expect(data.ratios.pb).toEqual({ status: "not_computable", reason });
    });

    it("computes P/E and P/B for a stock quoted in USD from figures in USD", async () => {
      await env.DB.prepare("UPDATE symbols SET quote_currency = 'USD' WHERE isin = ?1").bind(COMI_ISIN).run();
      await env.DB.prepare("UPDATE financial_figures SET currency = 'USD' WHERE metric IN ('eps_basic', 'total_equity')").run();

      const { data } = financialsPayload(await callTool(FINANCIALS_TOOL, { symbol: COMI_TICKER }, key));

      expect(data.ratios.pe).toEqual({ value: 10, inputs: { price: PRICE, eps: EPS } });
      expect(data.ratios.pb).toEqual({ value: 1.6, inputs: { price: PRICE, equity: EQUITY, shares: SHARES } });
    });

    it("does not compute P/E for a stock quoted in USD from figures in EGP", async () => {
      await env.DB.prepare("UPDATE symbols SET quote_currency = 'USD' WHERE isin = ?1").bind(COMI_ISIN).run();

      const { data } = financialsPayload(await callTool(FINANCIALS_TOOL, { symbol: COMI_TICKER }, key));

      expect(data.ratios.pe).toEqual({
        status: "not_computable",
        reason: "figure currency EGP differs from price currency USD",
      });
    });

    it("does not compute the yield when a cash dividend in the last 365 days has no amount", async () => {
      await seedActions([{ isin: COMI_ISIN, kind: "cash_dividend", exDate: PAST_EX_DATE_TWO, status: "recorded" }]);

      const { data } = financialsPayload(await callTool(FINANCIALS_TOOL, { symbol: COMI_TICKER }, key));

      expect(data.ratios.dividendYield).toEqual({
        status: "not_computable",
        reason: expect.stringContaining("no amount"),
      });
    });

    it("takes dataTime from the quote and is not stale when the quote is current", async () => {
      const { meta } = financialsPayload(await callTool(FINANCIALS_TOOL, { symbol: COMI_TICKER }, key));

      expect(meta.dataTime).not.toBeNull();
      expect(meta.stale).toBe(false);
      expect(meta.staleReason).toBeNull();
    });

    it("is stale with a reason when the quote is older than the last completed session", async () => {
      await seedSnapshot({ quotes: { [COMI_ISIN]: { ...quote(COMI_TICKER, PRICE), td: "2026-10-01" } } });

      const { meta } = financialsPayload(await callTool(FINANCIALS_TOOL, { symbol: COMI_TICKER }, key));

      expect(meta.stale).toBe(true);
      expect(meta.staleReason).toContain("2026-10-01");
    });

    it("sums only the dividends in the price currency for the yield", async () => {
      await seedActions([{ ...cashDividend(COMI_ISIN, FOREIGN_EX_DATE, 50), currency: "USD" }]);

      const { data } = financialsPayload(await callTool(FINANCIALS_TOOL, { symbol: COMI_TICKER }, key));

      expect(data.ratios.dividendYield).toMatchObject({ inputs: { dividends365: DIVIDENDS_365 } });
    });

    it("lists the metrics no source gave in missing", async () => {
      const { data } = financialsPayload(await callTool(FINANCIALS_TOOL, { symbol: COMI_TICKER }, key));

      expect([...data.missing].sort()).toEqual(["dps", "total_debt"]);
    });

    it("computes the ratios from the snapshot price and shows the inputs", async () => {
      const { data } = financialsPayload(await callTool(FINANCIALS_TOOL, { symbol: COMI_TICKER }, key));

      expect(data.ratios.pe).toEqual({ value: 10, inputs: { price: PRICE, eps: EPS } });
      expect(data.ratios.pb).toEqual({ value: 1.6, inputs: { price: PRICE, equity: EQUITY, shares: SHARES } });
      expect(data.ratios.dividendYield).toEqual({
        value: EXPECTED_YIELD,
        inputs: { price: PRICE, dividends365: DIVIDENDS_365 },
      });
    });

    it("sums only the cash dividends of the last 365 days for the yield", async () => {
      await seedActions([{ isin: COMI_ISIN, kind: "bonus", exDate: PAST_EX_DATE_ONE, ratio: 0.5, status: "recorded" }]);

      const { data } = financialsPayload(await callTool(FINANCIALS_TOOL, { symbol: COMI_TICKER }, key));

      expect(data.ratios.dividendYield).toMatchObject({ inputs: { dividends365: DIVIDENDS_365 } });
    });

    it("tracks the current price", async () => {
      await seedSnapshot({ quotes: { [COMI_ISIN]: quote(COMI_TICKER, 160) } });

      const { data } = financialsPayload(await callTool(FINANCIALS_TOOL, { symbol: COMI_TICKER }, key));

      expect(data.ratios.pe).toEqual({ value: 20, inputs: { price: 160, eps: EPS } });
    });

    it("says why the ratios cannot be computed for a company with no figures", async () => {
      const { data } = financialsPayload(await callTool(FINANCIALS_TOOL, { symbol: EMPTY_TICKER }, key));

      expect(data.figures).toEqual([]);
      expect([...data.missing].sort()).toEqual(["dps", "eps_basic", "net_income", "revenue", "total_debt", "total_equity"]);
      expect(data.ratios.pe).toEqual({ status: "not_computable", reason: expect.any(String) });
      expect(data.ratios.pb).toEqual({ status: "not_computable", reason: expect.any(String) });
    });

    it("does not compute P/E when EPS is not positive", async () => {
      await env.DB.prepare("UPDATE financial_figures SET value = -1 WHERE metric = 'eps_basic'").run();

      const { data } = financialsPayload(await callTool(FINANCIALS_TOOL, { symbol: COMI_TICKER }, key));

      expect(data.ratios.pe).toEqual({ status: "not_computable", reason: "EPS is not positive" });
    });

    it("does not compute P/B when the shares outstanding are unknown", async () => {
      await seedFigures([{ isin: HRHO_ISIN, metric: "total_equity", periodType: "FQ", periodEnd: FQ_END, value: EQUITY }]);

      const { data } = financialsPayload(await callTool(FINANCIALS_TOOL, { symbol: HRHO_TICKER }, key));

      expect(data.ratios.pb).toEqual({ status: "not_computable", reason: "shares outstanding is missing" });
    });

    it("fails with not_found for an unknown symbol", async () => {
      const result = await callTool(FINANCIALS_TOOL, { symbol: "ZZZZ" }, key);

      expect(result.isError).toBe(true);
      expect(errorCodeOf(result)).toBe("not_found");
    });
  });

  describe("access", () => {
    it("returns 401 when no bearer is sent", async () => {
      const response = await postMcp({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: PROFILE_TOOL, arguments: { symbol: COMI_TICKER } },
      });

      expect(response.status).toBe(401);
    });
  });
});
