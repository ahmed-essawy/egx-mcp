import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/config";
import { ACCOUNTING_ROWS_PER_CALL, JOBS_D1_ROWS_RESERVE } from "../../src/domain/budget";
import { JOB_NAME_BY_CRON, scheduled } from "../../src/jobs/dispatch";
import wrangler from "../../wrangler.jsonc?raw";
import { bindMember } from "../helpers/bind";
import { directorySymbols, isinOf, stubUpstream, tickerOf, type UpstreamKind } from "../helpers/market-upstream";
import { callNodeTool, createNodeStores, putJson, type NodeStores } from "../helpers/node-mcp";
import { cairoSummerEpoch, MS_PER_SECOND } from "../helpers/time";

vi.mock("../../src/providers/gold-egypt", () => ({
  isaghaRetail: {
    id: "isagha",
    async fetchRetail() {
      await fetch("https://market.isagha.com/prices");
      await fetch("https://market.isagha.com/prices/silver");
      return {
        gold: { "18": { buy: 5360, sell: 5400 }, "21": { buy: 6255, sell: 6300 }, "24": { buy: 7150, sell: 7200 }, pound: { buy: 50040, sell: 50400 } },
        silver: { "925": { buy: 80, sell: 85 }, "999": { buy: 86, sell: 90 } },
      };
    },
  },
}));

vi.mock("@cloudflare/workers-oauth-provider", () => ({
  getOAuthApi: () => ({ purgeExpiredData: async () => ({ done: true }) }),
}));

const WEEKDAY = "2026-10-25";
const SATURDAY = "2026-10-24";
const SESSION_TRADE_TIME = cairoSummerEpoch(WEEKDAY, "10:00");
const SNAPSHOT_KEY = "snapshot:v1";
const LAST_SESSION_KEY = "snapshot:last-session";
const INDEX_CLOSES_KEY = `snapshot:index-closes:${WEEKDAY}`;
const STATS_KEY = "stats:v1";
const DIRECTORY_KEY = "directory:v1";
const MAX_SNAPSHOT_WRITES = 291;
const MAX_DAY_WRITES = 298;
const MAX_BOOTSTRAP_DAY_WRITES = 299;
const MAX_KV_WRITES_WITH_OAUTH = 899;
const MAX_TICK_SUBREQUESTS = 6;
const MAX_BOOTSTRAP_SUBREQUESTS = 25;
const MAX_JOB_SUBREQUESTS = 20;
const MAX_END_OF_DAY_STATEMENTS = 40;
const MAX_REFERENCE_STATEMENTS = 30;
const MAX_ADMIN_APPLY_STATEMENTS = 30;
const MAX_PURGE_ROWS = 5400;
const REFERENCE_STEPS = 5;
const SYMBOL_COUNT = 380;
const CAP_SYMBOL_COUNT = 400;
const NEW_LISTINGS = 20;
const QUEUED_ACTIONS = 8;
const APPLIED_PER_RUN = 2;
const ADMIN_APPLY_LIMIT = 3;
const FUND_PAGES = 13;
const ACTION_ROWS = 20;
const STALE_FUNDS = 20;
const EVENT_PURGE_LIMIT = 1200;
const USAGE_PURGE_LIMIT = 3000;
const EXPIRED_EVENTS = 1500;
const EXPIRED_USAGE_ROWS = 3500;
const SECONDS_PER_DAY = 86_400;
const EVENT_AGE_DAYS = 500;
const USAGE_AGE_DAYS = 120;
const EX_DATE = "2026-10-20";
const BAR_DATES = ["2026-10-15", "2026-10-18"];
const BONUS_RATIO = 0.5;
const NOTICE_INSERT = "INSERT INTO notices";
const MINUTES_PER_HOUR = 60;
const DAY_TEST_TIMEOUT_MS = 60_000;
const OWNER_EMAIL = "node@example.com";
const LAST_HOUR = 23;
const MAX_DIRECTORY_WRITES = 2;
const MAX_BOOTSTRAP_DIRECTORY_WRITES = 3;
const ADMIN_CALL_HOUR = 15;
const FINANCIAL_METRICS_PER_SYMBOL = 6;
const SNAPSHOT_TICK = { hour: 11, minute: 30 };

type Phase = "snapshot" | "end_of_day" | "reference" | "maintenance" | "setup";
type Put = { key: string; phase: Phase };
type Dispatch = { cron: string; phase: Phase; subrequests: number };
type Harness = {
  stores: NodeStores;
  env: Env;
  statements: string[];
  puts: Put[];
  fetchStub: ReturnType<typeof stubUpstream>;
  state: { phase: Phase };
};
type CronTimes = { minutes: number[]; hours: number[] };

const CRONS = (JSON.parse(wrangler) as { triggers: { crons: string[] } }).triggers.crons;
const jobCron = (job: string): string => CRONS.find((cron) => JOB_NAME_BY_CRON[cron] === job)!;
const SNAPSHOT_CRON = jobCron("snapshot");
const END_OF_DAY_CRON = jobCron("end_of_day");
const REFERENCE_CRON = jobCron("reference");
const MAINTENANCE_CRON = jobCron("maintenance");
const PHASE_OF_CRON = new Map<string, Phase>(CRONS.map((cron) => [cron, JOB_NAME_BY_CRON[cron] as Phase]));
const REFERENCE_UTC_HOUR = cronTimes(REFERENCE_CRON).hours[0]!;
const END_OF_DAY_UTC_HOUR = cronTimes(END_OF_DAY_CRON).hours[0]!;
const END_OF_DAY_UTC_MINUTE = cronTimes(END_OF_DAY_CRON).minutes[0]!;
const MAINTENANCE_UTC_HOUR = cronTimes(MAINTENANCE_CRON).hours[0]!;
const WEEKDAY_CRONS = [SNAPSHOT_CRON, END_OF_DAY_CRON, REFERENCE_CRON];

function expandField(field: string, last: number): number[] {
  if (field === "*") return Array.from({ length: last + 1 }, (_, value) => value);
  return field.split(",").flatMap((part) => {
    const [from, to = from] = part.split("-").map(Number) as [number, number?];
    return Array.from({ length: to - from + 1 }, (_, offset) => from + offset);
  });
}

function cronTimes(cron: string): CronTimes {
  const [minute, hour] = cron.split(" ") as [string, string];
  return { minutes: expandField(minute, MINUTES_PER_HOUR - 1), hours: expandField(hour, LAST_HOUR) };
}

function utcMs(date: string, hour: number, minute: number): number {
  return Date.parse(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
}

function utcSeconds(date: string, hour: number): number {
  return utcMs(date, hour, 0) / MS_PER_SECOND;
}

function instrument(stores: NodeStores, upstream: Parameters<typeof stubUpstream>[0]): Harness {
  const statements: string[] = [];
  const puts: Put[] = [];
  const state = { phase: "setup" as Phase };
  const { DB, DATA } = stores.env;
  const db = new Proxy(DB, {
    get(target, property) {
      if (property !== "prepare") return bindMember(target, property);
      return (sql: string) => {
        statements.push(sql);
        return target.prepare(sql);
      };
    },
  });
  const kv = new Proxy(DATA, {
    get(target, property) {
      if (property !== "put") return bindMember(target, property);
      return (key: string, ...rest: unknown[]) => {
        puts.push({ key, phase: state.phase });
        return (target.put as (...args: unknown[]) => Promise<void>)(key, ...rest);
      };
    },
  });
  const env = { ...stores.env, DB: db, DATA: kv } as Env;
  return { stores, env, statements, puts, fetchStub: stubUpstream(upstream), state };
}

async function dispatch(harness: Harness, cron: string, date: string, hour: number, minute: number): Promise<Dispatch> {
  const phase = PHASE_OF_CRON.get(cron) ?? "setup";
  harness.state.phase = phase;
  const scheduledTime = utcMs(date, hour, minute);
  vi.setSystemTime(scheduledTime);
  const pending: Promise<unknown>[] = [];
  const before = harness.fetchStub.mock.calls.length;
  const ctx = { waitUntil: (promise: Promise<unknown>) => pending.push(promise) } as unknown as ExecutionContext;
  await scheduled({ cron, scheduledTime } as ScheduledController, harness.env, ctx);
  await Promise.all(pending);
  harness.state.phase = "setup";
  return { cron, phase, subrequests: harness.fetchStub.mock.calls.length - before };
}

async function runWeekday(harness: Harness): Promise<Dispatch[]> {
  const schedule = WEEKDAY_CRONS.map((cron) => ({ cron, ...cronTimes(cron) }));
  const lastHour = Math.max(...schedule.flatMap((entry) => entry.hours));
  const dispatches: Dispatch[] = [];
  for (let hour = 0; hour <= lastHour; hour += 1) {
    for (let minute = 0; minute < MINUTES_PER_HOUR; minute += 1) {
      for (const entry of schedule) {
        if (entry.hours.includes(hour) && entry.minutes.includes(minute)) {
          dispatches.push(await dispatch(harness, entry.cron, WEEKDAY, hour, minute));
        }
      }
    }
  }
  return dispatches;
}

function putsOf(harness: Harness, key: string, phase?: Phase): number {
  return harness.puts.filter((put) => put.key === key && (phase === undefined || put.phase === phase)).length;
}

function seedListed(stores: NodeStores, count: number, sector = "Banks"): void {
  const symbols = directorySymbols(count);
  putJson(stores, DIRECTORY_KEY, {
    v: 1,
    builtAt: 0,
    symbols,
    tickerToIsin: Object.fromEntries(symbols.map((entry) => [entry[1], entry[0]])),
    funds: [],
  });
  for (const [isin, ticker] of symbols) {
    stores.sqlite
      .prepare("INSERT INTO symbols (isin, ticker, sector, status, backfill_state, created_at, updated_at) VALUES (?1, ?2, ?3, 'active', 'done', 0, 0)")
      .run(isin, ticker, sector);
    stores.sqlite.prepare("INSERT INTO symbol_aliases (isin, kind, value) VALUES (?1, 'ticker', ?2)").run(isin, ticker);
  }
}

function seedQueuedActions(stores: NodeStores): void {
  for (let index = 0; index < QUEUED_ACTIONS; index += 1) {
    stores.sqlite
      .prepare("INSERT INTO corporate_actions (isin, kind, ex_date, ratio, status, source) VALUES (?1, 'bonus', ?2, ?3, 'recorded', 'mubasher')")
      .run(isinOf(index), EX_DATE, BONUS_RATIO);
    for (const date of BAR_DATES) {
      stores.sqlite
        .prepare(
          `INSERT INTO daily_bars (isin, session_date, open, high, low, close, volume, adj_open, adj_high, adj_low, adj_close, source)
           VALUES (?1, ?2, 10, 11, 9, 10, 1000, 10, 11, 9, 10, 'tradingview')`,
        )
        .run(isinOf(index), date);
    }
  }
}

function seedExpiredRows(stores: NodeStores, now: number): void {
  for (let index = 0; index < EXPIRED_EVENTS; index += 1) {
    stores.sqlite
      .prepare("INSERT INTO market_events (kind, occurred_at, isin, payload) VALUES ('big_move', ?1, ?2, '{}')")
      .run(now - EVENT_AGE_DAYS * SECONDS_PER_DAY - index, isinOf(index % CAP_SYMBOL_COUNT));
  }
  const day = new Date((now - USAGE_AGE_DAYS * SECONDS_PER_DAY) * MS_PER_SECOND).toISOString().slice(0, 10);
  for (let index = 0; index < EXPIRED_USAGE_ROWS; index += 1) {
    stores.sqlite.prepare("INSERT INTO usage_daily (day, user_id, tool, calls) VALUES (?1, ?2, 'search', 1)").run(day, `user-${index}`);
  }
}

function seedStaleFunds(stores: NodeStores): void {
  for (let index = 0; index < STALE_FUNDS; index += 1) {
    const fundId = `stale-${index}`;
    stores.sqlite.prepare("INSERT INTO funds (fund_id, name_ar, currency, cycle_days, status) VALUES (?1, ?2, 'EGP', 1, 'active')").run(fundId, fundId);
    for (const date of ["2026-09-01", "2026-09-02", "2026-09-03"]) {
      stores.sqlite.prepare("INSERT INTO nav_records (fund_id, nav_date, nav, source) VALUES (?1, ?2, 10, 'mubasher')").run(fundId, date);
    }
  }
}

function countRows(stores: NodeStores, table: string): number {
  return (stores.sqlite.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }).total;
}

function appliedActions(stores: NodeStores): number {
  return (stores.sqlite.prepare("SELECT COUNT(*) AS total FROM corporate_actions WHERE status = 'applied'").get() as { total: number }).total;
}

function noticeSteps(stores: NodeStores): string[] {
  const rows = stores.sqlite.prepare("SELECT kind, details FROM notices").all() as { kind: string; details: string }[];
  const steps = rows.map((row) => (row.kind === "fund_stale" ? "funds" : String((JSON.parse(row.details) as { step?: string }).step)));
  return [...new Set(steps)];
}

describe("scheduled budget", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("wrangler crons", () => {
    it("dispatches every wrangler cron to a job", async () => {
      expect(CRONS).toHaveLength(PHASE_OF_CRON.size);
      const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const harness = instrument(createNodeStores(), { symbolCount: SYMBOL_COUNT, tick: () => 0, tradeTime: SESSION_TRADE_TIME });
      for (const cron of CRONS) await dispatch(harness, cron, WEEKDAY, END_OF_DAY_UTC_HOUR, END_OF_DAY_UTC_MINUTE);
      expect(errors.mock.calls.filter(([message]) => message === "unknown cron")).toEqual([]);
    });
  });

  describe("a whole trading day through scheduled()", () => {
    it("keeps KV writes and subrequests within budget on a normal day", async () => {
      const stores = createNodeStores();
      seedListed(stores, SYMBOL_COUNT);
      let tick = 0;
      const harness = instrument(stores, { symbolCount: SYMBOL_COUNT, tick: () => (tick += 1), tradeTime: SESSION_TRADE_TIME });

      const dispatches = await runWeekday(harness);

      expect(harness.puts.length).toBeLessThanOrEqual(MAX_DAY_WRITES);
      expect(harness.puts.length + loadConfig(harness.env).oauthDailyKvWrites).toBeLessThanOrEqual(MAX_KV_WRITES_WITH_OAUTH);
      expect(putsOf(harness, SNAPSHOT_KEY, "snapshot")).toBeLessThanOrEqual(MAX_SNAPSHOT_WRITES);
      expect(putsOf(harness, SNAPSHOT_KEY, "snapshot")).toBeGreaterThan(0);
      expect(putsOf(harness, SNAPSHOT_KEY, "reference")).toBe(1);
      expect(noticeSteps(stores)).not.toContain("metalsFx");
      expect(putsOf(harness, LAST_SESSION_KEY)).toBe(1);
      expect(putsOf(harness, INDEX_CLOSES_KEY)).toBe(1);
      expect(putsOf(harness, STATS_KEY)).toBe(1);
      expect(putsOf(harness, DIRECTORY_KEY)).toBeLessThanOrEqual(MAX_DIRECTORY_WRITES);
      for (const entry of dispatches.filter((item) => item.phase === "snapshot")) {
        expect(entry.subrequests).toBeLessThanOrEqual(MAX_TICK_SUBREQUESTS);
      }
      for (const entry of dispatches.filter((item) => item.phase !== "snapshot")) {
        expect(entry.subrequests).toBeLessThanOrEqual(MAX_JOB_SUBREQUESTS);
      }
    }, DAY_TEST_TIMEOUT_MS);

    it("allows one more write and 25 subrequests on the tick that bootstraps the listings", async () => {
      let tick = 0;
      const harness = instrument(createNodeStores(), { symbolCount: SYMBOL_COUNT, tick: () => (tick += 1), tradeTime: SESSION_TRADE_TIME });

      const dispatches = await runWeekday(harness);

      const snapshots = dispatches.filter((item) => item.phase === "snapshot");
      expect(snapshots[0]!.subrequests).toBeGreaterThan(0);
      expect(snapshots[0]!.subrequests).toBeLessThanOrEqual(MAX_BOOTSTRAP_SUBREQUESTS);
      for (const entry of snapshots.slice(1)) expect(entry.subrequests).toBeLessThanOrEqual(MAX_TICK_SUBREQUESTS);
      expect(harness.puts.length).toBeLessThanOrEqual(MAX_BOOTSTRAP_DAY_WRITES);
      expect(harness.puts.length + loadConfig(harness.env).oauthDailyKvWrites).toBeLessThanOrEqual(MAX_KV_WRITES_WITH_OAUTH);
      expect(putsOf(harness, DIRECTORY_KEY, "snapshot")).toBe(1);
      expect(putsOf(harness, DIRECTORY_KEY)).toBeLessThanOrEqual(MAX_BOOTSTRAP_DIRECTORY_WRITES);
      expect(putsOf(harness, STATS_KEY)).toBe(1);
    }, DAY_TEST_TIMEOUT_MS);
  });

  describe("end-of-day cron", () => {
    async function runEndOfDay(newListings: number, down: UpstreamKind[]) {
      const stores = createNodeStores();
      seedListed(stores, SYMBOL_COUNT);
      seedQueuedActions(stores);
      const failing = new Set<UpstreamKind>();
      const harness = instrument(stores, {
        symbolCount: SYMBOL_COUNT,
        newListings,
        tick: () => 0,
        tradeTime: SESSION_TRADE_TIME,
        isDown: (kind) => failing.has(kind),
      });
      await dispatch(harness, SNAPSHOT_CRON, WEEKDAY, SNAPSHOT_TICK.hour, SNAPSHOT_TICK.minute);
      down.forEach((kind) => failing.add(kind));
      harness.statements.length = 0;
      const result = await dispatch(harness, END_OF_DAY_CRON, WEEKDAY, END_OF_DAY_UTC_HOUR, END_OF_DAY_UTC_MINUTE);
      return { harness, result };
    }

    it("applies 2 of 8 queued actions with 20 new listings and the backup closes failing", async () => {
      const { harness, result } = await runEndOfDay(NEW_LISTINGS, ["mubasher-prices"]);

      expect(result.subrequests).toBeLessThanOrEqual(MAX_JOB_SUBREQUESTS);
      expect(harness.statements.length).toBeLessThanOrEqual(MAX_END_OF_DAY_STATEMENTS);
      expect(harness.statements.filter((sql) => sql.includes(NOTICE_INSERT))).toHaveLength(1);
      expect(appliedActions(harness.stores)).toBe(APPLIED_PER_RUN);
      expect(countRows(harness.stores, "index_values")).toBeGreaterThan(0);
      expect(countRows(harness.stores, "symbols")).toBe(SYMBOL_COUNT + NEW_LISTINGS);
    });

    it("applies 2 of 8 queued actions with both listing sources and the backup closes failing", async () => {
      const { harness, result } = await runEndOfDay(NEW_LISTINGS, ["tv-stocks", "mubasher-listed", "mubasher-prices"]);

      expect(result.subrequests).toBeLessThanOrEqual(MAX_JOB_SUBREQUESTS);
      expect(harness.statements.length).toBeLessThanOrEqual(MAX_END_OF_DAY_STATEMENTS);
      expect(harness.statements.filter((sql) => sql.includes(NOTICE_INSERT))).toHaveLength(1);
      expect(appliedActions(harness.stores)).toBe(APPLIED_PER_RUN);
      expect(countRows(harness.stores, "index_values")).toBeGreaterThan(0);
      const usage = harness.stores.sqlite.prepare("SELECT COALESCE(SUM(backfill_rows), 0) AS total FROM usage_global").get() as { total: number };
      expect(usage.total).toBe(0);
    });
  });

  describe("reference cron", () => {
    it("stays within 30 statements with 20 needs_ratio actions, 20 stale funds, failing fund pages and full purge chunks", async () => {
      const stores = createNodeStores();
      seedListed(stores, SYMBOL_COUNT);
      seedStaleFunds(stores);
      seedExpiredRows(stores, utcSeconds(WEEKDAY, REFERENCE_UTC_HOUR));
      const harness = instrument(stores, {
        symbolCount: SYMBOL_COUNT,
        fundPages: FUND_PAGES,
        actionRows: ACTION_ROWS,
        tick: () => 0,
        tradeTime: SESSION_TRADE_TIME,
        isDown: (kind) => kind === "mubasher-funds-later" || kind === "tv-fundamentals",
      });

      const result = await dispatch(harness, REFERENCE_CRON, WEEKDAY, REFERENCE_UTC_HOUR, 0);

      const noticeStatements = harness.statements.filter((sql) => sql.includes(NOTICE_INSERT)).length;
      expect(result.subrequests).toBeLessThanOrEqual(MAX_JOB_SUBREQUESTS);
      expect(harness.statements.length).toBeLessThanOrEqual(MAX_REFERENCE_STATEMENTS);
      expect(noticeSteps(stores).length).toBeGreaterThan(1);
      expect(noticeStatements).toBe(noticeSteps(stores).length);
      expect(noticeStatements).toBeLessThanOrEqual(REFERENCE_STEPS);
      expect(countRows(stores, "corporate_actions")).toBe(ACTION_ROWS);
    });
  });

  describe("D1 rows written at the input caps", () => {
    function capsHarness(): Harness {
      const stores = createNodeStores();
      seedListed(stores, CAP_SYMBOL_COUNT, "Legacy");
      seedExpiredRows(stores, utcSeconds(WEEKDAY, REFERENCE_UTC_HOUR));
      return instrument(stores, {
        symbolCount: CAP_SYMBOL_COUNT,
        fundPages: FUND_PAGES,
        actionRows: ACTION_ROWS,
        tick: () => 0,
        tradeTime: SESSION_TRADE_TIME,
      });
    }

    it("keeps end-of-day plus reference within the jobs reserve", async () => {
      const harness = capsHarness();
      await dispatch(harness, SNAPSHOT_CRON, WEEKDAY, SNAPSHOT_TICK.hour, SNAPSHOT_TICK.minute);
      const before = harness.stores.rowsWritten();

      await dispatch(harness, END_OF_DAY_CRON, WEEKDAY, END_OF_DAY_UTC_HOUR, END_OF_DAY_UTC_MINUTE);
      await dispatch(harness, REFERENCE_CRON, WEEKDAY, REFERENCE_UTC_HOUR, 0);

      expect(harness.stores.rowsWritten() - before).toBeLessThanOrEqual(JOBS_D1_ROWS_RESERVE);
      expect(countRows(harness.stores, "daily_bars")).toBe(CAP_SYMBOL_COUNT);
      expect(countRows(harness.stores, "financial_figures")).toBe(CAP_SYMBOL_COUNT * FINANCIAL_METRICS_PER_SYMBOL);
    });

    it("keeps the purge step alone within its bound", async () => {
      const harness = capsHarness();
      harness.fetchStub.mockImplementation(async () => new Response("down", { status: 500 }));

      await dispatch(harness, REFERENCE_CRON, WEEKDAY, REFERENCE_UTC_HOUR, 0);

      expect(countRows(harness.stores, "market_events")).toBe(EXPIRED_EVENTS - EVENT_PURGE_LIMIT);
      expect(countRows(harness.stores, "usage_daily")).toBe(EXPIRED_USAGE_ROWS - USAGE_PURGE_LIMIT);
      const purged = harness.stores.rowsWrittenTo("market_events") + harness.stores.rowsWrittenTo("usage_daily");
      expect(purged).toBe(MAX_PURGE_ROWS);
    });

    it("keeps reference plus maintenance on a Saturday within the jobs reserve and writes only a job_state row for maintenance", async () => {
      const harness = capsHarness();
      const before = harness.stores.rowsWritten();

      await dispatch(harness, REFERENCE_CRON, SATURDAY, REFERENCE_UTC_HOUR, 0);
      const afterReference = harness.stores.rowsWritten();
      await dispatch(harness, MAINTENANCE_CRON, SATURDAY, MAINTENANCE_UTC_HOUR, 0);

      expect(harness.stores.rowsWritten() - before).toBeLessThanOrEqual(JOBS_D1_ROWS_RESERVE);
      expect(harness.stores.rowsWritten() - afterReference).toBe(1);
    });
  });

  describe("admin apply_queued_actions", () => {
    it("issues at most 30 statements with limit 3", async () => {
      const stores = createNodeStores({ OWNER_EMAILS: OWNER_EMAIL });
      seedListed(stores, SYMBOL_COUNT);
      seedQueuedActions(stores);
      stores.sqlite.prepare("INSERT INTO job_state (job, last_run_date) VALUES ('eod_bars', ?1)").run(WEEKDAY);
      const harness = instrument(stores, { symbolCount: SYMBOL_COUNT, tick: () => 0, tradeTime: SESSION_TRADE_TIME });
      vi.setSystemTime(utcMs(WEEKDAY, ADMIN_CALL_HOUR, 0));
      harness.statements.length = 0;

      const result = await callNodeTool(harness.env, "admin", { action: "apply_queued_actions", limit: ADMIN_APPLY_LIMIT });

      expect(result.isError).toBeFalsy();
      expect(appliedActions(stores)).toBe(ADMIN_APPLY_LIMIT);
      expect(harness.statements.length).toBeLessThanOrEqual(MAX_ADMIN_APPLY_STATEMENTS);
    });
  });

  describe("tool call accounting", () => {
    it("writes exactly 2 D1 rows for one served call", async () => {
      const stores = createNodeStores();
      seedListed(stores, SYMBOL_COUNT);
      const before = stores.rowsWritten();

      const result = await callNodeTool(stores.env, "search", { query: tickerOf(0) });

      expect(result.isError).toBeFalsy();
      expect(stores.rowsWritten() - before).toBe(ACCOUNTING_ROWS_PER_CALL);
    });
  });
});
