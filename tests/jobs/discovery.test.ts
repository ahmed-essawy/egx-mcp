import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endOfDayJob } from "../../src/jobs/end-of-day";
import { scheduled } from "../../src/jobs/dispatch";
import { snapshotJob } from "../../src/jobs/snapshot";
import { __resetKvMemo } from "../../src/store/kv";
import type { QuoteEntry } from "../../src/store/kv";
import mubasherListed from "../fixtures/mubasher-listed-p1.json";
import mubasherPrices from "../fixtures/mubasher-prices-all.json";
import tradingViewGlobalScan from "../fixtures/tradingview-global-scan.json";
import tradingViewScan from "../fixtures/tradingview-egypt-scan.json";
import { restoreBindings, setBindings } from "../helpers/bindings";
import {
  bindMember,
  clearStores,
  createJobRunner,
  failingUpstream,
  firstPageOnly,
  fixtureResponse,
  notFound,
  readNotices,
  requestUrl,
} from "../helpers/jobs";
import type { PageUpstream, Upstream } from "../helpers/jobs";
import {
  DIRECTORY_KEY,
  LAST_SESSION_KEY,
  SNAPSHOT_KEY,
  defaultSnapshot,
  seedBars,
  seedCalendar,
  seedDirectory,
  seedSnapshot,
  setNow,
} from "../helpers/seed";
import { MS_PER_SECOND, cairoSummerEpoch } from "../helpers/time";

const TODAY = "2026-10-25";
const FIRST_DAY = "2026-10-26";
const TRADING_DAYS = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-11-01"];
const RUN_TIME = "16:30";
const LATER_RUN_TIME = "16:31";
const SNAPSHOT_RUN_TIME = "10:30";
const BOOTSTRAP_RUN_TIME = "09:00";
const END_OF_DAY_JOB = "end_of_day";
const LISTING_SYNC_STEP = "listingSync";
const UNHANDLED_STEP = "unhandled";
const STATS_KEY = "stats:v1";
const KV_KEYS = [SNAPSHOT_KEY, LAST_SESSION_KEY, STATS_KEY, DIRECTORY_KEY];
const STORE_TABLES = [
  "symbols",
  "symbol_aliases",
  "job_state",
  "notices",
  "market_calendar",
  "market_events",
  "daily_bars",
  "index_values",
  "source_discrepancies",
];
const TRADINGVIEW_SCAN_URL = "https://scanner.tradingview.com/egypt/scan";
const TRADINGVIEW_INDEX_URL = "https://scanner.tradingview.com/global/scan";
const MUBASHER_LISTED_URL = "https://www.mubasher.info/api/1/listed-companies";
const MUBASHER_PRICES_URL = "https://www.mubasher.info/api/1/stocks/prices/all";
const END_OF_DAY_CRON = "30 12,13 * * SUN-THU";
const SNAPSHOT_CRON = "* 6-12 * * SUN-THU";
const NAME_COLUMN = 0;
const COMI_TICKER = "COMI";
const ISMA_TICKER = "ISMA";
const COMI_ISIN = "EGS60121C018";
const ISMA_ISIN = "EGS02021C011";
const MISSING_LIMIT = 5;
const MIDWAY_MISSING = 3;
const SYMBOL_WRITES_TABLE = "symbol_writes";
const UNHANDLED_MESSAGE = "job state exploded";
const NOTICES_INSERT = "INSERT INTO notices";
const JOB_STATE_RUN_INSERT = "INSERT INTO job_state (job, last_run_date)";
const LISTED_COUNT = tradingViewScan.data.length;
const COMI_QUOTE: QuoteEntry = {
  t: COMI_TICKER,
  p: 122.03,
  o: 124,
  h: 125,
  l: 121,
  pc: 125.14,
  ch: -3.11,
  chp: -2.49,
  v: 1000,
  val: 122030,
  tt: cairoSummerEpoch(FIRST_DAY, "14:30"),
  td: FIRST_DAY,
  src: "tradingview",
};

type Scan = typeof tradingViewScan;
type Listed = typeof mubasherListed;
type Upstreams = { tradingView: Upstream; listed: PageUpstream };
type SymbolRow = { isin: string; ticker: string; status: string; missing_sessions: number };
type EventRow = { isin: string | null; occurred_at: number };

function scanWithout(ticker: string): Scan {
  return { ...tradingViewScan, data: tradingViewScan.data.filter((row) => row.d[NAME_COLUMN] !== ticker) };
}

function listedWithout(ticker: string): Listed {
  return { ...mubasherListed, rows: mubasherListed.rows.filter((row) => row.symbol !== ticker) };
}

function stubFetch(upstreams: Partial<Upstreams> = {}) {
  const stub = vi.fn(async (input: RequestInfo | URL) => {
    const url = requestUrl(input);
    if (url.startsWith(TRADINGVIEW_SCAN_URL)) return (upstreams.tradingView ?? fixtureResponse(tradingViewScan))();
    if (url.startsWith(TRADINGVIEW_INDEX_URL)) return fixtureResponse(tradingViewGlobalScan)();
    if (url.startsWith(MUBASHER_PRICES_URL)) return fixtureResponse(mubasherPrices)();
    if (url.startsWith(MUBASHER_LISTED_URL)) {
      const page = Number(new URL(url).searchParams.get("page"));
      return (upstreams.listed ?? firstPageOnly(mubasherListed))(page);
    }
    return notFound();
  });
  vi.stubGlobal("fetch", stub);
  return stub;
}

function withoutListing(ticker: string): Partial<Upstreams> {
  return {
    tradingView: fixtureResponse(scanWithout(ticker)),
    listed: firstPageOnly(listedWithout(ticker)),
  };
}

function createRunner() {
  return createJobRunner(endOfDayJob, { date: TODAY, time: RUN_TIME });
}

async function readSymbols(): Promise<SymbolRow[]> {
  const { results } = await env.DB
    .prepare("SELECT isin, ticker, status, missing_sessions FROM symbols ORDER BY isin")
    .all<SymbolRow>();
  return results;
}

async function readSymbol(isin: string): Promise<SymbolRow> {
  const symbol = (await readSymbols()).find((row) => row.isin === isin);
  if (!symbol) throw new Error(`no symbol ${isin}`);
  return symbol;
}

async function readListingEvents(): Promise<EventRow[]> {
  const { results } = await env.DB
    .prepare("SELECT isin, occurred_at FROM market_events WHERE kind = 'new_listing' ORDER BY id")
    .all<EventRow>();
  return results;
}

async function countBars(isin: string): Promise<number> {
  const row = await env.DB
    .prepare("SELECT COUNT(*) AS total FROM daily_bars WHERE isin = ?1")
    .bind(isin)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

async function setSymbolState(isin: string, status: string, missingSessions: number): Promise<void> {
  await env.DB
    .prepare("UPDATE symbols SET status = ?2, missing_sessions = ?3 WHERE isin = ?1")
    .bind(isin, status, missingSessions)
    .run();
}

async function deleteSymbol(isin: string): Promise<void> {
  await env.DB.prepare("DELETE FROM symbols WHERE isin = ?1").bind(isin).run();
}

async function listingSyncFailures() {
  return (await readNotices("job_failed")).filter((notice) => notice.details.step === LISTING_SYNC_STEP);
}

async function bootstrap(): Promise<void> {
  stubFetch();
  await createRunner().run(RUN_TIME, TODAY);
  vi.unstubAllGlobals();
}

async function runDay(date: string, upstreams: Partial<Upstreams> = {}) {
  stubFetch(upstreams);
  const runner = createRunner();
  await runner.run(RUN_TIME, date);
  vi.unstubAllGlobals();
  return runner;
}

async function startSymbolWriteLog(): Promise<void> {
  await env.DB.prepare(`CREATE TABLE ${SYMBOL_WRITES_TABLE} (isin TEXT NOT NULL)`).run();
  await env.DB
    .prepare(
      `CREATE TRIGGER ${SYMBOL_WRITES_TABLE}_update AFTER UPDATE ON symbols
       BEGIN INSERT INTO ${SYMBOL_WRITES_TABLE} (isin) VALUES (new.isin); END`,
    )
    .run();
  await env.DB
    .prepare(
      `CREATE TRIGGER ${SYMBOL_WRITES_TABLE}_insert AFTER INSERT ON symbols
       BEGIN INSERT INTO ${SYMBOL_WRITES_TABLE} (isin) VALUES (new.isin); END`,
    )
    .run();
}

async function stopSymbolWriteLog(): Promise<void> {
  await env.DB.prepare(`DROP TRIGGER IF EXISTS ${SYMBOL_WRITES_TABLE}_update`).run();
  await env.DB.prepare(`DROP TRIGGER IF EXISTS ${SYMBOL_WRITES_TABLE}_insert`).run();
  await env.DB.prepare(`DROP TABLE IF EXISTS ${SYMBOL_WRITES_TABLE}`).run();
}

async function readSymbolWrites(): Promise<string[]> {
  const { results } = await env.DB.prepare(`SELECT isin FROM ${SYMBOL_WRITES_TABLE}`).all<{ isin: string }>();
  return results.map((row) => row.isin);
}

function failingEnv(failingSql: string[]): Env {
  const db = new Proxy(env.DB, {
    get(target, property) {
      if (property !== "prepare") return bindMember(target, property);
      return (sql: string) => {
        if (failingSql.some((prefix) => sql.includes(prefix))) throw new Error(UNHANDLED_MESSAGE);
        return target.prepare(sql);
      };
    },
  });
  return Object.create(env, { DB: { value: db } }) as Env;
}

function cronController(cron: string, date: string, time: string): ScheduledController {
  return {
    cron,
    scheduledTime: cairoSummerEpoch(date, time) * MS_PER_SECOND,
    type: "scheduled",
    noRetry: () => undefined,
  } as ScheduledController;
}

function collectingContext() {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => {
      pending.push(promise);
    },
    passThroughOnException: () => undefined,
  } as unknown as ExecutionContext;
  return { ctx, settled: () => Promise.all(pending) };
}

describe("listing discovery", () => {
  beforeEach(async () => {
    setBindings({ STOCK_PROVIDERS: "tradingview,mubasher", SNAPSHOT_EVERY_MINUTES: "1" });
    await clearStores(KV_KEYS, STORE_TABLES);
  });

  afterEach(async () => {
    await stopSymbolWriteLog();
    restoreBindings();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("new listings", () => {
    it("raises no notice for the first fill of an empty master", async () => {
      await bootstrap();

      expect(await readNotices("new_listing")).toEqual([]);
      expect(await readListingEvents()).toEqual([]);
      expect((await readSymbols()).every((symbol) => symbol.status === "active")).toBe(true);
    });

    it("inserts an unknown ISIN as pending with one notice and one event the same day", async () => {
      await bootstrap();
      await deleteSymbol(COMI_ISIN);

      await runDay(FIRST_DAY);

      expect(await readSymbol(COMI_ISIN)).toEqual({
        isin: COMI_ISIN,
        ticker: COMI_TICKER,
        status: "pending",
        missing_sessions: 0,
      });
      expect(await readSymbols()).toHaveLength(LISTED_COUNT);
      const notices = await readNotices("new_listing");
      expect(notices).toHaveLength(1);
      expect(JSON.stringify(notices[0])).toContain(COMI_TICKER);
      expect(await readListingEvents()).toEqual([
        { isin: COMI_ISIN, occurred_at: cairoSummerEpoch(FIRST_DAY, RUN_TIME) },
      ]);
    });

    it("raises the new_listing notice once and keeps the symbol pending on later runs", async () => {
      await bootstrap();
      await deleteSymbol(COMI_ISIN);
      await runDay(FIRST_DAY);

      await runDay(TRADING_DAYS[1] ?? FIRST_DAY);

      expect(await readSymbol(COMI_ISIN)).toMatchObject({ status: "pending", missing_sessions: 0 });
      expect(await readNotices("new_listing")).toHaveLength(1);
      expect(await readListingEvents()).toHaveLength(1);
    });

    it("activates a pending symbol when the bars step stores its first quote", async () => {
      await bootstrap();
      await setSymbolState(COMI_ISIN, "pending", 0);
      await setSymbolState(ISMA_ISIN, "pending", 0);
      await seedSnapshot({
        ...defaultSnapshot(),
        session: { ...defaultSnapshot().session, date: FIRST_DAY },
        quotes: { [COMI_ISIN]: COMI_QUOTE },
      });

      await runDay(FIRST_DAY);

      expect(await countBars(COMI_ISIN)).toBe(1);
      expect(await readSymbol(COMI_ISIN)).toMatchObject({ status: "active", missing_sessions: 0 });
      expect(await readSymbol(ISMA_ISIN)).toMatchObject({ status: "pending", missing_sessions: 0 });
    });
  });

  describe("missing symbols", () => {
    it("counts one missing session per trading day and goes inactive on the fifth, keeping daily_bars", async () => {
      await bootstrap();
      await seedBars(COMI_ISIN, [{ sessionDate: TODAY, open: 100, high: 101, low: 99, close: 100 }]);
      const counts: number[] = [];
      const statuses: string[] = [];

      for (const day of TRADING_DAYS) {
        await runDay(day, withoutListing(COMI_TICKER));
        const symbol = await readSymbol(COMI_ISIN);
        counts.push(symbol.missing_sessions);
        statuses.push(symbol.status);
      }

      expect(counts).toEqual([1, 2, 3, 4, MISSING_LIMIT]);
      expect(statuses).toEqual(["active", "active", "active", "active", "inactive"]);
      expect(await countBars(COMI_ISIN)).toBe(1);
      expect(await readSymbol(ISMA_ISIN)).toMatchObject({ status: "active", missing_sessions: 0 });
    });

    it("counts a trading day once when the job is asked again the same day", async () => {
      await bootstrap();
      const runner = createRunner();
      stubFetch(withoutListing(COMI_TICKER));

      await runner.run(RUN_TIME, FIRST_DAY);
      await runner.run(LATER_RUN_TIME, FIRST_DAY);

      expect((await readSymbol(COMI_ISIN)).missing_sessions).toBe(1);
    });

    it.each([
      ["an active symbol that was missing", "active", MIDWAY_MISSING],
      ["an inactive symbol", "inactive", MISSING_LIMIT],
    ])("resets missing_sessions and returns %s to active when it reappears", async (_label, status, missing) => {
      await bootstrap();
      await setSymbolState(COMI_ISIN, status, missing);

      await runDay(FIRST_DAY);

      expect(await readSymbol(COMI_ISIN)).toMatchObject({ status: "active", missing_sessions: 0 });
    });

    it("counts a symbol listed only by Mubasher as listed when its ticker maps to an ISIN", async () => {
      await bootstrap();

      await runDay(FIRST_DAY, {
        tradingView: fixtureResponse(scanWithout(COMI_TICKER)),
        listed: firstPageOnly(mubasherListed),
      });

      expect(await readSymbol(COMI_ISIN)).toMatchObject({ status: "active", missing_sessions: 0 });
    });

    it("counts a symbol missing from TradingView and not listed by Mubasher as missing", async () => {
      await bootstrap();

      await runDay(FIRST_DAY, withoutListing(ISMA_TICKER));

      expect(await readSymbol(ISMA_ISIN)).toMatchObject({ status: "active", missing_sessions: 1 });
    });
  });

  describe("runs that must not count", () => {
    it("changes nothing on a holiday", async () => {
      await bootstrap();
      await seedCalendar([{ date: FIRST_DAY, kind: "holiday" }]);
      const symbolsBefore = await readSymbols();
      const fetchStub = stubFetch(withoutListing(COMI_TICKER));

      await createRunner().run(RUN_TIME, FIRST_DAY);

      expect(fetchStub).not.toHaveBeenCalled();
      expect(await readSymbols()).toEqual(symbolsBefore);
    });

    it("does not count and raises job_failed when both sources are empty", async () => {
      await bootstrap();
      const symbolsBefore = await readSymbols();

      await runDay(FIRST_DAY, {
        tradingView: fixtureResponse({ totalCount: 0, data: [] }),
        listed: firstPageOnly({ ...mubasherListed, rows: [] }),
      });

      expect(await readSymbols()).toEqual(symbolsBefore);
      expect((await listingSyncFailures()).length).toBeGreaterThan(0);
    });

    it.each([
      ["TradingView", { tradingView: failingUpstream, listed: firstPageOnly(listedWithout(COMI_TICKER)) }],
      ["Mubasher", { tradingView: fixtureResponse(scanWithout(COMI_TICKER)), listed: failingUpstream }],
    ])("does not count when only %s fails", async (_label, upstreams) => {
      await bootstrap();
      const symbolsBefore = await readSymbols();

      await runDay(FIRST_DAY, upstreams);

      expect(await readSymbols()).toEqual(symbolsBefore);
      expect(await listingSyncFailures()).toHaveLength(1);
    });

    it("rewrites no symbols row when every listed symbol is active at 0 or pending", async () => {
      await bootstrap();
      await setSymbolState(ISMA_ISIN, "pending", 0);
      await startSymbolWriteLog();

      await runDay(FIRST_DAY);

      expect(await readSymbolWrites()).toEqual([]);
      expect(await readSymbol(ISMA_ISIN)).toMatchObject({ status: "pending", missing_sessions: 0 });
    });

    it("never changes missing_sessions or status in a listing_bootstrap run from the snapshot job", async () => {
      await bootstrap();
      await setSymbolState(COMI_ISIN, "active", MISSING_LIMIT - 1);
      await setSymbolState(ISMA_ISIN, "inactive", MISSING_LIMIT);
      await env.DATA.delete(DIRECTORY_KEY);
      __resetKvMemo();
      stubFetch(withoutListing(COMI_TICKER));
      const runner = createJobRunner(snapshotJob, { date: FIRST_DAY, time: BOOTSTRAP_RUN_TIME });

      await runner.run();

      expect(runner.kvWrites).toContain(DIRECTORY_KEY);
      expect(await readSymbol(COMI_ISIN)).toMatchObject({ status: "active", missing_sessions: MISSING_LIMIT - 1 });
      expect(await readSymbol(ISMA_ISIN)).toMatchObject({ status: "inactive", missing_sessions: MISSING_LIMIT });
    });
  });

  describe("notice writes", () => {
    it("writes the listing failure with the other failures in exactly one raiseNotices statement", async () => {
      await bootstrap();
      stubFetch({ tradingView: failingUpstream });
      const runner = createRunner();

      await runner.run(RUN_TIME, FIRST_DAY);

      const steps = (await readNotices("job_failed")).map((notice) => notice.details.step);
      expect(steps).toContain(LISTING_SYNC_STEP);
      expect(steps.filter((step) => step !== LISTING_SYNC_STEP).length).toBeGreaterThan(0);
      expect(runner.statements.filter((sql) => sql.includes(NOTICES_INSERT))).toHaveLength(1);
    });

    it("writes new_listing with the other failures in exactly one raiseNotices statement", async () => {
      await bootstrap();
      await deleteSymbol(COMI_ISIN);
      stubFetch();
      const runner = createRunner();

      await runner.run(RUN_TIME, FIRST_DAY);

      expect(await readNotices("new_listing")).toHaveLength(1);
      expect((await readNotices("job_failed")).length).toBeGreaterThan(0);
      expect(runner.statements.filter((sql) => sql.includes(NOTICES_INSERT))).toHaveLength(1);
    });
  });

  describe("unhandled errors in scheduled", () => {
    it("stores one job_failed with step unhandled, resolves and still runs the next job", async () => {
      await seedDirectory({ tickerToIsin: { [COMI_TICKER]: COMI_ISIN } });
      stubFetch();
      const failing = failingEnv([JOB_STATE_RUN_INSERT]);
      const first = collectingContext();
      setNow(cairoSummerEpoch(TODAY, RUN_TIME));

      await expect(
        scheduled(cronController(END_OF_DAY_CRON, TODAY, RUN_TIME), failing, first.ctx),
      ).resolves.toBeUndefined();
      await expect(first.settled()).resolves.toBeDefined();

      const failures = (await readNotices("job_failed")).filter((notice) => notice.details.step === UNHANDLED_STEP);
      expect(failures).toHaveLength(1);
      expect(failures[0]?.details).toEqual({
        job: END_OF_DAY_JOB,
        step: UNHANDLED_STEP,
        source: "",
        time: expect.any(Number),
        error: UNHANDLED_MESSAGE,
      });

      setNow(cairoSummerEpoch(TODAY, SNAPSHOT_RUN_TIME));
      const second = collectingContext();
      await scheduled(cronController(SNAPSHOT_CRON, TODAY, SNAPSHOT_RUN_TIME), failing, second.ctx);
      await second.settled();

      expect(await env.DATA.get(SNAPSHOT_KEY)).not.toBeNull();
    });

    it("resolves and only logs when raising the unhandled notice fails too", async () => {
      stubFetch();
      const failing = failingEnv([JOB_STATE_RUN_INSERT, NOTICES_INSERT]);
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const context = collectingContext();
      setNow(cairoSummerEpoch(TODAY, RUN_TIME));

      await expect(
        scheduled(cronController(END_OF_DAY_CRON, TODAY, RUN_TIME), failing, context.ctx),
      ).resolves.toBeUndefined();
      await expect(context.settled()).resolves.toBeDefined();

      expect(logged).toHaveBeenCalled();
      expect(await readNotices("job_failed")).toEqual([]);
    });
  });
});
