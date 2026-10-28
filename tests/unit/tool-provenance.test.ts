import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toCairoIso } from "../../src/domain/calendar";
import type { Directory, QuoteEntry, Snapshot, Stats } from "../../src/store/kv";
import { callNodeTool, createNodeStores, putJson, type NodeStores } from "../helpers/node-mcp";
import { defaultSnapshot } from "../helpers/snapshot-fixture";

const NOW_MS = Date.UTC(2026, 9, 27, 10, 0, 0);
const NOW_SECONDS = Math.floor(NOW_MS / 1000);
const TRADE_TIME = NOW_SECONDS - 600;
const FRESH_TRADE_DATE = "2026-10-27";
const STALE_TRADE_DATE = "2026-10-22";
const ISIN = "EGS60081C017";
const BUILT_AT = NOW_SECONDS - 3600;

const DIRECTORY: Directory = {
  v: 1,
  builtAt: BUILT_AT,
  symbols: [[ISIN, "COMI", "البنك التجاري الدولي", "Commercial International Bank", "Banks", "active", "", "commercial international bank", ["comi"]]],
  tickerToIsin: { COMI: ISIN },
  funds: [],
};

const EMPTY_DIRECTORY: Directory = { v: 1, builtAt: BUILT_AT, symbols: [], tickerToIsin: {}, funds: [] };

type Provenance = {
  fields: string[];
  source: string;
  dataTime: string | null;
  timeKind: string;
  stale: boolean;
  basis: string;
};

async function provenanceOf(stores: NodeStores, name: string, args: Record<string, unknown>): Promise<Provenance[]> {
  const result = await callNodeTool(stores.env, name, args);
  expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
  return (result.structuredContent as unknown as { meta: { provenance: Provenance[] } }).meta.provenance;
}

function quote(tradeDate: string): QuoteEntry {
  return { t: "COMI", p: 100, o: 99, h: 101, l: 98, pc: 99, ch: 1, chp: 1, v: 1000, val: 100000, tt: TRADE_TIME, td: tradeDate, src: "tradingview" };
}

function snapshotWith(tradeDate: string, primaryFailed: boolean): Snapshot {
  return {
    ...defaultSnapshot(),
    sources: { stocks: "tradingview", primaryFailed },
    quotes: { [ISIN]: quote(tradeDate) },
  };
}

describe("search provenance", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("states the directory as a computed fetched result", async () => {
    const stores = createNodeStores();
    putJson(stores, "directory:v1", DIRECTORY);
    expect(await provenanceOf(stores, "search", { query: "COMI" })).toEqual([
      { fields: ["results"], source: "directory", dataTime: toCairoIso(BUILT_AT), timeKind: "fetched", stale: false, basis: "computed" },
    ]);
  });

  it("is empty without a directory", async () => {
    expect(await provenanceOf(createNodeStores(), "search", { query: "COMI" })).toEqual([]);
  });

  it("is empty for an empty directory", async () => {
    const stores = createNodeStores();
    putJson(stores, "directory:v1", EMPTY_DIRECTORY);
    expect(await provenanceOf(stores, "search", { query: "COMI" })).toEqual([]);
  });
});

describe("get_quotes provenance", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function storesWith(snapshot: Snapshot | null): NodeStores {
    const stores = createNodeStores();
    putJson(stores, "directory:v1", DIRECTORY);
    if (snapshot) putJson(stores, "snapshot:v1", snapshot);
    return stores;
  }

  it("marks the primary source with the quote time", async () => {
    const stores = storesWith(snapshotWith(FRESH_TRADE_DATE, false));
    expect(await provenanceOf(stores, "get_quotes", { symbols: ["COMI"] })).toEqual([
      { fields: ["quotes"], source: "tradingview", dataTime: toCairoIso(TRADE_TIME), timeKind: "trade", stale: false, basis: "primary" },
    ]);
  });

  it("marks the backup basis when the quote came from a non primary provider", async () => {
    const snapshot = snapshotWith(FRESH_TRADE_DATE, true);
    const stores = storesWith({
      ...snapshot,
      sources: { stocks: "mubasher", primaryFailed: true },
      quotes: { [ISIN]: { ...quote(FRESH_TRADE_DATE), src: "mubasher" } },
    });
    const [entry] = await provenanceOf(stores, "get_quotes", { symbols: ["COMI"] });
    expect(entry?.basis).toBe("backup");
  });

  it("bases each source on the configured primary provider in a mixed snapshot", async () => {
    const stores = createNodeStores();
    putJson(stores, "directory:v1", {
      ...DIRECTORY,
      symbols: [...DIRECTORY.symbols, [SECOND_ISIN, "ETEL", "المصرية للاتصالات", "Telecom Egypt", "Telecom", "active", "", "telecom egypt", ["etel"]]],
      tickerToIsin: { COMI: ISIN, ETEL: SECOND_ISIN },
    });
    putJson(stores, "snapshot:v1", {
      ...snapshotWith(FRESH_TRADE_DATE, false),
      sources: { stocks: "tradingview", primaryFailed: false },
      quotes: {
        [ISIN]: { ...quote(FRESH_TRADE_DATE), src: "mubasher" },
        [SECOND_ISIN]: { ...quote(FRESH_TRADE_DATE), t: "ETEL", src: "tradingview" },
      },
    });
    const env = { ...stores.env, STOCK_PROVIDERS: "mubasher,tradingview" } as unknown as Env;
    const entries = await provenanceOf({ ...stores, env }, "get_quotes", { symbols: ["COMI", "ETEL"] });
    expect(entries.map(({ source, basis }) => ({ source, basis }))).toEqual([
      { source: "mubasher", basis: "primary" },
      { source: "tradingview", basis: "backup" },
    ]);
  });

  it("marks a quote three sessions old as stale", async () => {
    const stores = storesWith(snapshotWith(STALE_TRADE_DATE, false));
    const [entry] = await provenanceOf(stores, "get_quotes", { symbols: ["COMI"] });
    expect(entry?.stale).toBe(true);
  });

  it("is empty without a snapshot", async () => {
    expect(await provenanceOf(storesWith(null), "get_quotes", { symbols: ["COMI"] })).toEqual([]);
  });
});

const SESSION_DATE = "2026-10-26";
const INDEX_TIME = TRADE_TIME - 60;
const OVERVIEW_MOVER_FIELDS = ["breadth", "totals", "topGainers", "topLosers", "mostActiveByVolume", "mostActiveByValue"];
const SUMMARY_MOVER_FIELDS = ["breadth", "totals", "topGainers", "topLosers"];

function marketSnapshot(): Snapshot {
  return {
    ...snapshotWith(FRESH_TRADE_DATE, false),
    session: { ...defaultSnapshot().session, date: SESSION_DATE },
    indices: { EGX30: { v: 30000, chp: 1, tt: INDEX_TIME, src: "tradingview" } },
    top: { gainers: [ISIN], losers: [], byVolume: [ISIN], byValue: [ISIN] },
  };
}

describe("market tools provenance", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function marketStores(snapshot: Snapshot = marketSnapshot()): NodeStores {
    const stores = createNodeStores();
    putJson(stores, "directory:v1", DIRECTORY);
    putJson(stores, "snapshot:v1", snapshot);
    putJson(stores, "snapshot:last-session", snapshot);
    return stores;
  }

  it("states the indices and the computed movers for the overview", async () => {
    const stores = marketStores();
    const result = await callNodeTool(stores.env, "get_market_overview", {});
    const meta = (result.structuredContent as unknown as { meta: { dataTime: string; provenance: Provenance[] } }).meta;
    expect(meta.provenance).toEqual([
      { fields: ["indices"], source: "tradingview", dataTime: toCairoIso(INDEX_TIME), timeKind: "trade", stale: false, basis: "primary" },
      { fields: OVERVIEW_MOVER_FIELDS, source: "tradingview", dataTime: meta.dataTime, timeKind: "trade", stale: false, basis: "computed" },
    ]);
  });

  it("builds the indices entry only from the known requested indices", async () => {
    const entries = await provenanceOf(marketStores(), "get_indices", { names: ["EGX30", "EGX99", "EGX30USD"] });
    expect(entries).toEqual([
      { fields: ["indices"], source: "tradingview", dataTime: toCairoIso(INDEX_TIME), timeKind: "trade", stale: false, basis: "primary" },
    ]);
  });

  it("dates the daily summary entries at the session date", async () => {
    const snapshot = marketSnapshot();
    const sessionClose = Math.floor(Date.UTC(2026, 9, 26, 12, 0, 0) / 1000);
    const stores = marketStores({ ...snapshot, indices: { EGX30: { v: 30000, chp: 1, tt: sessionClose, src: "tradingview" } } });
    expect(await provenanceOf(stores, "get_daily_summary", {})).toEqual([
      { fields: ["indices"], source: "tradingview", dataTime: SESSION_DATE, timeKind: "close", stale: false, basis: "primary" },
      { fields: SUMMARY_MOVER_FIELDS, source: "tradingview", dataTime: SESSION_DATE, timeKind: "close", stale: false, basis: "computed" },
    ]);
  });
});

const STATS_AS_OF = "2026-10-26";

function statsFor(sector: boolean): Stats {
  return {
    v: 1,
    asOf: STATS_AS_OF,
    symbols: {
      [ISIN]: {
        h52: 105,
        h52d: "2026-09-01",
        l52: 60,
        l52d: "2026-02-01",
        avgVol20: 500,
        ret: { "1d": sector ? 1 : null, "1w": null, "1m": null, "3m": null, ytd: null, "1y": null },
        pendingAdj: [],
      },
    },
  };
}

describe("daily summary index staleness", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks an index entry closed on an earlier Cairo date as stale with that date", async () => {
    const earlierClose = Math.floor(Date.UTC(2026, 9, 22, 12, 0, 0) / 1000);
    const snapshot: Snapshot = {
      ...marketSnapshot(),
      indices: { EGX30: { v: 30000, chp: 1, tt: earlierClose, src: "tradingview" } },
    };
    const stores = createNodeStores();
    putJson(stores, "directory:v1", DIRECTORY);
    putJson(stores, "snapshot:v1", snapshot);
    putJson(stores, "snapshot:last-session", snapshot);
    const [indices] = await provenanceOf(stores, "get_daily_summary", {});
    expect(indices).toEqual({
      fields: ["indices"],
      source: "tradingview",
      dataTime: "2026-10-22",
      timeKind: "close",
      stale: true,
      basis: "primary",
    });
  });
});

describe("movers, range and sector provenance", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const QUOTE_ENTRY = { fields: ["items"], source: "tradingview", dataTime: toCairoIso(TRADE_TIME), timeKind: "trade", stale: false, basis: "primary" };
  const BARS_ENTRY = { fields: ["items"], source: "stored daily bars", dataTime: STATS_AS_OF, timeKind: "close", stale: false, basis: "computed" };

  function statsStores(sector = true): NodeStores {
    const stores = createNodeStores();
    putJson(stores, "directory:v1", DIRECTORY);
    putJson(stores, "snapshot:v1", { ...snapshotWith(FRESH_TRADE_DATE, false), session: { ...defaultSnapshot().session, date: FRESH_TRADE_DATE } });
    putJson(stores, "stats:v1", statsFor(sector));
    return stores;
  }

  it("gives only the quote entry for a snapshot kind of movers", async () => {
    expect(await provenanceOf(statsStores(), "get_movers", { kind: "gainers" })).toEqual([QUOTE_ENTRY]);
  });

  it("adds the stored bars entry for a stats kind of movers", async () => {
    expect(await provenanceOf(statsStores(), "get_movers", { kind: "near_52w_high" })).toEqual([QUOTE_ENTRY, BARS_ENTRY]);
  });

  it("gives the quote and the stored bars entries for the 52-week range", async () => {
    expect(await provenanceOf(statsStores(), "get_52_week_range", { symbols: ["COMI"] })).toEqual([QUOTE_ENTRY, BARS_ENTRY]);
  });

  it("gives one computed sectors entry for sector performance", async () => {
    expect(await provenanceOf(statsStores(), "get_sector_performance", { period: "1d" })).toEqual([
      { ...BARS_ENTRY, fields: ["sectors"] },
    ]);
  });

  it("is empty when no sector has members", async () => {
    expect(await provenanceOf(statsStores(false), "get_sector_performance", { period: "1d" })).toEqual([]);
  });
});

const SECOND_ISIN = "EGS69101C011";
const PRIMARY_SOURCE = "tradingview";
const FILLED_SOURCE = "tradingview+filled";

const HISTORY_DIRECTORY: Directory = {
  ...DIRECTORY,
  symbols: [
    ...DIRECTORY.symbols,
    [SECOND_ISIN, "ETEL", "المصرية للاتصالات", "Telecom Egypt", "Telecom", "active", "", "telecom egypt", ["etel"]],
  ],
  tickerToIsin: { COMI: ISIN, ETEL: SECOND_ISIN },
};

function seedBar(stores: NodeStores, isin: string, sessionDate: string, source: string): void {
  stores.sqlite
    .prepare(
      `INSERT INTO daily_bars
        (isin, session_date, open, high, low, close, volume, adj_open, adj_high, adj_low, adj_close, source)
       VALUES (?1, ?2, 10, 11, 9, 10, 1000, 10, 11, 9, 10, ?3)`,
    )
    .run(isin, sessionDate, source);
}

describe("history and comparison provenance", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function historyStores(): NodeStores {
    const stores = createNodeStores();
    putJson(stores, "directory:v1", HISTORY_DIRECTORY);
    putJson(stores, "snapshot:v1", snapshotWith(FRESH_TRADE_DATE, false));
    return stores;
  }

  const RANGE = { from: "2026-10-01", to: "2026-10-26" };

  it("gives a primary and a computed bars entry, each at its newest date", async () => {
    const stores = historyStores();
    seedBar(stores, ISIN, "2026-10-20", PRIMARY_SOURCE);
    seedBar(stores, ISIN, "2026-10-22", PRIMARY_SOURCE);
    seedBar(stores, ISIN, "2026-10-21", FILLED_SOURCE);
    expect(await provenanceOf(stores, "get_price_history", { symbol: "COMI", ...RANGE })).toEqual([
      { fields: ["bars"], source: PRIMARY_SOURCE, dataTime: "2026-10-22", timeKind: "close", stale: false, basis: "primary" },
      { fields: ["bars"], source: FILLED_SOURCE, dataTime: "2026-10-21", timeKind: "close", stale: false, basis: "computed" },
    ]);
  });

  it("is empty for an empty page", async () => {
    expect(await provenanceOf(historyStores(), "get_price_history", { symbol: "COMI", ...RANGE })).toEqual([]);
  });

  it("gives one computed entry at the common end date for a comparison", async () => {
    const stores = historyStores();
    for (const date of ["2026-10-14", "2026-10-18", "2026-10-22"]) seedBar(stores, ISIN, date, PRIMARY_SOURCE);
    for (const date of ["2026-10-13", "2026-10-19", "2026-10-20"]) seedBar(stores, SECOND_ISIN, date, PRIMARY_SOURCE);
    const result = await callNodeTool(stores.env, "compare_symbols", { symbols: ["COMI", "ETEL"], ...RANGE });
    const { data, meta } = result.structuredContent as unknown as { data: { commonTo: string }; meta: { provenance: Provenance[] } };
    expect(data.commonTo).toBe("2026-10-18");
    expect(meta.provenance).toEqual([
      {
        fields: ["items", "commonFrom", "commonTo"],
        source: "stored daily bars",
        dataTime: data.commonTo,
        timeKind: "close",
        stale: false,
        basis: "computed",
      },
    ]);
  });
});

const FUND_ID = "fund-1";
const FUND_SOURCE = "mubasher";
const INDEX_SOURCE = "stored index closes";
const FUND_DIRECTORY: Directory = {
  ...EMPTY_DIRECTORY,
  funds: [[FUND_ID, "صندوق اختبار", "Test Fund", null, "EGP", "صندوق اختبار", "test fund"]],
};

function fundEntry(fields: string[], timeKind: string, dataTime: string, source: string, stale = false, basis = "computed"): Provenance {
  return { fields, source, dataTime, timeKind, stale, basis };
}

describe("fund provenance", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function fundStores(): NodeStores {
    const stores = createNodeStores();
    putJson(stores, "directory:v1", FUND_DIRECTORY);
    stores.sqlite
      .prepare(
        `INSERT INTO funds (fund_id, name_ar, name_en, currency, cycle_days, status)
         VALUES (?1, 'صندوق اختبار', 'Test Fund', 'EGP', 1, 'active')`,
      )
      .run(FUND_ID);
    return stores;
  }

  function seedNav(stores: NodeStores, navDate: string, nav: number): void {
    stores.sqlite
      .prepare("INSERT INTO nav_records (fund_id, nav_date, nav, source) VALUES (?1, ?2, ?3, ?4)")
      .run(FUND_ID, navDate, nav, FUND_SOURCE);
  }

  function seedIndex(stores: NodeStores, sessionDate: string, close: number): void {
    stores.sqlite
      .prepare("INSERT INTO index_values (index_code, session_date, close, source) VALUES ('EGX30', ?1, ?2, 'tradingview')")
      .run(sessionDate, close);
  }

  function seedCpi(stores: NodeStores, month: string, cpiIndex: number): void {
    stores.sqlite
      .prepare("INSERT INTO inflation_figures (month, cpi_index, source) VALUES (?1, ?2, 'capmas')")
      .run(month, cpiIndex);
  }

  function seedFundWithNavs(): NodeStores {
    const stores = fundStores();
    seedNav(stores, "2026-09-25", 10);
    seedNav(stores, "2026-10-26", 11);
    return stores;
  }

  async function metaOfCall(stores: NodeStores, name: string, args: Record<string, unknown>) {
    const result = await callNodeTool(stores.env, name, args);
    expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
    return (result.structuredContent as unknown as { meta: { stale: boolean; provenance: Provenance[] } }).meta;
  }

  it("gives a close entry then a computed performance entry for a fund", async () => {
    const { stale, provenance } = await metaOfCall(seedFundWithNavs(), "get_fund", { fund: FUND_ID });
    expect(provenance).toEqual([
      fundEntry(["nav", "navDate"], "close", "2026-10-26", FUND_SOURCE, stale, "primary"),
      fundEntry(["performance"], "close", "2026-10-26", FUND_SOURCE, stale),
    ]);
  });

  it("gives one navs entry at the last NAV date for the fund history", async () => {
    const { stale, provenance } = await metaOfCall(seedFundWithNavs(), "get_fund_history", {
      fund: FUND_ID,
      from: "2026-09-01",
      to: "2026-10-26",
    });
    expect(provenance).toEqual([fundEntry(["navs"], "close", "2026-10-26", FUND_SOURCE, stale, "primary")]);
  });

  it("is empty for an empty fund history page", async () => {
    const { provenance } = await metaOfCall(seedFundWithNavs(), "get_fund_history", {
      fund: FUND_ID,
      from: "2026-01-01",
      to: "2026-01-31",
    });
    expect(provenance).toEqual([]);
  });

  describe("compare_funds", () => {
    function twoFunds(): NodeStores {
      const stores = seedFundWithNavs();
      stores.sqlite
        .prepare(
          `INSERT INTO funds (fund_id, name_ar, name_en, currency, cycle_days, status)
           VALUES ('fund-2', 'صندوق ثان', 'Second Fund', 'EGP', 1, 'active')`,
        )
        .run();
      stores.sqlite.prepare("INSERT INTO nav_records (fund_id, nav_date, nav, source) VALUES ('fund-2', '2026-10-23', 5, ?1)").run(FUND_SOURCE);
      putJson(stores, "directory:v1", {
        ...FUND_DIRECTORY,
        funds: [...FUND_DIRECTORY.funds, ["fund-2", "صندوق ثان", "Second Fund", null, "EGP", "صندوق ثان", "second fund"]],
      });
      return stores;
    }

    const args = { funds: [FUND_ID, "fund-2"], period: "1m", includeEgx30: true };

    it("adds the EGX30 entry at the end close date when closes are seeded", async () => {
      const stores = twoFunds();
      seedIndex(stores, "2026-09-25", 100);
      seedIndex(stores, "2026-10-26", 110);
      const { stale, provenance } = await metaOfCall(stores, "compare_funds", args);
      expect(provenance).toEqual([
        fundEntry(["items"], "close", "2026-10-26", FUND_SOURCE, stale),
        fundEntry(["egx30ReturnPct"], "close", "2026-10-26", INDEX_SOURCE),
      ]);
    });

    it("has no EGX30 entry without closes", async () => {
      const { stale, provenance } = await metaOfCall(twoFunds(), "compare_funds", args);
      expect(provenance).toEqual([fundEntry(["items"], "close", "2026-10-26", FUND_SOURCE, stale)]);
    });

    it("has no EGX30 entry when it is not requested", async () => {
      const stores = twoFunds();
      seedIndex(stores, "2026-09-25", 100);
      seedIndex(stores, "2026-10-26", 110);
      const { provenance } = await metaOfCall(stores, "compare_funds", { ...args, includeEgx30: false });
      expect(provenance.map(({ fields }) => fields)).toEqual([["items"]]);
    });
  });

  describe("get_real_return", () => {
    const RANGE = { from: "2026-09-25", to: "2026-10-26" };

    function withCpi(stores: NodeStores): NodeStores {
      seedCpi(stores, "2026-09", 100);
      seedCpi(stores, "2026-10", 101);
      return stores;
    }

    it("gives the close and period entries for a fund", async () => {
      const { provenance } = await metaOfCall(withCpi(seedFundWithNavs()), "get_real_return", { fund: FUND_ID, ...RANGE });
      expect(provenance).toEqual([
        fundEntry(["nominalPct", "realPct"], "close", "2026-10-26", FUND_SOURCE),
        fundEntry(["inflationPct", "realPct"], "period", "2026-10", "capmas"),
      ]);
    });

    it("uses the stored daily bars source for a symbol", async () => {
      const stores = withCpi(createNodeStores());
      putJson(stores, "directory:v1", DIRECTORY);
      seedBar(stores, ISIN, "2026-09-25", PRIMARY_SOURCE);
      seedBar(stores, ISIN, "2026-10-26", PRIMARY_SOURCE);
      const { provenance } = await metaOfCall(stores, "get_real_return", { symbol: "COMI", ...RANGE });
      expect(provenance[0]).toEqual(fundEntry(["nominalPct", "realPct"], "close", "2026-10-26", "stored daily bars"));
    });

    it("is empty on the not_available branch", async () => {
      const { provenance } = await metaOfCall(seedFundWithNavs(), "get_real_return", { fund: FUND_ID, ...RANGE });
      expect(provenance).toEqual([]);
    });
  });
});

const PROFILE_UPDATED_AT = NOW_SECONDS - 7200;
const FIRST_SOURCE = "mubasher";
const SECOND_SOURCE = "egx";

describe("fundamentals provenance", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function fundamentalsStores(withQuote = true): NodeStores {
    const stores = createNodeStores();
    putJson(stores, "directory:v1", DIRECTORY);
    if (withQuote) putJson(stores, "snapshot:v1", snapshotWith(FRESH_TRADE_DATE, false));
    stores.sqlite
      .prepare("INSERT INTO symbols (isin, ticker, status, created_at, updated_at) VALUES (?1, 'COMI', 'active', 0, ?2)")
      .run(ISIN, PROFILE_UPDATED_AT);
    return stores;
  }

  function seedAction(stores: NodeStores, exDate: string, source: string): void {
    stores.sqlite
      .prepare("INSERT INTO corporate_actions (isin, kind, ex_date, status, source) VALUES (?1, 'cash_dividend', ?2, 'recorded', ?3)")
      .run(ISIN, exDate, source);
  }

  function seedFigure(stores: NodeStores, metric: string, periodEnd: string, source: string): void {
    stores.sqlite
      .prepare(
        `INSERT INTO financial_figures (isin, metric, period_type, period_end, value, currency, source)
         VALUES (?1, ?2, 'FY', ?3, 10, 'EGP', ?4)`,
      )
      .run(ISIN, metric, periodEnd, source);
  }

  function periodEntry(fields: string[], source: string, dataTime: string | null): Provenance {
    return { fields, source, dataTime, timeKind: "period", stale: false, basis: "primary" };
  }

  it("gives one computed symbol master entry for the company profile", async () => {
    expect(await provenanceOf(fundamentalsStores(), "get_company_profile", { symbol: "COMI" })).toEqual([
      {
        fields: ["sector", "market", "sharesOutstanding", "freeFloatShares", "firstTradeDate", "indexCodes", "status"],
        source: "symbol master",
        dataTime: toCairoIso(PROFILE_UPDATED_AT),
        timeKind: "fetched",
        stale: false,
        basis: "computed",
      },
    ]);
  });

  it("gives one period entry per action source at its newest ex-date", async () => {
    const stores = fundamentalsStores();
    seedAction(stores, "2026-11-01", FIRST_SOURCE);
    seedAction(stores, "2026-11-05", FIRST_SOURCE);
    seedAction(stores, "2026-11-03", SECOND_SOURCE);
    expect(await provenanceOf(stores, "get_corporate_actions", { symbol: "COMI" })).toEqual([
      periodEntry(["items"], FIRST_SOURCE, "2026-11-05"),
      periodEntry(["items"], SECOND_SOURCE, "2026-11-03"),
    ]);
  });

  it("gives the same entries for dividends", async () => {
    const stores = fundamentalsStores();
    seedAction(stores, "2026-11-01", FIRST_SOURCE);
    expect(await provenanceOf(stores, "get_dividends", { symbol: "COMI" })).toEqual([
      periodEntry(["items"], FIRST_SOURCE, "2026-11-01"),
    ]);
  });

  it("is empty without actions", async () => {
    expect(await provenanceOf(fundamentalsStores(), "get_corporate_actions", { symbol: "COMI" })).toEqual([]);
  });

  describe("get_financials", () => {
    const RATIOS_ENTRY = {
      fields: ["ratios"],
      source: "tradingview",
      dataTime: toCairoIso(TRADE_TIME),
      timeKind: "trade",
      stale: false,
      basis: "computed",
    };

    function financialStores(withQuote: boolean): NodeStores {
      const stores = fundamentalsStores(withQuote);
      seedFigure(stores, "eps_basic", "2025-12-31", FIRST_SOURCE);
      seedFigure(stores, "revenue", "2024-12-31", FIRST_SOURCE);
      seedFigure(stores, "total_equity", "2025-06-30", SECOND_SOURCE);
      return stores;
    }

    it("gives a period entry per figure source then the ratios entry", async () => {
      expect(await provenanceOf(financialStores(true), "get_financials", { symbol: "COMI" })).toEqual([
        periodEntry(["figures"], FIRST_SOURCE, "2025-12-31"),
        periodEntry(["figures"], SECOND_SOURCE, "2025-06-30"),
        RATIOS_ENTRY,
      ]);
    });

    it("has no ratios entry without a quote", async () => {
      expect(await provenanceOf(financialStores(false), "get_financials", { symbol: "COMI" })).toEqual([
        periodEntry(["figures"], FIRST_SOURCE, "2025-12-31"),
        periodEntry(["figures"], SECOND_SOURCE, "2025-06-30"),
      ]);
    });

    it("has a null data time when every period end is unknown", async () => {
      const stores = fundamentalsStores(false);
      seedFigure(stores, "revenue", "", FIRST_SOURCE);
      expect(await provenanceOf(stores, "get_financials", { symbol: "COMI" })).toEqual([
        periodEntry(["figures"], FIRST_SOURCE, null),
      ]);
    });
  });
});

const UNQUOTED_ISIN = "EGS69101C011";
const EVENT_TIME = NOW_SECONDS - 1800;
const SINCE = "2026-10-26T00:00:00+03:00";

describe("personal tools provenance", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function personalStores(withSnapshot = true): NodeStores {
    const stores = createNodeStores();
    putJson(stores, "directory:v1", DIRECTORY);
    if (withSnapshot) putJson(stores, "snapshot:v1", snapshotWith(FRESH_TRADE_DATE, false));
    return stores;
  }

  function seedHolding(stores: NodeStores, isin: string): void {
    stores.sqlite
      .prepare(
        `INSERT INTO holdings (user_id, isin, quantity, cost_per_share, acquired_on, created_at)
         VALUES ('node-user', ?1, 10, 90, '2026-01-01', 0)`,
      )
      .run(isin);
  }

  function seedLevel(stores: NodeStores, isin: string): void {
    stores.sqlite
      .prepare(
        `INSERT INTO price_levels (user_id, isin, direction, level, armed, last_crossed_at, created_at)
         VALUES ('node-user', ?1, 'below', 200, 1, NULL, 0)`,
      )
      .run(isin);
  }

  function seedEvent(stores: NodeStores, kind = "big_move"): void {
    stores.sqlite
      .prepare("INSERT INTO market_events (kind, occurred_at, isin, fund_id, payload) VALUES (?1, ?2, ?3, NULL, '{}')")
      .run(kind, EVENT_TIME, ISIN);
  }

  describe("portfolio_get", () => {
    it("gives the holdings quote entry then the computed totals entry", async () => {
      const stores = personalStores();
      seedHolding(stores, ISIN);
      seedHolding(stores, UNQUOTED_ISIN);
      expect(await provenanceOf(stores, "portfolio_get", {})).toEqual([
        { fields: ["holdings"], source: "tradingview", dataTime: toCairoIso(TRADE_TIME), timeKind: "trade", stale: false, basis: "primary" },
        {
          fields: ["totals", "allocationBySector", "levelsCrossed"],
          source: "tradingview",
          dataTime: toCairoIso(TRADE_TIME),
          timeKind: "trade",
          stale: false,
          basis: "computed",
        },
      ]);
    });

    it("is empty without a snapshot", async () => {
      const stores = personalStores(false);
      seedHolding(stores, ISIN);
      expect(await provenanceOf(stores, "portfolio_get", {})).toEqual([]);
    });
  });

  describe("what_changed_since", () => {
    it("gives the market events entry with the event time", async () => {
      const stores = personalStores();
      seedEvent(stores);
      expect(await provenanceOf(stores, "what_changed_since", { since: SINCE })).toEqual([
        {
          fields: ["bigMoves", "newListings", "corporateActions"],
          source: "market events",
          dataTime: toCairoIso(EVENT_TIME),
          timeKind: "fetched",
          stale: false,
          basis: "computed",
        },
      ]);
    });

    it("gives the new navs entry when only new_nav events exist", async () => {
      const stores = personalStores();
      seedEvent(stores, "new_nav");
      expect(await provenanceOf(stores, "what_changed_since", { since: SINCE })).toEqual([
        {
          fields: ["newNavs"],
          source: "market events",
          dataTime: toCairoIso(EVENT_TIME),
          timeKind: "fetched",
          stale: false,
          basis: "computed",
        },
      ]);
    });

    it("gives the levels crossed entry from the crossing quotes", async () => {
      const stores = personalStores();
      seedLevel(stores, ISIN);
      expect(await provenanceOf(stores, "what_changed_since", { since: SINCE })).toEqual([
        {
          fields: ["levelsCrossed"],
          source: "tradingview",
          dataTime: toCairoIso(TRADE_TIME),
          timeKind: "trade",
          stale: false,
          basis: "computed",
        },
      ]);
    });

    it("is empty with no events and no crossings", async () => {
      expect(await provenanceOf(personalStores(), "what_changed_since", { since: SINCE })).toEqual([]);
    });
  });

  describe("owner data tools", () => {
    it("gives no entries for the write tools and the level list", async () => {
      const stores = personalStores();
      expect(await provenanceOf(stores, "portfolio_upsert_holding", { symbol: "COMI", quantity: 5, costPerShare: 80, acquiredOn: "2026-01-01" })).toEqual([]);
      expect(await provenanceOf(stores, "portfolio_remove_holding", { id: 1 })).toEqual([]);
      expect(await provenanceOf(stores, "price_level_set", { symbol: "COMI", direction: "above", level: 150 })).toEqual([]);
      expect(await provenanceOf(stores, "price_level_remove", { id: 1 })).toEqual([]);
      expect(await provenanceOf(stores, "price_levels_list", {})).toEqual([]);
    });
  });
});

const FETCHED_AT = NOW_SECONDS - 900;
const EGYPT_SOURCE = "isagha";
const PER_GRAM = "EGP/g";
const POUND_QUOTE = { sell: 50400, buy: 50040 };
const EGYPT_KEY_ORDER = ["gold18k", "gold21k", "gold24k", "goldPound", "silver925", "silver999"];

function metalsSnapshot(withPound: boolean): Snapshot {
  const gold: Record<string, { buy: number; sell: number }> = {
    "18": { buy: 5360, sell: 5400 },
    "21": { buy: 6255, sell: 6300 },
    "24": { buy: 7150, sell: 7200 },
    ...(withPound && { pound: POUND_QUOTE }),
  };
  return {
    ...defaultSnapshot(),
    metals: {
      egypt: {
        src: EGYPT_SOURCE,
        fetchedAt: FETCHED_AT,
        unit: PER_GRAM,
        gold,
        silver: { "925": { buy: 80, sell: 85 }, "999": { buy: 86, sell: 90 } },
      },
    },
  };
}

async function egyptOf(withPound: boolean): Promise<Record<string, unknown>> {
  const stores = createNodeStores();
  putJson(stores, "snapshot:v1", metalsSnapshot(withPound));
  const result = await callNodeTool(stores.env, "get_metals", {});
  expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
  return (result.structuredContent as unknown as { data: { egypt: Record<string, unknown> } }).data.egypt;
}

describe("gold pound in get_metals", () => {
  it("reports the pound per piece after the 24K item", async () => {
    const egypt = await egyptOf(true);
    expect(egypt.goldPound).toEqual({
      buy: 50040,
      sell: 50400,
      unit: "EGP/piece",
      dataTimeKind: "fetched",
      source: EGYPT_SOURCE,
      dataTime: toCairoIso(FETCHED_AT),
    });
    expect(Object.keys(egypt)).toEqual(EGYPT_KEY_ORDER);
  });

  it("keeps the other items per gram", async () => {
    const egypt = await egyptOf(true);
    expect(egypt.gold24k).toMatchObject({ buy: 7150, sell: 7200, unit: PER_GRAM });
    expect(egypt.silver999).toMatchObject({ buy: 86, sell: 90, unit: PER_GRAM });
  });

  it("marks only the pound not available when the snapshot has no pound", async () => {
    const withPound = await egyptOf(true);
    const withoutPound = await egyptOf(false);
    expect(withoutPound.goldPound).toEqual({ status: "not_available", reason: "not available from current sources" });
    expect(withoutPound).toEqual({ ...withPound, goldPound: withoutPound.goldPound });
    expect(Object.keys(withoutPound)).toEqual(EGYPT_KEY_ORDER);
  });
});

const SECONDS_PER_HOUR = 3600;
const SPOT_SOURCE = "tradingview";
const SPOT_UNIT = "USD/oz";
const FX_SOURCE = "tradingview";
const EGYPT_STALE_REASON_PREFIX = "Egypt retail prices fetched at";
const FRESH_SPOT_TIME = NOW_SECONDS - 600;

type MetalsMeta = { stale: boolean; staleReason: string | null; provenance: Provenance[] };

function hoursAgo(hours: number): number {
  return NOW_SECONDS - hours * SECONDS_PER_HOUR;
}

function metalsSnapshotAt(fetchedAt: number | null, spotTime: number | null): Snapshot {
  const base = metalsSnapshot(true);
  const spot = (value: number) => ({ v: value, unit: SPOT_UNIT, tt: spotTime ?? 0, src: SPOT_SOURCE });
  return {
    ...base,
    metals: {
      ...(fetchedAt === null ? {} : { egypt: { ...base.metals.egypt!, fetchedAt } }),
      ...(spotTime === null ? {} : { XAUUSD: spot(4012.5), XAGUSD: spot(48.25) }),
    },
  };
}

async function metalsMetaFor(fetchedAt: number | null, spotTime: number | null): Promise<MetalsMeta> {
  const stores = createNodeStores();
  putJson(stores, "snapshot:v1", metalsSnapshotAt(fetchedAt, spotTime));
  const result = await callNodeTool(stores.env, "get_metals", {});
  expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
  return (result.structuredContent as unknown as { meta: MetalsMeta }).meta;
}

async function fxMetaAt(tickTime: number): Promise<MetalsMeta> {
  const stores = createNodeStores();
  putJson(stores, "snapshot:v1", { ...defaultSnapshot(), fx: { USDEGP: { v: 48.52, tt: tickTime, src: FX_SOURCE, kind: "market" } } });
  const result = await callNodeTool(stores.env, "get_usd_egp", {});
  expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
  return (result.structuredContent as unknown as { meta: MetalsMeta }).meta;
}

describe("metals and fx staleness and provenance", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("get_metals", () => {
    it("is fresh with an egypt entry then a global entry", async () => {
      const meta = await metalsMetaFor(FETCHED_AT, FRESH_SPOT_TIME);
      expect(meta.stale).toBe(false);
      expect(meta.staleReason).toBeNull();
      expect(meta.provenance).toEqual([
        { fields: ["egypt"], source: EGYPT_SOURCE, dataTime: toCairoIso(FETCHED_AT), timeKind: "fetched", stale: false, basis: "primary" },
        { fields: ["global"], source: SPOT_SOURCE, dataTime: toCairoIso(FRESH_SPOT_TIME), timeKind: "trade", stale: false, basis: "primary" },
      ]);
    });

    it("marks egypt retail fetched 27 hours ago stale with the egypt reason", async () => {
      const fetchedAt = hoursAgo(27);
      const meta = await metalsMetaFor(fetchedAt, FRESH_SPOT_TIME);
      expect(meta.stale).toBe(true);
      expect(meta.staleReason).toBe(`${EGYPT_STALE_REASON_PREFIX} ${toCairoIso(fetchedAt)} are older than 26 hours.`);
      expect(meta.provenance.map(({ fields, stale }) => ({ fields, stale }))).toEqual([
        { fields: ["egypt"], stale: true },
        { fields: ["global"], stale: false },
      ]);
    });

    it("marks spots dated 73 hours ago stale with the spot reason", async () => {
      const spotTime = hoursAgo(73);
      const meta = await metalsMetaFor(FETCHED_AT, spotTime);
      expect(meta.stale).toBe(true);
      expect(meta.staleReason).toBe(`Spot prices dated ${toCairoIso(spotTime)} are older than 72 hours.`);
      expect(meta.provenance.map(({ fields, stale }) => ({ fields, stale }))).toEqual([
        { fields: ["egypt"], stale: false },
        { fields: ["global"], stale: true },
      ]);
    });

    it("prefers the egypt reason when both are stale", async () => {
      const fetchedAt = hoursAgo(30);
      const meta = await metalsMetaFor(fetchedAt, hoursAgo(80));
      expect(meta.staleReason).toBe(`${EGYPT_STALE_REASON_PREFIX} ${toCairoIso(fetchedAt)} are older than 26 hours.`);
    });

    it("is not stale at 25 hours for egypt and 71 hours for spots", async () => {
      const meta = await metalsMetaFor(hoursAgo(25), hoursAgo(71));
      expect(meta.stale).toBe(false);
      expect(meta.staleReason).toBeNull();
      expect(meta.provenance.every((entry) => !entry.stale)).toBe(true);
    });

    it("gives only the global entry without egypt prices", async () => {
      const meta = await metalsMetaFor(null, FRESH_SPOT_TIME);
      expect(meta.provenance.map((entry) => entry.fields)).toEqual([["global"]]);
    });

    it("gives only the egypt entry without spots", async () => {
      const meta = await metalsMetaFor(FETCHED_AT, null);
      expect(meta.provenance.map((entry) => entry.fields)).toEqual([["egypt"]]);
    });

    it("is empty with no egypt prices and no spots", async () => {
      const meta = await metalsMetaFor(null, null);
      expect(meta.provenance).toEqual([]);
      expect(meta.stale).toBe(false);
    });
  });

  describe("get_usd_egp", () => {
    it("is fresh with the rate entry", async () => {
      const meta = await fxMetaAt(FRESH_SPOT_TIME);
      expect(meta.stale).toBe(false);
      expect(meta.staleReason).toBeNull();
      expect(meta.provenance).toEqual([
        { fields: ["rate"], source: FX_SOURCE, dataTime: toCairoIso(FRESH_SPOT_TIME), timeKind: "trade", stale: false, basis: "primary" },
      ]);
    });

    it("is stale at 73 hours with the contract reason and a stale rate entry", async () => {
      const tickTime = hoursAgo(73);
      const meta = await fxMetaAt(tickTime);
      expect(meta.stale).toBe(true);
      expect(meta.staleReason).toBe(`The USD/EGP rate dated ${toCairoIso(tickTime)} is older than 72 hours.`);
      expect(meta.provenance).toEqual([
        { fields: ["rate"], source: FX_SOURCE, dataTime: toCairoIso(tickTime), timeKind: "trade", stale: true, basis: "primary" },
      ]);
    });

    it("is not stale at 71 hours", async () => {
      const meta = await fxMetaAt(hoursAgo(71));
      expect(meta.stale).toBe(false);
    });
  });
});
