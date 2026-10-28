import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { utcDay } from "../../src/domain/calendar";
import { referenceJob } from "../../src/jobs/reference";
import { insertEvents } from "../../src/store/d1/events";
import { __resetKvMemo, getPurgeCursor, putPurgeCursor } from "../../src/store/kv";
import mubasherFunds from "../fixtures/mubasher-funds-p1.json";
import { restoreBindings, setBindings } from "../helpers/bindings";
import { clearStores, createJobRunner, firstPageOnly, notFound, readNotices, requestUrl } from "../helpers/jobs";
import { seedCalendar } from "../helpers/seed";

const { getOAuthApi, purgeExpiredData } = vi.hoisted(() => ({
  getOAuthApi: vi.fn(),
  purgeExpiredData: vi.fn(),
}));

vi.mock("@cloudflare/workers-oauth-provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@cloudflare/workers-oauth-provider")>()),
  getOAuthApi,
}));

const SATURDAY = "2026-10-24";
const MAINTENANCE_TIME = "04:00";
const REFERENCE_DAY = "2026-10-22";
const REFERENCE_TIME = "19:00";
const PUBLIC_ORIGIN = "https://egx.example.com";
const RESOURCE_URL = "https://egx.example.com/mcp";
const TOKEN_ENDPOINT = "/token";
const PURGE_CURSOR_KEY = "oauth:purge-cursor";
const MAINTENANCE_JOB = "maintenance";
const PURGE_STEP = "purge";
const PURGE_BATCH_SIZE = 250;
const SAVED_CURSOR = "grants:abc";
const NEXT_CURSOR = "tokens:def";
const MUBASHER_FUNDS_URL = "https://www.mubasher.info/api/1/funds";
const JOB_FAILED = "job_failed";
const SECONDS_PER_DAY = 86400;
const MS_PER_DAY = SECONDS_PER_DAY * 1000;
const EVENT_RETENTION_DAYS = 400;
const USAGE_RETENTION_DAYS = 90;
const EXPIRED_EVENT_COUNT = 1500;
const EVENT_PURGE_LIMIT = 1200;
const EXPIRED_USAGE_COUNT = 3500;
const USAGE_PURGE_LIMIT = 3000;
const EVENT_SPACING_SECONDS = 10;
const EVENT_AGE_SECONDS = 100000;
const OLDEST_USAGE_DAY_MS = Date.UTC(2010, 0, 1);
const USER_ID = "user-1";
const TOOL = "get_quotes";
const SEED_EVENT_KIND = "disclosure";
const UNTOUCHED_TABLES_QUERY =
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT IN ('d1_migrations', 'job_state')";
const STORE_TABLES = [
  "market_events",
  "usage_daily",
  "notices",
  "job_state",
  "market_calendar",
  "funds",
  "nav_records",
];

let maintenanceJob: typeof import("../../src/jobs/maintenance").maintenanceJob;

type PurgeResult = {
  grantsChecked: number;
  grantsPurged: number;
  tokensChecked: number;
  tokensPurged: number;
  done: boolean;
  cursor?: string;
};

type PlanRow = { detail: string };

const EMPTY_PURGE: PurgeResult = { grantsChecked: 0, grantsPurged: 0, tokensChecked: 0, tokensPurged: 0, done: true };

function stubPurge(result: PurgeResult = EMPTY_PURGE) {
  purgeExpiredData.mockResolvedValue(result);
  getOAuthApi.mockReturnValue({ purgeExpiredData });
}

function createMaintenanceRunner() {
  return createJobRunner(maintenanceJob, { date: SATURDAY, time: MAINTENANCE_TIME });
}

function createReferenceRunner() {
  return createJobRunner(referenceJob, { date: REFERENCE_DAY, time: REFERENCE_TIME });
}

async function countRows(table: string, where = "1 = 1"): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE ${where}`).first<{ total: number }>();
  return row?.total ?? 0;
}

async function tableCounts(): Promise<Record<string, number>> {
  const { results } = await env.DB.prepare(UNTOUCHED_TABLES_QUERY).all<{ name: string }>();
  const counts = await Promise.all(results.map(async ({ name }) => [name, await countRows(name)] as const));
  return Object.fromEntries(counts);
}

async function readJobStateJobs(): Promise<string[]> {
  const { results } = await env.DB.prepare("SELECT job FROM job_state ORDER BY job").all<{ job: string }>();
  return results.map((row) => row.job);
}

async function readPurgeFailures() {
  const failures = await readNotices(JOB_FAILED);
  return failures.filter((notice) => notice.details.step === PURGE_STEP);
}

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (!url.startsWith(MUBASHER_FUNDS_URL)) return notFound();
      return firstPageOnly(mubasherFunds)(Number(new URL(url).searchParams.get("page")));
    }),
  );
}

function referenceNow(): number {
  return Date.parse(`${REFERENCE_DAY}T16:00:00Z`) / 1000;
}

function eventCutoff(): number {
  return referenceNow() - EVENT_RETENTION_DAYS * SECONDS_PER_DAY;
}

function usageCutoffDay(): string {
  return utcDay(referenceNow() - USAGE_RETENTION_DAYS * SECONDS_PER_DAY);
}

function usageDay(index: number): string {
  return new Date(OLDEST_USAGE_DAY_MS + index * MS_PER_DAY).toISOString().slice(0, 10);
}

function dayAfter(day: string, offset: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + offset * MS_PER_DAY).toISOString().slice(0, 10);
}

function seedEventsAt(times: number[]): Promise<void> {
  return insertEvents(
    env.DB,
    times.map((occurredAt) => ({ kind: SEED_EVENT_KIND, occurredAt, isin: null, fundId: null, payload: {} })),
  );
}

async function seedExpiredEvents(): Promise<void> {
  const oldest = eventCutoff() - EVENT_AGE_SECONDS;
  await seedEventsAt(Array.from({ length: EXPIRED_EVENT_COUNT }, (_, index) => oldest + index * EVENT_SPACING_SECONDS));
}

async function seedFreshEvents(): Promise<void> {
  await seedEventsAt([eventCutoff(), eventCutoff() + 1, referenceNow() - SECONDS_PER_DAY]);
}

async function seedUsageDays(days: string[]): Promise<void> {
  const rows = days.map((day) => ({ day, user_id: USER_ID, tool: TOOL, calls: 1 }));
  await env.DB
    .prepare(
      `INSERT INTO usage_daily (day, user_id, tool, calls)
       SELECT json_extract(value, '$.day'), json_extract(value, '$.user_id'), json_extract(value, '$.tool'),
              json_extract(value, '$.calls')
       FROM json_each(?1) WHERE true`,
    )
    .bind(JSON.stringify(rows))
    .run();
}

async function seedExpiredUsage(): Promise<void> {
  await seedUsageDays(Array.from({ length: EXPIRED_USAGE_COUNT }, (_, index) => usageDay(index)));
}

async function seedFreshUsage(): Promise<void> {
  await seedUsageDays([usageCutoffDay(), dayAfter(usageCutoffDay(), 1)]);
}

async function minOf(table: string, column: string, where: string): Promise<number | string | null> {
  const row = await env.DB.prepare(`SELECT MIN(${column}) AS value FROM ${table} WHERE ${where}`).first<{
    value: number | string | null;
  }>();
  return row?.value ?? null;
}

function recordedDelete(statements: string[], table: string): string {
  const sql = statements.find((statement) => statement.trim().startsWith(`DELETE FROM ${table}`));
  if (sql === undefined) throw new Error(`no delete recorded for ${table}`);
  return sql;
}

async function explain(sql: string): Promise<string> {
  const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(1, 1).all<PlanRow>();
  return results.map((row) => row.detail).join("\n");
}

function failStatementsContaining(fragment: string): void {
  const original = env.DB.prepare.bind(env.DB);
  vi.spyOn(env.DB, "prepare").mockImplementation((sql: string) => {
    if (sql.includes(fragment)) throw new Error("delete failed");
    return original(sql);
  });
}

describe("maintenanceJob", () => {
  beforeEach(async () => {
    vi.resetModules();
    ({ maintenanceJob } = await import("../../src/jobs/maintenance"));
    await clearStores([PURGE_CURSOR_KEY], STORE_TABLES);
    setBindings({ PUBLIC_ORIGIN });
    stubPurge();
  });

  afterEach(() => {
    restoreBindings();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    getOAuthApi.mockReset();
    purgeExpiredData.mockReset();
  });

  it("runs on a holiday", async () => {
    await seedCalendar([{ date: SATURDAY, kind: "holiday" }]);

    await createMaintenanceRunner().run();

    expect(purgeExpiredData).toHaveBeenCalledTimes(1);
    expect(await readJobStateJobs()).toEqual([MAINTENANCE_JOB]);
  });

  it("does nothing and succeeds with empty tables", async () => {
    const before = await tableCounts();

    await expect(createMaintenanceRunner().run()).resolves.not.toThrow();

    expect(await tableCounts()).toEqual(before);
    expect(await readNotices(JOB_FAILED)).toEqual([]);
  });

  it("builds the OAuth helpers from the public origin", async () => {
    await createMaintenanceRunner().run();

    expect(getOAuthApi).toHaveBeenCalledTimes(1);
    const [options] = getOAuthApi.mock.calls[0] as [{ tokenEndpoint: string; resourceMetadata: { resource: string } }];
    expect(options.tokenEndpoint).toBe(TOKEN_ENDPOINT);
    expect(options.resourceMetadata.resource).toBe(RESOURCE_URL);
  });

  it("calls the purge once with batchSize 250 and no cursor on the first run", async () => {
    await createMaintenanceRunner().run();

    expect(purgeExpiredData).toHaveBeenCalledTimes(1);
    const [options] = purgeExpiredData.mock.calls[0] as [{ batchSize: number; cursor?: string }];
    expect(options.batchSize).toBe(PURGE_BATCH_SIZE);
    expect(options.cursor ?? undefined).toBeUndefined();
  });

  it("resumes the purge from the stored cursor", async () => {
    await putPurgeCursor(env, SAVED_CURSOR);
    __resetKvMemo();

    await createMaintenanceRunner().run();

    expect(purgeExpiredData).toHaveBeenCalledWith({ batchSize: PURGE_BATCH_SIZE, cursor: SAVED_CURSOR });
  });

  it("stores the cursor the purge returns", async () => {
    stubPurge({ ...EMPTY_PURGE, done: false, cursor: NEXT_CURSOR });
    const runner = createMaintenanceRunner();

    await runner.run();
    __resetKvMemo();

    expect(await getPurgeCursor(env)).toBe(NEXT_CURSOR);
    expect(runner.kvWrites.filter((key) => key === PURGE_CURSOR_KEY)).toHaveLength(1);
  });

  it("clears the stored cursor when the purge is done", async () => {
    await putPurgeCursor(env, SAVED_CURSOR);
    __resetKvMemo();
    stubPurge({ ...EMPTY_PURGE, done: true });

    await createMaintenanceRunner().run();
    __resetKvMemo();

    expect(await getPurgeCursor(env)).toBeNull();
  });

  it("raises job_failed when the purge fails and leaves the cursor as it was", async () => {
    await putPurgeCursor(env, SAVED_CURSOR);
    __resetKvMemo();
    purgeExpiredData.mockRejectedValue(new Error("kv unavailable"));

    await createMaintenanceRunner().run();
    __resetKvMemo();
    const failures = await readNotices(JOB_FAILED);

    expect(failures).toHaveLength(1);
    expect(failures[0]?.details).toMatchObject({ job: MAINTENANCE_JOB, error: "kv unavailable" });
    expect(await getPurgeCursor(env)).toBe(SAVED_CURSOR);
  });

  it("skips the purge and logs when PUBLIC_ORIGIN is empty", async () => {
    setBindings({ PUBLIC_ORIGIN: "" });
    const logged = [
      vi.spyOn(console, "error").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "log").mockImplementation(() => undefined),
    ];

    await createMaintenanceRunner().run();

    expect(getOAuthApi).not.toHaveBeenCalled();
    expect(purgeExpiredData).not.toHaveBeenCalled();
    expect(logged.some((spy) => spy.mock.calls.length > 0)).toBe(true);
    expect(await readNotices(JOB_FAILED)).toEqual([]);
  });

  it("issues no D1 delete", async () => {
    const runner = createMaintenanceRunner();

    await runner.run();

    expect(runner.statements.length).toBeGreaterThan(0);
    expect(runner.statements.filter((sql) => /^\s*DELETE\b/i.test(sql))).toEqual([]);
  });

  it("writes job_state job maintenance and no other D1 row", async () => {
    await seedFreshEvents();
    await seedFreshUsage();
    const before = await tableCounts();

    await createMaintenanceRunner().run();

    expect(await readJobStateJobs()).toEqual([MAINTENANCE_JOB]);
    expect(await tableCounts()).toEqual(before);
  });
});

describe("referenceJob purge step", () => {
  beforeEach(async () => {
    await clearStores([], STORE_TABLES);
    stubFetch();
  });

  afterEach(() => {
    restoreBindings();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("deletes the 1,200 oldest expired events and the 3,000 oldest expired usage rows and nothing newer", async () => {
    await seedExpiredEvents();
    await seedFreshEvents();
    await seedExpiredUsage();
    await seedFreshUsage();

    await createReferenceRunner().run();

    const expiredEvents = `occurred_at < ${eventCutoff()}`;
    const expiredUsage = `day < '${usageCutoffDay()}'`;
    const oldestSurvivingEvent = eventCutoff() - EVENT_AGE_SECONDS + EVENT_PURGE_LIMIT * EVENT_SPACING_SECONDS;
    expect(await countRows("market_events", `kind = '${SEED_EVENT_KIND}'`)).toBe(
      EXPIRED_EVENT_COUNT - EVENT_PURGE_LIMIT + 3,
    );
    expect(await countRows("market_events", expiredEvents)).toBe(EXPIRED_EVENT_COUNT - EVENT_PURGE_LIMIT);
    expect(await minOf("market_events", "occurred_at", expiredEvents)).toBe(oldestSurvivingEvent);
    expect(await countRows("usage_daily")).toBe(EXPIRED_USAGE_COUNT - USAGE_PURGE_LIMIT + 2);
    expect(await countRows("usage_daily", expiredUsage)).toBe(EXPIRED_USAGE_COUNT - USAGE_PURGE_LIMIT);
    expect(await minOf("usage_daily", "day", expiredUsage)).toBe(usageDay(USAGE_PURGE_LIMIT));
    expect(await readPurgeFailures()).toEqual([]);
  });

  it("runs on a holiday", async () => {
    await seedCalendar([{ date: REFERENCE_DAY, kind: "holiday" }]);
    await seedExpiredEvents();
    await seedExpiredUsage();

    await createReferenceRunner().run();

    expect(await countRows("market_events", `occurred_at < ${eventCutoff()}`)).toBe(
      EXPIRED_EVENT_COUNT - EVENT_PURGE_LIMIT,
    );
    expect(await countRows("usage_daily")).toBe(EXPIRED_USAGE_COUNT - USAGE_PURGE_LIMIT);
  });

  it("writes nothing when nothing is expired", async () => {
    await seedFreshEvents();
    await seedFreshUsage();
    const eventsBefore = await countRows("market_events", `kind = '${SEED_EVENT_KIND}'`);
    const usageBefore = await countRows("usage_daily");

    await createReferenceRunner().run();

    expect(await countRows("market_events", `kind = '${SEED_EVENT_KIND}'`)).toBe(eventsBefore);
    expect(await countRows("usage_daily")).toBe(usageBefore);
    expect(await readPurgeFailures()).toEqual([]);
  });

  it("uses idx_events_time for the event delete and the primary key for the usage delete", async () => {
    const runner = createReferenceRunner();

    await runner.run();

    expect(await explain(recordedDelete(runner.statements, "market_events"))).toContain("idx_events_time");
    expect(await explain(recordedDelete(runner.statements, "usage_daily"))).toContain("PRIMARY KEY");
  });

  it.each([
    ["market_events", "DELETE FROM market_events"],
    ["usage_daily", "DELETE FROM usage_daily"],
  ])("raises job_failed and keeps the earlier steps' writes when the %s delete fails", async (_table, fragment) => {
    failStatementsContaining(fragment);

    await createReferenceRunner().run();
    const failures = await readPurgeFailures();

    expect(failures).toHaveLength(1);
    expect(failures[0]?.details).toMatchObject({ job: "reference", step: PURGE_STEP });
    expect(await countRows("funds")).toBe(mubasherFunds.rows.length);
    expect(await countRows("nav_records")).toBe(mubasherFunds.rows.length);
  });
});
