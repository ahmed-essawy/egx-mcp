import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { referenceJob } from "../../src/jobs/reference";
import { snapshotJob } from "../../src/jobs/snapshot";
import { isaghaRetail } from "../../src/providers/gold-egypt";
import type { EgyptMetals, Snapshot } from "../../src/store/kv";
import isaghaGold from "../fixtures/isagha-gold.html?raw";
import isaghaSilver from "../fixtures/isagha-silver.html?raw";
import mubasherListed from "../fixtures/mubasher-listed-p1.json";
import mubasherPrices from "../fixtures/mubasher-prices-all.json";
import tradingViewScan from "../fixtures/tradingview-egypt-scan.json";
import tradingViewFxMetals from "../fixtures/tradingview-fx-metals.json";
import tradingViewGlobalScan from "../fixtures/tradingview-global-scan.json";
import { restoreBindings, setBindings } from "../helpers/bindings";
import {
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
import { DIRECTORY_KEY, LAST_SESSION_KEY, seedDirectory, seedSnapshot, SNAPSHOT_KEY } from "../helpers/seed";
import { cairoSummerEpoch } from "../helpers/time";

const SESSION_DATE = "2026-10-25";
const FRIDAY = "2026-10-23";
const SATURDAY = "2026-10-24";
const IN_WINDOW_ON_CADENCE = "10:30";
const IN_WINDOW_OFF_CADENCE = "10:31";
const REFERENCE_TIME = "19:00";
const STORE_TABLES = ["notices", "market_calendar", "job_state"];
const TRADINGVIEW = "tradingview";
const ISAGHA = "isagha";
const EGP_PER_GRAM = "EGP/g";
const TRADINGVIEW_SCAN_URL = "https://scanner.tradingview.com/egypt/scan";
const TRADINGVIEW_GLOBAL_URL = "https://scanner.tradingview.com/global/scan";
const MUBASHER_PRICES_URL = "https://www.mubasher.info/api/1/stocks/prices/all";
const MUBASHER_LISTED_URL = "https://www.mubasher.info/api/1/listed-companies";
const ISAGHA_GOLD_URL = "https://market.isagha.com/prices";
const ISAGHA_SILVER_URL = "https://market.isagha.com/prices/silver";
const FX_TICKER = "FX_IDC:USDEGP";
const COMI_ISIN = "EGS60121C018";
const ETEL_ISIN = "EGS48031C016";
const EAST_ISIN = "EGS37091C013";
const TICKER_TO_ISIN = { COMI: COMI_ISIN, ETEL: ETEL_ISIN, EAST: EAST_ISIN };
const PREVIOUS_FETCHED_AT = 1_790_000_000;
const EMPTY_PAGE = "<html><body><table><tbody></tbody></table></body></html>";
const FX_FIXTURE_RATE = 55.77;
const FX_FIXTURE_TIME = 1792948563;
const GOLD_FIXTURE_SPOT = 3995.54;
const GOLD_FIXTURE_TIME = 1792789199;
const SILVER_FIXTURE_SPOT = 53.9;
const SILVER_FIXTURE_TIME = 1792789198;
const REFERENCE_STEP = "metalsFx";

const FIXTURE_RETAIL = {
  gold: {
    "18": { buy: 5361.5, sell: 5400 },
    "21": { buy: 6255, sell: 6300 },
    "24": { buy: 7148.5, sell: 7200 },
    pound: { sell: 50400, buy: 50040 },
  },
  silver: {
    "925": { buy: 89.75, sell: 92.5 },
    "999": { buy: 97, sell: 99.75 },
  },
};

const PREVIOUS_EGYPT: EgyptMetals = {
  src: ISAGHA,
  fetchedAt: PREVIOUS_FETCHED_AT,
  unit: EGP_PER_GRAM,
  gold: { "21": { buy: 6000, sell: 6040 } },
  silver: { "999": { buy: 90, sell: 92 } },
};

function fxMetalsRows(...tickers: string[]) {
  return { data: tradingViewFxMetals.data.filter((row) => tickers.includes(row.s)) };
}

const PREVIOUS_FX = { v: 50, tt: PREVIOUS_FETCHED_AT, src: TRADINGVIEW, kind: "market" } as const;
const PREVIOUS_SPOT = {
  XAUUSD: { v: 3000, unit: "USD/oz", tt: PREVIOUS_FETCHED_AT, src: TRADINGVIEW },
  XAGUSD: { v: 30, unit: "USD/oz", tt: PREVIOUS_FETCHED_AT, src: TRADINGVIEW },
} as const;
const FX_ROW = fxMetalsRows("FX_IDC:USDEGP");
const SPOT_ROWS = fxMetalsRows("TVC:GOLD", "TVC:SILVER");
const NO_USD_EGP_ERROR = "scan response has no USDEGP row";
const NO_SPOT_ERROR = "scan response has no spot metal rows";
const PREVIOUS_INDICES = { EGX30: { v: 50000, chp: 1, tt: PREVIOUS_FETCHED_AT, src: TRADINGVIEW } };

type Upstreams = { gold: Upstream; silver: Upstream; fxMetals: Upstream; stocks: Upstream; listed: PageUpstream };

const htmlResponse =
  (html: string): Upstream =>
  () =>
    new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });

function isFxMetalsRequest(init: RequestInit | undefined): boolean {
  return String(init?.body).includes(FX_TICKER);
}

function stubFetch(upstreams: Partial<Upstreams> = {}) {
  const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    if (url === ISAGHA_GOLD_URL) return (upstreams.gold ?? htmlResponse(isaghaGold))();
    if (url === ISAGHA_SILVER_URL) return (upstreams.silver ?? htmlResponse(isaghaSilver))();
    if (url.startsWith(TRADINGVIEW_GLOBAL_URL)) {
      if (isFxMetalsRequest(init)) return (upstreams.fxMetals ?? fixtureResponse(tradingViewFxMetals))();
      return fixtureResponse(tradingViewGlobalScan)();
    }
    if (url.startsWith(TRADINGVIEW_SCAN_URL)) return (upstreams.stocks ?? fixtureResponse(tradingViewScan))();
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

function requestedUrls(stub: ReturnType<typeof stubFetch>): string[] {
  return stub.mock.calls.map(([input]) => requestUrl(input));
}

function isaghaRequests(stub: ReturnType<typeof stubFetch>): string[] {
  return requestedUrls(stub).filter((url) => url === ISAGHA_GOLD_URL || url === ISAGHA_SILVER_URL);
}

function fxMetalsRequests(stub: ReturnType<typeof stubFetch>): number {
  return stub.mock.calls.filter(([input, init]) => requestUrl(input).startsWith(TRADINGVIEW_GLOBAL_URL) && isFxMetalsRequest(init))
    .length;
}

async function readSnapshot(): Promise<Snapshot> {
  const snapshot = await env.DATA.get<Snapshot>(SNAPSHOT_KEY, { type: "json" });
  if (!snapshot) throw new Error("snapshot not written");
  return snapshot;
}

async function isaghaFailures() {
  const notices = await readNotices("job_failed");
  return notices.filter((notice) => notice.details.source === ISAGHA);
}

async function tradingViewFailures() {
  const notices = await readNotices("job_failed");
  return notices.filter((notice) => notice.details.source === TRADINGVIEW);
}

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

describe("isaghaRetail", () => {
  it("identifies as isagha", () => {
    expect(isaghaRetail.id).toBe(ISAGHA);
  });

  it("reads sell and buy by data-unit and keeps gold 18, 21, 24, pound and silver 925, 999", async () => {
    const stub = stubFetch();

    const retail = await isaghaRetail.fetchRetail();

    expect(requestedUrls(stub).sort()).toEqual([ISAGHA_GOLD_URL, ISAGHA_SILVER_URL]);
    expect(retail).toEqual(FIXTURE_RETAIL);
  });

  it("takes figure 1 as sell and figure 3 as buy, ignoring the gaps, for the 21K row", async () => {
    stubFetch();

    const { gold } = await isaghaRetail.fetchRetail();

    expect(gold["21"]).toEqual({ sell: 6300, buy: 6255 });
  });

  it("parses figures with thousands separators", async () => {
    const withSeparators = isaghaGold.replace(/>7200</g, ">7,200<").replace(/>6300</g, ">6,300<");
    stubFetch({ gold: htmlResponse(withSeparators) });

    const { gold } = await isaghaRetail.fetchRetail();

    expect(gold["24"]?.sell).toBe(7200);
    expect(gold["21"]?.sell).toBe(6300);
  });

  it("throws a parse error for an empty figure instead of reading it as zero", async () => {
    const withEmptyFigure = isaghaGold.replace(/>7200</g, "><");
    stubFetch({ gold: htmlResponse(withEmptyFigure) });

    await expect(isaghaRetail.fetchRetail()).rejects.toMatchObject({ provider: ISAGHA, kind: "parse" });
  });

  it("throws a parse error for a page without rows", async () => {
    stubFetch({ gold: htmlResponse(EMPTY_PAGE) });

    await expect(isaghaRetail.fetchRetail()).rejects.toMatchObject({ provider: ISAGHA, kind: "parse" });
  });

  it("page without the pound row serves the other units and goldPound is not_available", async () => {
    const withoutPound = isaghaGold.replace(/data-unit="pound"/g, 'data-unit="unlisted"');
    stubFetch({ gold: htmlResponse(withoutPound) });

    const retail = await isaghaRetail.fetchRetail();

    expect(Object.keys(retail.gold)).toEqual(["18", "21", "24"]);
    expect(retail.gold.pound).toBeUndefined();
    expect(retail.silver["925"]).toBeDefined();
  });

  it("throws a parse error when a required gold unit is missing from the gold page", async () => {
    const withoutGold21 = isaghaGold.replace(/data-unit="21"/g, 'data-unit="unlisted"');
    stubFetch({ gold: htmlResponse(withoutGold21) });

    await expect(isaghaRetail.fetchRetail()).rejects.toMatchObject({ provider: ISAGHA, kind: "parse" });
  });

  it("throws a parse error when a required unit is missing from the silver page", async () => {
    const withoutSilver925 = isaghaSilver.replace(/data-unit="925"/g, 'data-unit="unlisted"');
    stubFetch({ silver: htmlResponse(withoutSilver925) });

    await expect(isaghaRetail.fetchRetail()).rejects.toMatchObject({ provider: ISAGHA, kind: "parse" });
  });
});

describe("snapshot job metals refresh", () => {
  const createRunner = () => createJobRunner(snapshotJob, { date: SESSION_DATE, time: IN_WINDOW_ON_CADENCE });

  it("fetches iSagha and stores metals.egypt when the Cairo minute is a multiple of 15", async () => {
    const stub = stubFetch();
    const runner = createRunner();
    const now = cairoSummerEpoch(SESSION_DATE, IN_WINDOW_ON_CADENCE);

    await runner.run();
    const { metals } = await readSnapshot();

    expect(isaghaRequests(stub).sort()).toEqual([ISAGHA_GOLD_URL, ISAGHA_SILVER_URL]);
    expect(metals.egypt).toEqual({ src: ISAGHA, fetchedAt: now, unit: EGP_PER_GRAM, ...FIXTURE_RETAIL });
  });

  it("skips iSagha and keeps the previous metals.egypt when the minute is not a multiple of 15", async () => {
    await seedSnapshot({ metals: { egypt: PREVIOUS_EGYPT } });
    const stub = stubFetch();
    const runner = createRunner();

    await runner.run(IN_WINDOW_OFF_CADENCE);
    const { metals } = await readSnapshot();

    expect(isaghaRequests(stub)).toEqual([]);
    expect(metals.egypt).toEqual(PREVIOUS_EGYPT);
  });

  it("refreshes FX and global spot on every run", async () => {
    stubFetch();
    const runner = createRunner();

    await runner.run(IN_WINDOW_OFF_CADENCE);
    const snapshot = await readSnapshot();

    expect(snapshot.fx.USDEGP).toEqual({ v: FX_FIXTURE_RATE, tt: FX_FIXTURE_TIME, src: TRADINGVIEW, kind: "market" });
    expect(snapshot.metals.XAUUSD).toMatchObject({ v: GOLD_FIXTURE_SPOT, tt: GOLD_FIXTURE_TIME, src: TRADINGVIEW });
    expect(snapshot.metals.XAGUSD).toMatchObject({ v: SILVER_FIXTURE_SPOT, tt: SILVER_FIXTURE_TIME, src: TRADINGVIEW });
  });

  it("posts one FX and metals scan per run", async () => {
    const stub = stubFetch();
    const runner = createRunner();

    await runner.run();

    expect(fxMetalsRequests(stub)).toBe(1);
  });

  it("stocks fail, metals still stored", async () => {
    setBindings({ STOCK_PROVIDERS: TRADINGVIEW, SNAPSHOT_EVERY_MINUTES: "1" });
    const previous = await seedSnapshot({ metals: { egypt: PREVIOUS_EGYPT }, fx: { USDEGP: PREVIOUS_FX } });
    stubFetch({ stocks: failingUpstream });
    const runner = createRunner();

    await runner.run();
    const snapshot = await readSnapshot();

    expect(snapshot.fx.USDEGP).toMatchObject({ v: FX_FIXTURE_RATE, src: TRADINGVIEW });
    expect(snapshot.metals.XAUUSD).toMatchObject({ v: GOLD_FIXTURE_SPOT, src: TRADINGVIEW });
    expect(snapshot.metals.egypt).toEqual({ src: ISAGHA, fetchedAt: cairoSummerEpoch(SESSION_DATE, IN_WINDOW_ON_CADENCE), unit: EGP_PER_GRAM, ...FIXTURE_RETAIL });
    expect(snapshot.quotes).toEqual(previous.quotes);
    expect(snapshot.sources).toEqual(previous.sources);
  });

  it("keeps the previous metals.egypt and raises job_failed when iSagha fails, with the rest updated", async () => {
    await seedSnapshot({ metals: { egypt: PREVIOUS_EGYPT }, fx: { USDEGP: PREVIOUS_FX } });
    stubFetch({ gold: failingUpstream });
    const runner = createRunner();

    await runner.run();
    const snapshot = await readSnapshot();

    expect(snapshot.metals.egypt).toEqual(PREVIOUS_EGYPT);
    expect(snapshot.fx.USDEGP).toMatchObject({ v: FX_FIXTURE_RATE });
    expect(Object.keys(snapshot.quotes).sort()).toEqual([COMI_ISIN, EAST_ISIN, ETEL_ISIN].sort());
    const failures = await isaghaFailures();
    expect(failures).toHaveLength(1);
    expect(failures[0]?.details).toMatchObject({ job: "snapshot", source: ISAGHA });
  });

  it("keeps the previous metals.egypt and raises job_failed for a page with no rows", async () => {
    await seedSnapshot({ metals: { egypt: PREVIOUS_EGYPT } });
    stubFetch({ gold: htmlResponse(EMPTY_PAGE), silver: htmlResponse(EMPTY_PAGE) });
    const runner = createRunner();

    await runner.run();

    expect((await readSnapshot()).metals.egypt).toEqual(PREVIOUS_EGYPT);
    expect(await isaghaFailures()).toHaveLength(1);
  });
});

describe("reference job metalsFx step", () => {
  const createRunner = (date: string) => createJobRunner(referenceJob, { date, time: REFERENCE_TIME });

  it.each([
    ["a Friday", FRIDAY],
    ["a Saturday", SATURDAY],
    ["a Sunday", SESSION_DATE],
  ])("merges metals and fx into snapshot:v1 on %s without touching quotes", async (_label, date) => {
    const quotes = { [COMI_ISIN]: { t: "COMI", p: 100 } } as unknown as Snapshot["quotes"];
    const previous = await seedSnapshot({
      quotes,
      indices: PREVIOUS_INDICES,
      fx: { USDEGP: PREVIOUS_FX },
      metals: { egypt: PREVIOUS_EGYPT },
    });
    stubFetch();
    const runner = createRunner(date);
    const now = cairoSummerEpoch(date, REFERENCE_TIME);

    await runner.run();
    const snapshot = await readSnapshot();

    expect(snapshot.fx.USDEGP).toEqual({ v: FX_FIXTURE_RATE, tt: FX_FIXTURE_TIME, src: TRADINGVIEW, kind: "market" });
    expect(snapshot.metals.XAUUSD).toMatchObject({ v: GOLD_FIXTURE_SPOT, src: TRADINGVIEW });
    expect(snapshot.metals.XAGUSD).toMatchObject({ v: SILVER_FIXTURE_SPOT, src: TRADINGVIEW });
    expect(snapshot.metals.egypt).toEqual({ src: ISAGHA, fetchedAt: now, unit: EGP_PER_GRAM, ...FIXTURE_RETAIL });
    expect(snapshot.quotes).toEqual(previous.quotes);
    expect(snapshot.indices).toEqual(previous.indices);
    expect(snapshot.session).toEqual(previous.session);
    expect(runner.kvWrites.filter((key) => key === SNAPSHOT_KEY)).toHaveLength(1);
  });

  it("writes once when the same content is fetched twice", async () => {
    await seedSnapshot();
    stubFetch();
    const runner = createRunner(SATURDAY);

    await runner.run();
    await env.DB.prepare("DELETE FROM job_state").run();
    await runner.run();

    expect(runner.kvWrites.filter((key) => key === SNAPSHOT_KEY)).toHaveLength(1);
  });

  it("keeps the previous metals.egypt and raises job_failed when iSagha fails", async () => {
    await seedSnapshot({ metals: { egypt: PREVIOUS_EGYPT } });
    stubFetch({ silver: failingUpstream });
    const runner = createRunner(SATURDAY);

    await runner.run();
    const snapshot = await readSnapshot();

    expect(snapshot.metals.egypt).toEqual(PREVIOUS_EGYPT);
    expect(snapshot.fx.USDEGP).toMatchObject({ v: FX_FIXTURE_RATE });
    const failures = await isaghaFailures();
    expect(failures).toHaveLength(1);
    expect(failures[0]?.details).toMatchObject({ job: "reference", step: REFERENCE_STEP, source: ISAGHA });
  });

  it("raises job_failed for a page with no rows and keeps the previous metals.egypt", async () => {
    await seedSnapshot({ metals: { egypt: PREVIOUS_EGYPT } });
    stubFetch({ gold: htmlResponse(EMPTY_PAGE) });
    const runner = createRunner(FRIDAY);

    await runner.run();

    expect((await readSnapshot()).metals.egypt).toEqual(PREVIOUS_EGYPT);
    expect(await isaghaFailures()).toHaveLength(1);
  });

  it("keeps the seeded fx.USDEGP and raises one job_failed when the scan has no USDEGP row", async () => {
    await seedSnapshot({ metals: PREVIOUS_SPOT, fx: { USDEGP: PREVIOUS_FX } });
    stubFetch({ fxMetals: fixtureResponse(SPOT_ROWS) });
    const runner = createRunner(SATURDAY);

    await runner.run();
    const snapshot = await readSnapshot();

    expect(snapshot.fx.USDEGP).toEqual(PREVIOUS_FX);
    expect(snapshot.metals.XAUUSD).toMatchObject({ v: GOLD_FIXTURE_SPOT, src: TRADINGVIEW });
    expect(snapshot.metals.XAGUSD).toMatchObject({ v: SILVER_FIXTURE_SPOT, src: TRADINGVIEW });
    const failures = await tradingViewFailures();
    expect(failures).toHaveLength(1);
    expect(failures[0]?.details).toMatchObject({ job: "reference", step: REFERENCE_STEP, error: NO_USD_EGP_ERROR });
  });

  it("keeps the seeded spot entries and raises one job_failed when the scan has no spot metal rows", async () => {
    await seedSnapshot({ metals: PREVIOUS_SPOT, fx: { USDEGP: PREVIOUS_FX } });
    stubFetch({ fxMetals: fixtureResponse(FX_ROW) });
    const runner = createRunner(SATURDAY);

    await runner.run();
    const snapshot = await readSnapshot();

    expect(snapshot.metals.XAUUSD).toEqual(PREVIOUS_SPOT.XAUUSD);
    expect(snapshot.metals.XAGUSD).toEqual(PREVIOUS_SPOT.XAGUSD);
    expect(snapshot.fx.USDEGP).toMatchObject({ v: FX_FIXTURE_RATE, src: TRADINGVIEW });
    const failures = await tradingViewFailures();
    expect(failures).toHaveLength(1);
    expect(failures[0]?.details).toMatchObject({ job: "reference", step: REFERENCE_STEP, error: NO_SPOT_ERROR });
  });
});
