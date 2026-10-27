import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { snapshotJob } from "../../src/jobs/snapshot";
import type { QuoteEntry, Snapshot } from "../../src/store/kv";
import mubasherPrices from "../fixtures/mubasher-prices-all.json";
import tradingViewScan from "../fixtures/tradingview-egypt-scan.json";
import tradingViewGlobalScan from "../fixtures/tradingview-global-scan.json";
import { restoreBindings, setBindings } from "../helpers/bindings";
import {
  clearStores,
  createJobRunner,
  failingUpstream,
  fixtureResponse,
  notFound,
  readNotices,
  requestUrl,
} from "../helpers/jobs";
import type { Upstream } from "../helpers/jobs";
import {
  DIRECTORY_KEY,
  LAST_SESSION_KEY,
  seedCalendar,
  seedDirectory,
  seedSnapshot,
  seedSymbols,
  SNAPSHOT_KEY,
  stockSymbol,
  syntheticIsin,
  syntheticTicker,
} from "../helpers/seed";
import { MS_PER_SECOND, cairoSummerEpoch } from "../helpers/time";

const FIXTURE_EGX30_CLOSE = 49234.3;
const SESSION_DATE = "2026-10-25";
const FRIDAY = "2026-10-23";
const PREVIOUS_SESSION_DATE = "2026-10-22";
const PREVIOUS_SESSION_TIME = cairoSummerEpoch(PREVIOUS_SESSION_DATE, "10:00");
const MUBASHER_COMI_TIME = Date.UTC(2026, 9, 25, 11, 29, 51) / MS_PER_SECOND;
const DEFAULT_RUN_TIME = "10:30";
const STORE_TABLES = ["notices", "market_calendar"];
const SKIPPED_OUTSIDE_WINDOW = "skipped: outside window";
const TRADINGVIEW = "tradingview";
const MUBASHER = "mubasher";
const TRADINGVIEW_SCAN_URL = "https://scanner.tradingview.com/egypt/scan";
const TRADINGVIEW_INDEX_URL = "https://scanner.tradingview.com/global/scan";
const MUBASHER_PRICES_URL = "https://www.mubasher.info/api/1/stocks/prices/all";
const TRADE_DATE_COLUMN = 12;
const COMI_ISIN = "EGS60121C018";
const ETEL_ISIN = "EGS48031C016";
const EAST_ISIN = "EGS37091C013";
const UNMAPPED_TICKER = "ISMA";
const MAPPED_ISINS = [COMI_ISIN, EAST_ISIN, ETEL_ISIN].sort();
const TICKER_TO_ISIN = { COMI: COMI_ISIN, ETEL: ETEL_ISIN, EAST: EAST_ISIN };
const SPECIAL_HOURS = { date: SESSION_DATE, kind: "special_hours", openTime: "11:00", closeTime: "13:30" } as const;
const HOLIDAY = { date: SESSION_DATE, kind: "holiday" } as const;
const TOP_SIZE = 10;
const ADVANCER_COUNT = 12;
const DECLINER_COUNT = 12;
const UNCHANGED_COUNT = 2;
const UNCHANGED_FIRST_INDEX = ADVANCER_COUNT + DECLINER_COUNT + 1;
const STALE_PROVIDER_INDEX = UNCHANGED_FIRST_INDEX + UNCHANGED_COUNT;
const CARRIED_INDEX = STALE_PROVIDER_INDEX + 1;
const CARRIED_TODAY_INDEX = CARRIED_INDEX + 1;
const MOVER_STEP_PCT = 0.5;
const VOLUME_STEP = 1000;
const VALUE_STEP = 100_000;
const VALUE_CEILING = 30;
const UNCHANGED_VOLUME_FACTOR = 2;
const UNCHANGED_VALUE = 5000;
const SESSION_TRADE_TIME = cairoSummerEpoch(SESSION_DATE, "10:00");
const STALE_ROW: MarketRow = {
  index: STALE_PROVIDER_INDEX,
  changePct: 99,
  volume: 50_000_000,
  value: 9_000_000_000,
  sessionTime: PREVIOUS_SESSION_TIME,
};
const CARRIED_TODAY_ROW: MarketRow = {
  index: CARRIED_TODAY_INDEX,
  changePct: 40,
  volume: 90_000_000,
  value: 8_000_000_000,
};
const SESSION_QUOTE_TIME = cairoSummerEpoch(SESSION_DATE, "10:25");
const INDEX_STEP = "indices";

type MarketRow = { index: number; changePct: number; volume: number; value: number; sessionTime?: number };

type Upstreams = { tradingView: Upstream; mubasher: Upstream; indices: Upstream };

function scanWithTradeDate(sessionTime: number) {
  return {
    ...tradingViewScan,
    data: tradingViewScan.data.map((row) => ({
      ...row,
      d: row.d.map((value, index) => (index === TRADE_DATE_COLUMN ? sessionTime : value)),
    })),
  };
}

function pricesFor(tickers: string[]) {
  return { ...mubasherPrices, prices: mubasherPrices.prices.filter((price) => tickers.includes(price.code)) };
}

function stubFetch(upstreams: Partial<Upstreams> = {}) {
  const stub = vi.fn(async (input: RequestInfo | URL) => {
    const url = requestUrl(input);
    if (url.startsWith(TRADINGVIEW_SCAN_URL)) return (upstreams.tradingView ?? fixtureResponse(tradingViewScan))();
    if (url.startsWith(TRADINGVIEW_INDEX_URL)) return (upstreams.indices ?? fixtureResponse(tradingViewGlobalScan))();
    if (url.startsWith(MUBASHER_PRICES_URL)) return (upstreams.mubasher ?? fixtureResponse(mubasherPrices))();
    return notFound();
  });
  vi.stubGlobal("fetch", stub);
  return stub;
}

function range(first: number, count: number): number[] {
  return Array.from({ length: count }, (_, offset) => first + offset);
}

function descending(first: number, count: number): number[] {
  return range(first - count + 1, count).reverse();
}

function isinsOf(indexes: number[]): string[] {
  return indexes.map(syntheticIsin);
}

function moverRow(index: number, changePct: number): MarketRow {
  return { index, changePct, volume: index * VOLUME_STEP, value: (VALUE_CEILING - index) * VALUE_STEP };
}

function marketRows(): MarketRow[] {
  const advancers = range(1, ADVANCER_COUNT).map((index) => moverRow(index, index * MOVER_STEP_PCT));
  const decliners = range(ADVANCER_COUNT + 1, DECLINER_COUNT).map((index) =>
    moverRow(index, -(index - ADVANCER_COUNT) * MOVER_STEP_PCT),
  );
  const unchanged = range(UNCHANGED_FIRST_INDEX, UNCHANGED_COUNT).map((index) => ({
    index,
    changePct: 0,
    volume: index * VOLUME_STEP * UNCHANGED_VOLUME_FACTOR,
    value: UNCHANGED_VALUE,
  }));
  return [...advancers, ...decliners, ...unchanged];
}

function marketScan(rows: MarketRow[]) {
  return {
    totalCount: rows.length,
    data: rows.map(({ index, changePct, volume, value, sessionTime = SESSION_TRADE_TIME }) => {
      const ticker = syntheticTicker(index);
      return {
        s: `EGX:${ticker}`,
        d: [
          ticker,
          ticker,
          syntheticIsin(index),
          "Banks",
          10,
          10,
          10,
          10,
          changePct,
          changePct / 10,
          volume,
          value,
          sessionTime,
          SESSION_QUOTE_TIME,
          "stock",
          null,
          null,
        ],
      };
    }),
  };
}

async function seedMarketDirectory(): Promise<void> {
  const symbols = range(1, CARRIED_TODAY_INDEX).map((index) => stockSymbol(syntheticIsin(index), syntheticTicker(index)));
  await seedSymbols(symbols);
}

function createRunner() {
  return createJobRunner(snapshotJob, { date: SESSION_DATE, time: DEFAULT_RUN_TIME });
}

function carriedQuote(row: MarketRow, tradeDate: string): QuoteEntry {
  return {
    ...quoteEntry(syntheticTicker(row.index), 10, tradeDate),
    chp: row.changePct,
    v: row.volume,
    val: row.value,
  };
}

function quoteEntry(ticker: string, price: number, tradeDate: string): QuoteEntry {
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
    val: null,
    tt: PREVIOUS_SESSION_TIME,
    td: tradeDate,
    src: TRADINGVIEW,
  };
}

async function readSnapshot(): Promise<Snapshot> {
  const snapshot = await env.DATA.get<Snapshot>(SNAPSHOT_KEY, { type: "json" });
  if (!snapshot) throw new Error("snapshot not written");
  return snapshot;
}

describe("snapshotJob", () => {
  beforeEach(async () => {
    setBindings({ STOCK_PROVIDERS: "tradingview,mubasher", SNAPSHOT_EVERY_MINUTES: "1" });
    await clearStores([SNAPSHOT_KEY, LAST_SESSION_KEY, DIRECTORY_KEY], STORE_TABLES);
    await seedDirectory({ tickerToIsin: TICKER_TO_ISIN });
  });

  afterEach(() => {
    restoreBindings();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe("session window", () => {
    it.each([
      ["a Friday", FRIDAY, "10:30"],
      ["15:00 Cairo", SESSION_DATE, "15:00"],
      ["09:54 Cairo", SESSION_DATE, "09:54"],
      ["14:46 Cairo", SESSION_DATE, "14:46"],
    ])("skips without a fetch or a KV write on %s", async (_label, date, time) => {
      const fetchStub = stubFetch();
      const runner = createRunner();

      expect(await runner.run(time, date)).toBe(SKIPPED_OUTSIDE_WINDOW);
      expect(fetchStub).not.toHaveBeenCalled();
      expect(runner.kvWrites).toEqual([]);
    });

    it("skips on a holiday calendar row without a stock or index fetch", async () => {
      await seedCalendar([HOLIDAY]);
      const fetchStub = stubFetch();
      const runner = createRunner();

      expect(await runner.run()).toBe(SKIPPED_OUTSIDE_WINDOW);
      expect(fetchStub).not.toHaveBeenCalled();
      expect(runner.kvWrites).toEqual([]);
    });

    it.each(["09:55", "14:45"])("fetches at the inclusive bound %s Cairo", async (time) => {
      const fetchStub = stubFetch();
      const runner = createRunner();

      await runner.run(time);

      expect(fetchStub).toHaveBeenCalled();
      expect(runner.kvWrites).toContain(SNAPSHOT_KEY);
    });
  });

  describe("cadence of 2 minutes", () => {
    beforeEach(() => {
      setBindings({ SNAPSHOT_EVERY_MINUTES: "2" });
    });

    it("skips an odd minute and runs an even one", async () => {
      const fetchStub = stubFetch();
      const runner = createRunner();

      await runner.run("10:31");
      expect(fetchStub).not.toHaveBeenCalled();
      expect(runner.kvWrites).toEqual([]);

      await runner.run("10:30");
      expect(fetchStub).toHaveBeenCalled();
    });

    it("runs the window-end minute 14:45 and writes the last session snapshot", async () => {
      stubFetch();
      const runner = createRunner();

      await runner.run("14:45");

      expect(runner.kvWrites).toContain(SNAPSHOT_KEY);
      expect(runner.kvWrites).toContain(LAST_SESSION_KEY);
    });

    it("runs the window-end minute 13:45 on a special hours day ending 13:30", async () => {
      await seedCalendar([SPECIAL_HOURS]);
      const fetchStub = stubFetch();
      const runner = createRunner();

      await runner.run("13:43");
      expect(fetchStub).not.toHaveBeenCalled();

      await runner.run("13:45");
      expect(fetchStub).toHaveBeenCalled();
      expect(runner.kvWrites).toContain(SNAPSHOT_KEY);
    });
  });

  describe("primary provider serving", () => {
    it("keys quotes by ISIN, drops unmapped tickers and records the source", async () => {
      stubFetch();
      const runner = createRunner();

      await runner.run();
      const snapshot = await readSnapshot();

      expect(Object.keys(snapshot.quotes).sort()).toEqual(MAPPED_ISINS);
      expect(Object.values(snapshot.quotes).map((entry) => entry.t)).not.toContain(UNMAPPED_TICKER);
      expect(snapshot.sources).toMatchObject({ stocks: TRADINGVIEW, primaryFailed: false });
      expect(snapshot.delay).toEqual({ label: "delayed", minutes: 15 });
      expect(snapshot.session).toMatchObject({ date: SESSION_DATE, status: "open", noTradesToday: false });
      expect(snapshot.quotes[COMI_ISIN]).toMatchObject({
        t: "COMI",
        p: 122.03,
        o: 125.15,
        h: 125.2,
        l: 121.51,
        v: 1846236,
        val: 225296179.08,
        tt: 1792927792,
        td: SESSION_DATE,
        src: TRADINGVIEW,
      });
      expect(snapshot.quotes[COMI_ISIN]?.pc).toBeCloseTo(125.15, 6);
      expect(snapshot.quotes[COMI_ISIN]?.ch).toBeCloseTo(-3.12, 6);
      expect(snapshot.quotes[COMI_ISIN]?.chp).toBeCloseTo(-2.493, 3);
      expect(await readNotices("job_failed")).toEqual([]);
      expect(await readNotices("source_switched")).toEqual([]);
    });

    it("writes once when the same content is fetched twice", async () => {
      stubFetch();
      const runner = createRunner();

      await runner.run();
      await runner.run("10:31");

      expect(runner.kvWrites.filter((key) => key === SNAPSHOT_KEY)).toHaveLength(1);
    });
  });

  describe("backup provider serving", () => {
    it("serves the backup quotes with the primary failure recorded and issues no symbol_aliases read", async () => {
      stubFetch({ tradingView: failingUpstream });
      const runner = createRunner();

      await runner.run();
      const snapshot = await readSnapshot();

      expect(snapshot.sources).toMatchObject({ stocks: MUBASHER, primaryFailed: true });
      expect(snapshot.sources.primaryError).toEqual(expect.any(String));
      expect(snapshot.delay).toEqual({ label: "delayed", minutes: null });
      expect(Object.keys(snapshot.quotes).sort()).toEqual(MAPPED_ISINS);
      expect(Object.values(snapshot.quotes).every((entry) => entry.src === MUBASHER)).toBe(true);
      expect(snapshot.quotes[COMI_ISIN]).toMatchObject({
        t: "COMI",
        p: 122.03,
        o: 125.15,
        h: 125.2,
        l: 121.51,
        v: 1846236,
        val: 227167344,
        tt: MUBASHER_COMI_TIME,
        td: SESSION_DATE,
      });
      expect(snapshot.quotes[COMI_ISIN]?.pc).toBeCloseTo(125.15, 6);
      expect(snapshot.quotes[COMI_ISIN]?.ch).toBeCloseTo(-3.12, 6);
      expect(snapshot.quotes[COMI_ISIN]?.chp).toBeCloseTo(-2.49, 2);

      const failures = await readNotices("job_failed");
      expect(failures).toHaveLength(1);
      expect(failures[0]?.details).toMatchObject({ job: "snapshot", source: TRADINGVIEW });
      expect(await readNotices("source_switched")).toHaveLength(1);
      expect(runner.statements.filter((sql) => sql.includes("symbol_aliases"))).toEqual([]);
    });

    it("raises one source_switched notice for two runs on the same day", async () => {
      stubFetch({ tradingView: failingUpstream });
      const runner = createRunner();

      await runner.run();
      await runner.run("10:31");

      expect(await readNotices("source_switched")).toHaveLength(1);
    });

    it("keeps the previous quote and its trade date for tickers the backup misses", async () => {
      const previousComi = quoteEntry("COMI", 100, PREVIOUS_SESSION_DATE);
      const previousEtel = quoteEntry("ETEL", 120, PREVIOUS_SESSION_DATE);
      await seedSnapshot({ quotes: { [COMI_ISIN]: previousComi, [ETEL_ISIN]: previousEtel } });
      stubFetch({ tradingView: failingUpstream, mubasher: fixtureResponse(pricesFor(["COMI"])) });
      const runner = createRunner();

      await runner.run();
      const snapshot = await readSnapshot();

      expect(snapshot.quotes[COMI_ISIN]).toMatchObject({ p: 122.03, td: SESSION_DATE, src: MUBASHER });
      expect(snapshot.quotes[ETEL_ISIN]).toEqual(previousEtel);
    });
  });

  describe("every provider empty", () => {
    it("keeps the previous snapshot unchanged and raises job_failed for each provider", async () => {
      const previous = await seedSnapshot({
        quotes: { [COMI_ISIN]: quoteEntry("COMI", 100, PREVIOUS_SESSION_DATE) },
      });
      stubFetch({
        tradingView: fixtureResponse({ totalCount: 0, data: [] }),
        mubasher: fixtureResponse({ lastUpdate: "2026-10-25 07:30:00", prices: [] }),
      });
      const runner = createRunner();

      await runner.run();

      expect(await readSnapshot()).toEqual(previous);
      expect(runner.kvWrites).not.toContain(SNAPSHOT_KEY);
      const failures = await readNotices("job_failed");
      expect(failures.map((notice) => notice.details.source).sort()).toEqual([MUBASHER, TRADINGVIEW]);
    });
  });

  describe("a trading day with no trades (holiday missing from the table)", () => {
    const staleScan = () => fixtureResponse(scanWithTradeDate(PREVIOUS_SESSION_TIME));

    it.each(["10:30", "12:00"])("sets noTradesToday and closes the session at %s Cairo", async (time) => {
      stubFetch({ tradingView: staleScan() });
      const runner = createRunner();

      await runner.run(time);

      expect((await readSnapshot()).session).toMatchObject({ noTradesToday: true, status: "closed" });
    });

    it("keeps the flag false at 10:29 Cairo", async () => {
      stubFetch({ tradingView: staleScan() });
      const runner = createRunner();

      await runner.run("10:29");

      expect((await readSnapshot()).session).toMatchObject({ noTradesToday: false, status: "open" });
    });

    it("keeps the flag false when a quote has today as its trade date", async () => {
      stubFetch();
      const runner = createRunner();

      await runner.run();

      expect((await readSnapshot()).session.noTradesToday).toBe(false);
    });

    it("moves the threshold to 11:30 on a special hours day opening at 11:00", async () => {
      await seedCalendar([SPECIAL_HOURS]);
      stubFetch({ tradingView: staleScan() });
      const runner = createRunner();

      await runner.run("11:29");
      expect((await readSnapshot()).session.noTradesToday).toBe(false);

      await runner.run("11:30");
      expect((await readSnapshot()).session).toMatchObject({ noTradesToday: true, status: "closed" });
    });
  });

  describe("market aggregates", () => {
    const rows = marketRows();

    async function runMarket(): Promise<Snapshot> {
      await seedMarketDirectory();
      await seedSnapshot({
        quotes: {
          [syntheticIsin(CARRIED_INDEX)]: carriedQuote({ ...STALE_ROW, index: CARRIED_INDEX }, PREVIOUS_SESSION_DATE),
          [syntheticIsin(CARRIED_TODAY_INDEX)]: carriedQuote(CARRIED_TODAY_ROW, SESSION_DATE),
        },
      });
      stubFetch({ tradingView: fixtureResponse(marketScan([...rows, STALE_ROW])) });
      await createRunner().run();
      return readSnapshot();
    }

    it("counts advancers, decliners and unchanged quotes of today and excludes older trade dates", async () => {
      const snapshot = await runMarket();

      expect(snapshot.breadth).toEqual({
        advancers: ADVANCER_COUNT + 1,
        decliners: DECLINER_COUNT,
        unchanged: UNCHANGED_COUNT,
      });
    });

    it("sums volume and value of today's quotes only", async () => {
      const snapshot = await runMarket();

      expect(snapshot.totals).toEqual({
        volume: [...rows, CARRIED_TODAY_ROW].reduce((sum, row) => sum + row.volume, 0),
        value: [...rows, CARRIED_TODAY_ROW].reduce((sum, row) => sum + row.value, 0),
      });
    });

    it("lists ten ISINs each by change percent, volume and value", async () => {
      const snapshot = await runMarket();

      const carried = syntheticIsin(CARRIED_TODAY_INDEX);

      expect(snapshot.top.gainers).toEqual([carried, ...isinsOf(descending(ADVANCER_COUNT, TOP_SIZE - 1))]);
      expect(snapshot.top.losers).toEqual(isinsOf(descending(ADVANCER_COUNT + DECLINER_COUNT, TOP_SIZE)));
      expect(snapshot.top.byVolume).toEqual([
        carried,
        ...isinsOf(descending(UNCHANGED_FIRST_INDEX + UNCHANGED_COUNT - 1, TOP_SIZE - 1)),
      ]);
      expect(snapshot.top.byValue).toEqual([carried, ...isinsOf(range(1, TOP_SIZE - 1))]);
    });
  });

  describe("indices", () => {
    const previousIndices = { EGX30: { v: 50000, chp: 1, tt: PREVIOUS_SESSION_TIME, src: TRADINGVIEW } };

    it("stores the four provider indices with value, change percent, time and source", async () => {
      const fetchStub = stubFetch();
      const runner = createRunner();

      await runner.run();
      const { indices } = await readSnapshot();

      expect(fetchStub.mock.calls.map(([input]) => requestUrl(input))).toContain(TRADINGVIEW_INDEX_URL);
      expect(Object.keys(indices).sort()).toEqual(["EGX100EWI", "EGX30", "EGX30CAPPED", "EGX70EWI"]);
      expect(indices.EGX30).toMatchObject({ v: FIXTURE_EGX30_CLOSE, tt: 1792927799, src: TRADINGVIEW });
      expect(indices.EGX30?.chp).toBeCloseTo(-3.561, 3);
      expect(await readNotices("job_failed")).toEqual([]);
    });

    it("keeps the previous indices and raises job_failed when the index provider fails", async () => {
      await seedSnapshot({ indices: previousIndices });
      stubFetch({ indices: failingUpstream });
      const runner = createRunner();

      await runner.run();
      const snapshot = await readSnapshot();

      expect(snapshot.indices).toEqual(previousIndices);
      expect(Object.keys(snapshot.quotes).sort()).toEqual(MAPPED_ISINS);
      const failures = await readNotices("job_failed");
      expect(failures).toHaveLength(1);
      expect(failures[0]?.details).toMatchObject({ job: "snapshot", step: INDEX_STEP, source: TRADINGVIEW });
    });
  });
});
