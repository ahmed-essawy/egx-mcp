import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeArabic } from "../../src/domain/arabic";
import { referenceJob } from "../../src/jobs/reference";
import { recomputeCycles } from "../../src/store/d1/funds";
import mubasherFunds from "../fixtures/mubasher-funds-p1.json";
import { restoreBindings } from "../helpers/bindings";
import {
  clearStores,
  bindMember,
  createJobRunner,
  failingUpstream,
  firstPageOnly,
  notFound,
  readDirectory,
  readLastRunDate,
  readNotices,
  requestUrl,
} from "../helpers/jobs";
import type { PageUpstream } from "../helpers/jobs";
import { DIRECTORY_KEY, seedCalendar, seedSymbols, stockSymbol } from "../helpers/seed";

const FIRST_DAY = "2026-10-22";
const NEXT_DAY = "2026-10-23";
const STALE_DAY = "2026-10-28";
const RECOVERY_DAY = "2026-10-29";
const FRIDAY = "2026-10-23";
const RUN_TIME = "19:00";
const LATER_RUN_TIME = "21:00";
const STORE_TABLES = ["funds", "nav_records", "market_events", "notices", "job_state", "market_calendar"];
const REFERENCE_JOB = "reference";
const FUNDS_STEP = "funds";
const MUBASHER = "mubasher";
const MUBASHER_FUNDS_URL = "https://www.mubasher.info/api/1/funds";
const FUND_COUNT = mubasherFunds.rows.length;
const FUND_PAGE_COUNT = mubasherFunds.numberOfPages;
const FIRST_PAGE = 1;
const SECOND_PAGE = 2;
const THIRD_PAGE = 3;
const ARABIC_MONTHS = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];
const PRIMARY_FUND_ID = 6401;
const PRIMARY_FUND = `mubasher:${PRIMARY_FUND_ID}`;
const PRIMARY_NAME_AR = "كايرو كابيتال لأدوات الدخل الثابت - ستريم";
const PRIMARY_MANAGER = "سي إف إتش لادراة الأصول";
const PRIMARY_NAV = 1.27;
const PRIMARY_NAV_DATE = "2026-10-21";
const NO_CLASSIFICATION_FUND = "mubasher:6146";
const EXTRA_FUND_ID = 7001;
const EXTRA_FUND = `mubasher:${EXTRA_FUND_ID}`;
const SEEDED_NAV = 9.99;
const SEEDED_FETCHED_AT = 1;
const SEEDED_SOURCE = "seed";
const CLASSIFICATION = "أسهم";
const WEEKLY_NAV_DATES = [
  "2026-08-27",
  "2026-08-30",
  "2026-08-31",
  "2026-09-01",
  "2026-09-02",
  "2026-09-03",
  "2026-09-06",
  "2026-09-13",
  "2026-09-20",
  "2026-09-27",
  "2026-10-04",
  "2026-10-11",
  "2026-10-18",
];
const HOLIDAY_NAV_DATES = ["2026-10-18"];
const HOLIDAY_DATE = "2026-10-19";
const LONG_HISTORY_COUNT = 200;
const HISTORY_START_MS = Date.parse("2026-01-01T00:00:00Z");
const MILLIS_PER_WEEK = 7 * 86400000;
const CYCLE_WINDOW_ROWS = 8;
const ROWS_READ_SLACK = 4;
const WEEKLY_CYCLE_DAYS = 5;
const HOLIDAY_CYCLE_DAYS = 2;
const COMI_ISIN = "EGS60121C018";
const COMI_TICKER = "COMI";
const COMI_NAME_AR = "سي أي بي";

type FundRow = (typeof mubasherFunds.rows)[number];
type FundPatch = Partial<Record<keyof FundRow, unknown>>;
type FundRecord = {
  fund_id: string;
  name_ar: string;
  name_en: string | null;
  manager: string | null;
  currency: string;
  category: string | null;
  cycle_days: number;
  status: string;
};
type NavRecord = { fund_id: string; nav_date: string; nav: number; source: string; fetched_at: number | null };
type EventRecord = { kind: string; fund_id: string | null };

function fundPage(patches: Record<number, FundPatch> = {}) {
  return {
    ...mubasherFunds,
    rows: mubasherFunds.rows.map((row) => ({ ...row, ...patches[row.fundId] })),
  };
}

function extraFundRow(): FundRow {
  const template = mubasherFunds.rows[0] as FundRow;
  return { ...template, fundId: EXTRA_FUND_ID, name: "صندوق إضافي" };
}

function stubFetch(funds: PageUpstream = firstPageOnly(mubasherFunds)) {
  const stub = vi.fn(async (input: RequestInfo | URL) => {
    const url = requestUrl(input);
    if (!url.startsWith(MUBASHER_FUNDS_URL)) return notFound();
    return funds(Number(new URL(url).searchParams.get("page")));
  });
  vi.stubGlobal("fetch", stub);
  return stub;
}

function createRunner() {
  return createJobRunner(referenceJob, { date: FIRST_DAY, time: RUN_TIME });
}

async function readFunds(): Promise<FundRecord[]> {
  const { results } = await env.DB
    .prepare(
      `SELECT fund_id, name_ar, name_en, manager, currency, category, cycle_days, status
       FROM funds ORDER BY fund_id`,
    )
    .all<FundRecord>();
  return results;
}

async function readFund(fundId: string): Promise<FundRecord | undefined> {
  return (await readFunds()).find((fund) => fund.fund_id === fundId);
}

async function readNavs(fundId?: string): Promise<NavRecord[]> {
  const { results } = await env.DB
    .prepare(
      `SELECT fund_id, nav_date, nav, source, fetched_at FROM nav_records
       WHERE ?1 IS NULL OR fund_id = ?1 ORDER BY fund_id, nav_date`,
    )
    .bind(fundId ?? null)
    .all<NavRecord>();
  return results;
}

async function readNewNavEvents(): Promise<EventRecord[]> {
  const { results } = await env.DB
    .prepare("SELECT kind, fund_id FROM market_events WHERE kind = 'new_nav' ORDER BY id")
    .all<EventRecord>();
  return results;
}

async function seedFund(fundId: string): Promise<void> {
  await env.DB
    .prepare(
      `INSERT INTO funds (fund_id, name_ar, currency, cycle_days, status, created_at, updated_at)
       VALUES (?1, ?2, 'EGP', 1, 'active', 1, 1)`,
    )
    .bind(fundId, PRIMARY_NAME_AR)
    .run();
}

async function seedNavs(fundId: string, dates: string[]): Promise<void> {
  const insert = env.DB.prepare(
    "INSERT INTO nav_records (fund_id, nav_date, nav, source, fetched_at) VALUES (?1, ?2, ?3, ?4, ?5)",
  );
  await env.DB.batch(dates.map((date) => insert.bind(fundId, date, SEEDED_NAV, SEEDED_SOURCE, SEEDED_FETCHED_AT)));
}

function measureRowsRead() {
  let total = 0;
  const measure = (statement: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(statement, {
      get(target, name) {
        if (name === "bind") return (...values: unknown[]) => measure(target.bind(...values));
        if (name !== "all") return bindMember(target, name);
        return async (...args: unknown[]) => {
          const result = await (target.all as (...rest: unknown[]) => Promise<D1Result>)(...args);
          total += result.meta.rows_read;
          return result;
        };
      },
    });
  const db = new Proxy(env.DB, {
    get(target, property) {
      if (property !== "prepare") return bindMember(target, property);
      return (sql: string) => measure(target.prepare(sql));
    },
  });
  return { db, rowsRead: () => total };
}

async function fundsFailures() {
  const failures = await readNotices("job_failed");
  return failures.filter((notice) => notice.details.step === FUNDS_STEP);
}

describe("referenceJob funds step", () => {
  beforeEach(async () => {
    await clearStores([DIRECTORY_KEY], STORE_TABLES);
  });

  afterEach(() => {
    restoreBindings();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe("inserting funds and NAVs from the Mubasher fixture", () => {
    it("pages Mubasher funds from 1 to numberOfPages", async () => {
      const fetchStub = stubFetch();

      await createRunner().run();

      const pages = fetchStub.mock.calls
        .map(([input]) => requestUrl(input))
        .filter((url) => url.startsWith(MUBASHER_FUNDS_URL))
        .map((url) => Number(new URL(url).searchParams.get("page")));
      expect(pages).toEqual(Array.from({ length: FUND_PAGE_COUNT }, (_, index) => index + 1));
    });

    it("inserts every fixture fund with its latest NAV", async () => {
      stubFetch();

      await createRunner().run();
      const funds = await readFunds();
      const navs = await readNavs();

      expect(funds).toHaveLength(FUND_COUNT);
      expect(navs).toHaveLength(FUND_COUNT);
      expect(funds.every((fund) => fund.status === "active")).toBe(true);
      expect(funds.find((fund) => fund.fund_id === PRIMARY_FUND)).toMatchObject({
        name_ar: PRIMARY_NAME_AR,
        name_en: null,
        manager: PRIMARY_MANAGER,
        currency: "EGP",
      });
      expect(navs.find((nav) => nav.fund_id === PRIMARY_FUND)).toMatchObject({
        nav_date: PRIMARY_NAV_DATE,
        nav: PRIMARY_NAV,
        source: MUBASHER,
      });
      expect(await readLastRunDate(REFERENCE_JOB)).toBe(FIRST_DAY);
      expect(await fundsFailures()).toEqual([]);
    });

    it.each(ARABIC_MONTHS.map((month, index) => [month, index + 1] as const))(
      "parses a date in %s",
      async (month, monthNumber) => {
        stubFetch(firstPageOnly(fundPage({ [PRIMARY_FUND_ID]: { date: `7 ${month} 2026` } })));

        await createRunner().run();

        const expected = `2026-${String(monthNumber).padStart(2, "0")}-07`;
        expect((await readNavs(PRIMARY_FUND)).map((nav) => nav.nav_date)).toEqual([expected]);
      },
    );

    it("skips rows without a price or without a parsable date", async () => {
      stubFetch(
        firstPageOnly(fundPage({ [PRIMARY_FUND_ID]: { price: null }, 6146: { date: "غير معروف" }, 6499: { date: null } })),
      );

      await createRunner().run();
      const fundIds = (await readFunds()).map((fund) => fund.fund_id);

      expect(fundIds).toHaveLength(FUND_COUNT - 3);
      expect(fundIds).not.toContain(PRIMARY_FUND);
      expect(fundIds).not.toContain(NO_CLASSIFICATION_FUND);
      expect(fundIds).not.toContain("mubasher:6499");
    });

    it("takes category from classification when present and keeps nameEn null", async () => {
      stubFetch(firstPageOnly(fundPage({ [PRIMARY_FUND_ID]: { classification: CLASSIFICATION } })));

      await createRunner().run();
      const funds = await readFunds();

      expect(funds.find((fund) => fund.fund_id === PRIMARY_FUND)?.category).toBe(CLASSIFICATION);
      expect(funds.find((fund) => fund.fund_id === NO_CLASSIFICATION_FUND)?.category).toBeNull();
      expect(funds.every((fund) => fund.name_en === null)).toBe(true);
    });
  });

  describe("NAV records and events", () => {
    it("does not rewrite a NAV whose nav_date already exists and raises no event for it", async () => {
      await seedFund(PRIMARY_FUND);
      await seedNavs(PRIMARY_FUND, [PRIMARY_NAV_DATE]);
      stubFetch();

      await createRunner().run();

      expect(await readNavs(PRIMARY_FUND)).toEqual([
        {
          fund_id: PRIMARY_FUND,
          nav_date: PRIMARY_NAV_DATE,
          nav: SEEDED_NAV,
          source: SEEDED_SOURCE,
          fetched_at: SEEDED_FETCHED_AT,
        },
      ]);
      const events = await readNewNavEvents();
      expect(events.map((event) => event.fund_id)).not.toContain(PRIMARY_FUND);
      expect(events).toHaveLength(FUND_COUNT - 1);
    });

    it("creates one new_nav event per new NAV", async () => {
      stubFetch();

      await createRunner().run();
      const events = await readNewNavEvents();

      expect(events).toHaveLength(FUND_COUNT);
      expect(events.map((event) => event.fund_id).sort()).toEqual(
        (await readFunds()).map((fund) => fund.fund_id).sort(),
      );
    });

    it("creates a new_nav event only for the fund whose NAV date moved on the next run", async () => {
      const runner = createRunner();
      stubFetch();
      await runner.run();
      stubFetch(firstPageOnly(fundPage({ [PRIMARY_FUND_ID]: { date: "22 أكتوبر 2026", price: 1.3 } })));

      await runner.run(RUN_TIME, NEXT_DAY);
      const events = await readNewNavEvents();

      expect(events).toHaveLength(FUND_COUNT + 1);
      expect(events.at(-1)).toEqual({ kind: "new_nav", fund_id: PRIMARY_FUND });
      expect((await readNavs(PRIMARY_FUND)).map((nav) => nav.nav_date)).toEqual([PRIMARY_NAV_DATE, FIRST_DAY]);
    });
  });

  describe("cycle_days", () => {
    it("is the median gap in trading days between the last 8 NAV dates", async () => {
      await seedFund(PRIMARY_FUND);
      await seedNavs(PRIMARY_FUND, WEEKLY_NAV_DATES);
      stubFetch();

      await createRunner().run();

      expect((await readFund(PRIMARY_FUND))?.cycle_days).toBe(WEEKLY_CYCLE_DAYS);
    });

    it("reads only the last 8 NAV rows of each fund", async () => {
      const longHistory = Array.from({ length: LONG_HISTORY_COUNT }, (_, index) =>
        new Date(HISTORY_START_MS + index * MILLIS_PER_WEEK).toISOString().slice(0, 10),
      );
      await seedFund(PRIMARY_FUND);
      await seedNavs(PRIMARY_FUND, longHistory);
      const measured = measureRowsRead();

      await recomputeCycles(measured.db, [PRIMARY_FUND]);

      expect(measured.rowsRead()).toBeLessThanOrEqual(CYCLE_WINDOW_ROWS * 2 + ROWS_READ_SLACK);
      expect((await readFund(PRIMARY_FUND))?.cycle_days).toBe(WEEKLY_CYCLE_DAYS);
    });

    it("counts a holiday from market_calendar as a non trading day", async () => {
      await seedFund(PRIMARY_FUND);
      await seedNavs(PRIMARY_FUND, HOLIDAY_NAV_DATES);
      await seedCalendar([{ date: HOLIDAY_DATE, kind: "holiday" }]);
      stubFetch();

      await createRunner().run();

      expect((await readFund(PRIMARY_FUND))?.cycle_days).toBe(HOLIDAY_CYCLE_DAYS);
    });
  });

  describe("staleness", () => {
    it("keeps funds active with no fund_stale notice while NAVs are within the cycle", async () => {
      stubFetch();

      await createRunner().run();

      expect((await readFunds()).every((fund) => fund.status === "active")).toBe(true);
      expect(await readNotices("fund_stale")).toEqual([]);
    });

    it("does not judge a new fund with a single NAV stale", async () => {
      stubFetch();

      await createRunner().run(RUN_TIME, STALE_DAY);

      expect((await readFund(PRIMARY_FUND))?.status).toBe("active");
      expect(await readNotices("fund_stale")).toEqual([]);
    });

    it("marks a fund stale and raises one fund_stale notice for it", async () => {
      await seedNavs(PRIMARY_FUND, [PRIMARY_NAV_DATE]);
      const runner = createRunner();
      stubFetch();
      await runner.run();

      await runner.run(RUN_TIME, STALE_DAY);
      const notices = (await readNotices("fund_stale")).filter((notice) => notice.subject.includes(PRIMARY_FUND));

      expect((await readFund(PRIMARY_FUND))?.status).toBe("stale");
      expect(notices).toHaveLength(1);
    });

    it("returns a stale fund to active when a fresh NAV arrives", async () => {
      await seedNavs(PRIMARY_FUND, [PRIMARY_NAV_DATE]);
      const runner = createRunner();
      stubFetch();
      await runner.run();
      await runner.run(RUN_TIME, STALE_DAY);
      stubFetch(firstPageOnly(fundPage({ [PRIMARY_FUND_ID]: { date: "28 أكتوبر 2026" } })));

      await runner.run(RUN_TIME, RECOVERY_DAY);

      expect((await readFund(PRIMARY_FUND))?.status).toBe("active");
    });
  });

  describe("directory refresh", () => {
    it("replaces only the funds part of directory:v1 with normalized names", async () => {
      await seedSymbols([stockSymbol(COMI_ISIN, COMI_TICKER, { nameAr: COMI_NAME_AR })]);
      stubFetch();
      const runner = createRunner();

      await runner.run();
      const directory = await readDirectory();
      const entry = directory.funds.find((fund) => fund[0] === PRIMARY_FUND);

      expect(directory.funds).toHaveLength(FUND_COUNT);
      expect(entry?.slice(0, 4)).toEqual([PRIMARY_FUND, PRIMARY_NAME_AR, null, PRIMARY_MANAGER]);
      expect(entry?.[5]).toBe(normalizeArabic(PRIMARY_NAME_AR));
      expect(directory.symbols.map((symbol) => symbol[0])).toEqual([COMI_ISIN]);
      expect(directory.tickerToIsin).toEqual({ [COMI_TICKER]: COMI_ISIN });
      expect(runner.kvWrites.filter((key) => key === DIRECTORY_KEY)).toHaveLength(1);
    });

    it("leaves directory:v1 absent when there is no directory yet", async () => {
      const runner = createRunner();
      stubFetch();

      await runner.run();

      expect(runner.kvWrites).not.toContain(DIRECTORY_KEY);
    });

    it("does not write directory:v1 again when the funds are unchanged", async () => {
      await seedSymbols([stockSymbol(COMI_ISIN, COMI_TICKER, { nameAr: COMI_NAME_AR })]);
      const runner = createRunner();
      stubFetch();
      await runner.run();
      stubFetch();

      await runner.run(RUN_TIME, NEXT_DAY);

      expect(runner.kvWrites.filter((key) => key === DIRECTORY_KEY)).toHaveLength(1);
    });
  });

  describe("source failures", () => {
    it("keeps the other pages' data and raises one job_failed with the failed page when a page fails", async () => {
      const failingThirdPage: PageUpstream = (page) => {
        if (page === FIRST_PAGE) return Response.json(mubasherFunds);
        if (page === SECOND_PAGE) return Response.json({ ...mubasherFunds, rows: [extraFundRow()] });
        if (page === THIRD_PAGE) return failingUpstream();
        return Response.json({ ...mubasherFunds, rows: [] });
      };
      stubFetch(failingThirdPage);

      await createRunner().run();
      const failures = await fundsFailures();

      expect((await readFunds()).map((fund) => fund.fund_id)).toContain(EXTRA_FUND);
      expect(await readFunds()).toHaveLength(FUND_COUNT + 1);
      expect(await readNavs()).toHaveLength(FUND_COUNT + 1);
      expect(failures).toHaveLength(1);
      expect(failures[0]?.details).toMatchObject({
        job: REFERENCE_JOB,
        step: FUNDS_STEP,
        source: MUBASHER,
        pages: [THIRD_PAGE],
      });
    });

    it("writes nothing and raises job_failed when every page is empty", async () => {
      stubFetch(firstPageOnly({ ...mubasherFunds, rows: [] }));
      const runner = createRunner();

      await runner.run();
      const failures = await fundsFailures();

      expect(await readFunds()).toEqual([]);
      expect(await readNavs()).toEqual([]);
      expect(await readNewNavEvents()).toEqual([]);
      expect(runner.kvWrites).not.toContain(DIRECTORY_KEY);
      expect(failures).toHaveLength(1);
      expect(failures[0]?.details).toMatchObject({ job: REFERENCE_JOB, step: FUNDS_STEP, source: MUBASHER });
    });

    it("keeps existing rows and raises job_failed when the source is empty after a good run", async () => {
      const runner = createRunner();
      stubFetch();
      await runner.run();
      const fundsBefore = await readFunds();
      const navsBefore = await readNavs();
      stubFetch(firstPageOnly({ ...mubasherFunds, rows: [] }));

      await runner.run(RUN_TIME, NEXT_DAY);

      expect(await readFunds()).toEqual(fundsBefore);
      expect(await readNavs()).toEqual(navsBefore);
      expect(await fundsFailures()).toHaveLength(1);
    });
  });

  describe("schedule", () => {
    it("runs once per Cairo date", async () => {
      const fetchStub = stubFetch();
      const runner = createRunner();

      await runner.run();
      const callsAfterFirstRun = fetchStub.mock.calls.length;
      await runner.run(LATER_RUN_TIME);

      expect(fetchStub.mock.calls).toHaveLength(callsAfterFirstRun);
    });

    it("still fetches NAVs on a Friday", async () => {
      const fetchStub = stubFetch();

      await createRunner().run(RUN_TIME, FRIDAY);

      expect(fetchStub).toHaveBeenCalled();
      expect(await readFunds()).toHaveLength(FUND_COUNT);
      expect(await readNavs()).toHaveLength(FUND_COUNT);
    });

    it("still fetches NAVs on a holiday calendar row", async () => {
      await seedCalendar([{ date: FIRST_DAY, kind: "holiday" }]);
      const fetchStub = stubFetch();

      await createRunner().run();

      expect(fetchStub).toHaveBeenCalled();
      expect(await readFunds()).toHaveLength(FUND_COUNT);
      expect(await readNavs()).toHaveLength(FUND_COUNT);
    });
  });
});
