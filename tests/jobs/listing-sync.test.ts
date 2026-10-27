import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeArabic } from "../../src/domain/arabic";
import { endOfDayJob } from "../../src/jobs/end-of-day";
import type { DirectoryFund } from "../../src/store/kv";
import mubasherListed from "../fixtures/mubasher-listed-p1.json";
import tradingViewScan from "../fixtures/tradingview-egypt-scan.json";
import { restoreBindings, setBindings } from "../helpers/bindings";
import {
  clearStores,
  createJobRunner,
  failingUpstream,
  firstPageOnly,
  fixtureResponse,
  notFound,
  readDirectory,
  readLastRunDate,
  readNotices,
  requestUrl,
} from "../helpers/jobs";
import type { PageUpstream, Upstream } from "../helpers/jobs";
import { defaultSnapshot, seedCalendar, seedDirectory, seedSnapshot } from "../helpers/seed";
import { cairoSummerEpoch } from "../helpers/time";

const TODAY = "2026-10-25";
const NEXT_DAY = "2026-10-26";
const FRIDAY = "2026-10-23";
const RUN_TIME = "15:30";
const LATER_RUN_TIME = "16:31";
const TOO_EARLY_TIME = "15:29";
const STORE_TABLES = ["symbols", "symbol_aliases", "job_state", "notices", "market_calendar"];
const SKIPPED_NO_SESSION = "skipped: no session";
const TRADINGVIEW = "tradingview";
const END_OF_DAY_JOB = "end_of_day";
const LISTING_SYNC_STEP = "listingSync";
const SNAPSHOT_KEY = "snapshot:v1";
const DIRECTORY_KEY = "directory:v1";
const TRADINGVIEW_SCAN_URL = "https://scanner.tradingview.com/egypt/scan";
const MUBASHER_LISTED_URL = "https://www.mubasher.info/api/1/listed-companies";
const NAME_COLUMN = 0;
const ISIN_COLUMN = 2;
const STALE_ALIAS_SECONDS = 7 * 24 * 60 * 60;
const LISTED_COUNT = tradingViewScan.data.length;
const MUBASHER_PAGE_COUNT = mubasherListed.numberOfPages;
const COMI_ISIN = "EGS60121C018";
const ISMA_ISIN = "EGS02021C011";
const COMI_NAME_AR = "سي أي بي";
const COMI_NAME_EN = "Commercial International Bank - Egypt (CIB) S.A.E.";
const COMI_SECTOR_AR = "بنوك";
const PROVIDER_ALIAS = "comi.ca";
const HOLIDAY = { date: TODAY, kind: "holiday" } as const;
const FUND: DirectoryFund = ["fund-1", "صندوق", "Fund", null, "EGP", "صندوق", "fund"];

type Upstreams = { tradingView: Upstream; listed: PageUpstream };
type Scan = typeof tradingViewScan;
type Listed = typeof mubasherListed;
type SymbolRow = {
  isin: string;
  ticker: string;
  name_ar: string | null;
  name_en: string | null;
  sector: string | null;
  status: string;
  shares_outstanding: number | null;
  free_float_shares: number | null;
};
type AliasRow = { isin: string; kind: string; value: string; first_seen: number; last_seen: number };

function scanWithColumn(ticker: string, column: number, value: string): Scan {
  return {
    ...tradingViewScan,
    data: tradingViewScan.data.map((row) =>
      row.d[NAME_COLUMN] === ticker ? { ...row, d: row.d.map((old, index) => (index === column ? value : old)) } : row,
    ),
  };
}

function listedRenaming(from: string, to: string): Listed {
  return {
    ...mubasherListed,
    rows: mubasherListed.rows.map((row) => (row.symbol === from ? { ...row, symbol: to } : row)),
  };
}

function stubFetch(upstreams: Partial<Upstreams> = {}) {
  const stub = vi.fn(async (input: RequestInfo | URL) => {
    const url = requestUrl(input);
    if (url.startsWith(TRADINGVIEW_SCAN_URL)) return (upstreams.tradingView ?? fixtureResponse(tradingViewScan))();
    if (url.startsWith(MUBASHER_LISTED_URL)) {
      const page = Number(new URL(url).searchParams.get("page"));
      return (upstreams.listed ?? firstPageOnly(mubasherListed))(page);
    }
    return notFound();
  });
  vi.stubGlobal("fetch", stub);
  return stub;
}

function createRunner() {
  return createJobRunner(endOfDayJob, { date: TODAY, time: RUN_TIME });
}

async function readSymbols(): Promise<SymbolRow[]> {
  const { results } = await env.DB
    .prepare(
      `SELECT isin, ticker, name_ar, name_en, sector, status, shares_outstanding, free_float_shares
       FROM symbols ORDER BY isin`,
    )
    .all<SymbolRow>();
  return results;
}

async function readAliases(): Promise<AliasRow[]> {
  const { results } = await env.DB
    .prepare("SELECT isin, kind, value, first_seen, last_seen FROM symbol_aliases ORDER BY isin, kind, value")
    .all<AliasRow>();
  return results;
}

async function listingSyncFailures() {
  const failures = await readNotices("job_failed");
  return failures.filter((notice) => notice.details.step === LISTING_SYNC_STEP);
}

async function bootstrap(): Promise<void> {
  stubFetch();
  await createRunner().run();
  vi.unstubAllGlobals();
}

describe("endOfDayJob listing sync", () => {
  beforeEach(async () => {
    setBindings({ STOCK_PROVIDERS: "tradingview,mubasher" });
    await clearStores([SNAPSHOT_KEY, DIRECTORY_KEY], STORE_TABLES);
  });

  afterEach(() => {
    restoreBindings();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe("bootstrap with an empty symbols table", () => {
    it("inserts every valid listing as active and writes directory:v1", async () => {
      stubFetch();
      const runner = createRunner();

      await runner.run();
      const symbols = await readSymbols();

      expect(symbols).toHaveLength(LISTED_COUNT);
      expect(symbols.every((symbol) => symbol.status === "active")).toBe(true);
      expect(runner.kvWrites.filter((key) => key === DIRECTORY_KEY)).toHaveLength(1);
      expect((await readDirectory()).symbols).toHaveLength(LISTED_COUNT);
      expect(await readLastRunDate(END_OF_DAY_JOB)).toBe(TODAY);
      expect(await listingSyncFailures()).toEqual([]);
    });

    it("pages the Mubasher listing from 1 to numberOfPages", async () => {
      const fetchStub = stubFetch();

      await createRunner().run();

      const pages = fetchStub.mock.calls
        .map(([input]) => requestUrl(input))
        .filter((url) => url.startsWith(MUBASHER_LISTED_URL))
        .map((url) => Number(new URL(url).searchParams.get("page")));
      expect(pages).toEqual(Array.from({ length: MUBASHER_PAGE_COUNT }, (_, index) => index + 1));
    });

    it("merges by ticker: ISIN, English name and shares from TradingView, Arabic name and sector from Mubasher", async () => {
      stubFetch();

      await createRunner().run();
      const symbols = await readSymbols();

      expect(symbols.find((symbol) => symbol.isin === COMI_ISIN)).toEqual({
        isin: COMI_ISIN,
        ticker: "COMI",
        name_ar: COMI_NAME_AR,
        name_en: COMI_NAME_EN,
        sector: COMI_SECTOR_AR,
        status: "active",
        shares_outstanding: 3405140000,
        free_float_shares: 2329149811.4,
      });
      expect(symbols.find((symbol) => symbol.isin === ISMA_ISIN)).toMatchObject({
        ticker: "ISMA",
        name_ar: null,
        name_en: "Ismailia Misr Poultry",
      });
    });

    it("skips an ISIN that fails the format check", async () => {
      stubFetch({ tradingView: fixtureResponse(scanWithColumn("ISMA", ISIN_COLUMN, "EGS02021C01X")) });

      await createRunner().run();
      const symbols = await readSymbols();

      expect(symbols).toHaveLength(LISTED_COUNT - 1);
      expect(symbols.map((symbol) => symbol.ticker)).not.toContain("ISMA");
      expect((await readDirectory()).symbols).toHaveLength(LISTED_COUNT - 1);
    });

    it("builds directory entries with normalized names and tickerToIsin with current tickers", async () => {
      stubFetch();

      await createRunner().run();
      const directory = await readDirectory();
      const entry = directory.symbols.find((symbol) => symbol[0] === COMI_ISIN);

      expect(entry?.slice(0, 8)).toEqual([
        COMI_ISIN,
        "COMI",
        COMI_NAME_AR,
        COMI_NAME_EN,
        COMI_SECTOR_AR,
        "active",
        normalizeArabic(COMI_NAME_AR),
        normalizeArabic(COMI_NAME_EN),
      ]);
      expect(entry?.[8]).toEqual(expect.any(Array));
      expect(directory.tickerToIsin).toMatchObject({ COMI: COMI_ISIN, ISMA: ISMA_ISIN });
    });

    it("keeps the funds part of the current directory", async () => {
      await seedDirectory({ funds: [FUND] });
      stubFetch();

      await createRunner().run();

      expect((await readDirectory()).funds).toEqual([FUND]);
    });
  });

  describe("ticker change for the same ISIN", () => {
    it("updates symbols.ticker, keeps the old ticker in symbol_aliases and maps both in tickerToIsin", async () => {
      await bootstrap();
      stubFetch({
        tradingView: fixtureResponse(scanWithColumn("COMI", NAME_COLUMN, "CIBX")),
        listed: firstPageOnly(listedRenaming("COMI", "CIBX")),
      });

      await createRunner().run(RUN_TIME, NEXT_DAY);
      const symbols = await readSymbols();
      const aliases = await readAliases();
      const directory = await readDirectory();

      expect(symbols).toHaveLength(LISTED_COUNT);
      expect(symbols.find((symbol) => symbol.isin === COMI_ISIN)?.ticker).toBe("CIBX");
      expect(aliases).toContainEqual(expect.objectContaining({ isin: COMI_ISIN, kind: "ticker", value: "COMI" }));
      expect(directory.tickerToIsin).toMatchObject({ CIBX: COMI_ISIN, COMI: COMI_ISIN });
    });
  });

  describe("provider aliases", () => {
    it("puts every provider alias into tickerToIsin with an uppercase key", async () => {
      await env.DB
        .prepare(
          "INSERT INTO symbol_aliases (isin, kind, value, provider, first_seen, last_seen) VALUES (?1, 'provider', ?2, 'test', 1, 1)",
        )
        .bind(COMI_ISIN, PROVIDER_ALIAS)
        .run();
      stubFetch();

      await createRunner().run();

      expect((await readDirectory()).tickerToIsin).toMatchObject({ [PROVIDER_ALIAS.toUpperCase()]: COMI_ISIN });
    });
  });

  describe("source failures", () => {
    it("keeps existing rows and raises job_failed when TradingView fails", async () => {
      await bootstrap();
      const symbolsBefore = await readSymbols();
      const directoryBefore = await readDirectory();
      stubFetch({ tradingView: failingUpstream });
      const runner = createRunner();

      await runner.run(RUN_TIME, NEXT_DAY);

      expect(await readSymbols()).toEqual(symbolsBefore);
      expect(await readDirectory()).toEqual(directoryBefore);
      expect(runner.kvWrites).not.toContain(DIRECTORY_KEY);
      const failures = await listingSyncFailures();
      expect(failures).toHaveLength(1);
      expect(failures[0]?.details).toEqual({
        job: END_OF_DAY_JOB,
        step: LISTING_SYNC_STEP,
        source: TRADINGVIEW,
        time: expect.any(Number),
        error: expect.any(String),
      });
    });

    it("changes nothing when both sources are empty", async () => {
      await bootstrap();
      const symbolsBefore = await readSymbols();
      const aliasesBefore = await readAliases();
      stubFetch({
        tradingView: fixtureResponse({ totalCount: 0, data: [] }),
        listed: firstPageOnly({ ...mubasherListed, rows: [] }),
      });
      const runner = createRunner();

      await runner.run(RUN_TIME, NEXT_DAY);

      expect(await readSymbols()).toEqual(symbolsBefore);
      expect(await readAliases()).toEqual(aliasesBefore);
      expect(runner.kvWrites).not.toContain(DIRECTORY_KEY);
    });
  });

  describe("when the job does not run", () => {
    it.each([
      ["a Friday", FRIDAY, RUN_TIME],
      ["15:29 Cairo", TODAY, TOO_EARLY_TIME],
    ])("makes no fetch and no sync on %s", async (_label, date, time) => {
      const fetchStub = stubFetch();
      const runner = createRunner();

      await runner.run(time, date);

      expect(fetchStub).not.toHaveBeenCalled();
      expect(runner.kvWrites).toEqual([]);
      expect(await readSymbols()).toEqual([]);
    });

    it("makes no fetch and no sync on a holiday calendar row", async () => {
      await seedCalendar([HOLIDAY]);
      const fetchStub = stubFetch();
      const runner = createRunner();

      await runner.run();

      expect(fetchStub).not.toHaveBeenCalled();
      expect(runner.kvWrites).toEqual([]);
      expect(await readSymbols()).toEqual([]);
    });

    it("skips before any fetch when today's snapshot has noTradesToday and records the run", async () => {
      await seedSnapshot({ session: { ...defaultSnapshot().session, date: TODAY, noTradesToday: true } });
      const fetchStub = stubFetch();
      const runner = createRunner();

      expect(await runner.run()).toBe(SKIPPED_NO_SESSION);

      expect(fetchStub).not.toHaveBeenCalled();
      expect(runner.kvWrites).toEqual([]);
      expect(await readSymbols()).toEqual([]);
      expect(await readLastRunDate(END_OF_DAY_JOB)).toBe(TODAY);
    });

    it("runs the sync when noTradesToday belongs to an earlier session date", async () => {
      await seedSnapshot({ session: { ...defaultSnapshot().session, date: FRIDAY, noTradesToday: true } });
      const fetchStub = stubFetch();

      await createRunner().run();

      expect(fetchStub).toHaveBeenCalled();
      expect(await readSymbols()).toHaveLength(LISTED_COUNT);
    });

    it("runs once per Cairo date", async () => {
      const fetchStub = stubFetch();
      const runner = createRunner();

      await runner.run();
      const callsAfterFirstRun = fetchStub.mock.calls.length;
      await runner.run(LATER_RUN_TIME);

      expect(fetchStub.mock.calls).toHaveLength(callsAfterFirstRun);
      expect(runner.kvWrites.filter((key) => key === DIRECTORY_KEY)).toHaveLength(1);
    });
  });

  describe("symbol_aliases last_seen rule", () => {
    it("rewrites no alias row on a run a day later", async () => {
      await bootstrap();
      const aliasesBefore = await readAliases();
      stubFetch();

      await createRunner().run(RUN_TIME, NEXT_DAY);

      expect(aliasesBefore.length).toBeGreaterThan(0);
      expect(await readAliases()).toEqual(aliasesBefore);
    });

    it("rewrites an alias whose last_seen is more than 7 days old and no other", async () => {
      await bootstrap();
      const aliasesBefore = await readAliases();
      const stale = aliasesBefore[0];
      if (!stale) throw new Error("no alias written");
      await env.DB
        .prepare("UPDATE symbol_aliases SET last_seen = ?4 WHERE isin = ?1 AND kind = ?2 AND value = ?3")
        .bind(stale.isin, stale.kind, stale.value, stale.last_seen - STALE_ALIAS_SECONDS)
        .run();
      const nextRunAt = cairoSummerEpoch(NEXT_DAY, RUN_TIME);
      stubFetch();

      await createRunner().run(RUN_TIME, NEXT_DAY);
      const aliasesAfter = await readAliases();

      expect(aliasesAfter[0]).toEqual({ ...stale, last_seen: nextRunAt });
      expect(aliasesAfter.slice(1)).toEqual(aliasesBefore.slice(1));
    });
  });
});
