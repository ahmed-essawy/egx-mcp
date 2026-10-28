import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApplyCandidate } from "../../src/domain/adjust";
import { ADJUST_BATCH_OVERHEAD_ROWS } from "../../src/domain/budget";
import { NOTICE } from "../../src/mcp/envelope";
import { applyAdjustment, readApplyCandidates } from "../../src/store/d1/bars";
import { clearState, restoreBindings, setBindings } from "../helpers/bindings";
import { callTool, errorCodeOf, payloadOf as structuredPayloadOf, postMcp, type ToolResult } from "../helpers/mcp";
import {
  seedBars,
  seedKey,
  seedSnapshot,
  seedSymbols,
  seedUser,
  setNow,
  stockSymbol,
  syntheticIsin,
  syntheticTicker,
} from "../helpers/seed";
import { cairoSummerEpoch } from "../helpers/time";

const AFTER_CLOSE = cairoSummerEpoch("2026-10-25", "15:00");
const UTC_DAY = "2026-10-25";
const LATEST_SESSION = "2026-10-22";
const EX_DATE = "2026-10-21";
const FUTURE_EX_DATE = "2026-10-27";
const PRE_EX_DATES = ["2026-10-18", "2026-10-19", "2026-10-20"];
const POST_EX_DATE = "2026-10-22";
const OWNER_EMAIL = "owner@example.com";
const USER_EMAIL = "user@example.com";
const ADMIN_TOOL = "admin";
const HISTORY_TOOL = "get_price_history";
const MAIN = 0;
const PENDING_SYMBOL = 9;
const ADJUST_CAP = 10_000;
const PERSONAL_CAP = 10;
const BIG_HISTORY_BARS = 1250;
const CAP_HEADROOM = 1300;
const SEED_CHUNK = 250;
const MS_PER_DAY = 86_400_000;
const BIG_HISTORY_START = Date.UTC(2023, 0, 1);
const PRICE = 100;
const POST_EX_PRICE = 80;
const BONUS_RATIO = 0.25;
const BONUS_FACTOR = 0.8;
const CORRECTED_RATIO = 0.5;
const RELATIVE_TOLERANCE = 1e-9;
const NOTICES_PAGE = 2;
const MAX_NOTICE_IDS = 50;
const QUEUED_ACTIONS = 5;
const FIRST_QUEUED_SYMBOL = 1;
const MAIN_TICKER = syntheticTicker(MAIN);
const MAIN_ISIN = syntheticIsin(MAIN);
const GUARDED_TABLES = [
  "corporate_actions",
  "notices",
  "market_calendar",
  "inflation_figures",
  "source_discrepancies",
  "symbols",
  "daily_bars",
];

type Payload<T> = { data: T; meta: { label: string }; notice: string };
type Outcome = { actionId: number; status: string; rowsAdjusted: number; refusedReason: string | null };
type StoredBar = {
  session_date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adj_open: number;
  adj_high: number;
  adj_low: number;
  adj_close: number;
  adj_factor: number;
  raw_derived: number;
};
type HistoryBar = { date: string; adjClose?: number; adjustmentPending: boolean };
type HistoryData = { pendingAdjustments: { state: string }[]; bars: HistoryBar[] };
type ActionSeed = {
  index?: number;
  kind?: "bonus" | "split" | "reverse_split";
  exDate?: string;
  ratio?: number | null;
  status?: "needs_ratio" | "recorded" | "applied";
  notice?: boolean;
};
type GlobalColumn = "adjust_rows" | "personal_rows" | "calls" | "rows_read";
type RecordedStatement = { sql: string };
type NoticeItem = { id: number; kind: string; subject: string; details: unknown; createdAt: unknown; status: string };
type NoticePage = { items: NoticeItem[]; nextCursor: string | null };

function payloadOf<T>(result: ToolResult): Payload<T> {
  return structuredPayloadOf<Payload<T>>(result);
}

function admin(args: Record<string, unknown>, bearer: string): Promise<ToolResult> {
  return callTool(ADMIN_TOOL, args, bearer);
}

async function adminData<T>(args: Record<string, unknown>, bearer: string): Promise<T> {
  return payloadOf<T>(await admin(args, bearer)).data;
}

function errorMetaOf(result: ToolResult): { label: string } {
  return (result.structuredContent as unknown as { meta: { label: string } }).meta;
}

function noticeOf(result: ToolResult): string {
  return (result.structuredContent as unknown as { notice: string }).notice;
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

async function clearAdminState(): Promise<void> {
  await clearState();
  await env.DB.batch(
    [
      "corporate_actions",
      "symbols",
      "notices",
      "job_state",
      "market_calendar",
      "inflation_figures",
      "source_discrepancies",
    ].map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
  );
}

async function insertSymbol(index: number, status: "active" | "pending" = "active"): Promise<void> {
  await env.DB
    .prepare("INSERT INTO symbols (isin, ticker, status, created_at, updated_at) VALUES (?1, ?2, ?3, 0, 0)")
    .bind(syntheticIsin(index), syntheticTicker(index), status)
    .run();
}

async function setLatestSession(date: string): Promise<void> {
  await env.DB
    .prepare(
      "INSERT INTO job_state (job, last_run_date) VALUES ('eod_bars', ?1) ON CONFLICT (job) DO UPDATE SET last_run_date = excluded.last_run_date",
    )
    .bind(date)
    .run();
}

async function setSymbolState(index: number, basisDate: string | null, backfillState: string | null): Promise<void> {
  await env.DB
    .prepare("UPDATE symbols SET adj_basis_date = ?2, backfill_state = ?3 WHERE isin = ?1")
    .bind(syntheticIsin(index), basisDate, backfillState)
    .run();
}

async function setGlobal(column: GlobalColumn, value: number): Promise<void> {
  await env.DB
    .prepare(
      `INSERT INTO usage_global (day, ${column}) VALUES (?1, ?2) ON CONFLICT (day) DO UPDATE SET ${column} = excluded.${column}`,
    )
    .bind(UTC_DAY, value)
    .run();
}

async function readGlobalColumn(column: GlobalColumn): Promise<number> {
  const row = await env.DB
    .prepare(`SELECT ${column} AS total FROM usage_global WHERE day = ?1`)
    .bind(UTC_DAY)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

async function seedMainBars(index = MAIN): Promise<void> {
  await seedBars(syntheticIsin(index), [
    ...PRE_EX_DATES.map((date) => ({ sessionDate: date, open: PRICE, high: PRICE, low: PRICE, close: PRICE })),
    { sessionDate: EX_DATE, open: POST_EX_PRICE, high: POST_EX_PRICE, low: POST_EX_PRICE, close: POST_EX_PRICE },
    { sessionDate: POST_EX_DATE, open: POST_EX_PRICE, high: POST_EX_PRICE, low: POST_EX_PRICE, close: POST_EX_PRICE },
  ]);
}

async function seedBigHistory(index: number): Promise<void> {
  const rows = Array.from({ length: BIG_HISTORY_BARS }, (_value, offset) => ({
    sessionDate: new Date(BIG_HISTORY_START + offset * MS_PER_DAY).toISOString().slice(0, 10),
    open: 10,
    high: 10,
    low: 10,
    close: 10,
  }));
  for (let start = 0; start < rows.length; start += SEED_CHUNK) {
    await seedBars(syntheticIsin(index), rows.slice(start, start + SEED_CHUNK));
  }
}

async function seedAction(action: ActionSeed = {}): Promise<number> {
  const { index = MAIN, kind = "bonus", exDate = EX_DATE, ratio = null, status = "needs_ratio", notice = true } = action;
  const result = await env.DB
    .prepare(
      `INSERT INTO corporate_actions (isin, kind, announced_on, ex_date, ratio, status, source, created_at, updated_at)
       VALUES (?1, ?2, '2026-10-10', ?3, ?4, ?5, 'mubasher', 0, 0)`,
    )
    .bind(syntheticIsin(index), kind, exDate, ratio, status)
    .run();
  if (notice && status !== "applied") await seedNotice(index, kind, exDate);
  return result.meta.last_row_id;
}

async function seedNotice(index: number, kind: string, exDate: string): Promise<void> {
  const subject = `${syntheticTicker(index)} ${kind} ${exDate}`;
  await env.DB
    .prepare(
      `INSERT INTO notices (kind, subject, details, created_at, status, dedupe_key)
       VALUES ('needs_ratio', ?1, '{}', 0, 'open', ?2)`,
    )
    .bind(subject, `needs_ratio|${subject}|${UTC_DAY}`)
    .run();
}

async function seedPlainNotices(statuses: ("open" | "done")[]): Promise<number[]> {
  const ids: number[] = [];
  for (const [index, status] of statuses.entries()) {
    const result = await env.DB
      .prepare(
        `INSERT INTO notices (kind, subject, details, created_at, status, dedupe_key)
         VALUES ('job_failed', ?1, '{}', ?2, ?3, ?4)`,
      )
      .bind(`job ${index}`, 1000 + index, status, `job_failed|${index}`)
      .run();
    ids.push(result.meta.last_row_id);
  }
  return ids;
}

async function noticeStatus(index: number, kind: string, exDate: string): Promise<string | null> {
  const row = await env.DB
    .prepare("SELECT status FROM notices WHERE kind = 'needs_ratio' AND subject = ?1")
    .bind(`${syntheticTicker(index)} ${kind} ${exDate}`)
    .first<{ status: string }>();
  return row?.status ?? null;
}

async function actionRow(actionId: number): Promise<{ status: string; ratio: number | null }> {
  const row = await env.DB
    .prepare("SELECT status, ratio FROM corporate_actions WHERE id = ?1")
    .bind(actionId)
    .first<{ status: string; ratio: number | null }>();
  if (!row) throw new Error(`action ${actionId} missing`);
  return row;
}

async function readStoredBars(index = MAIN): Promise<StoredBar[]> {
  const { results } = await env.DB
    .prepare(
      `SELECT session_date, open, high, low, close, adj_open, adj_high, adj_low, adj_close, adj_factor, raw_derived
       FROM daily_bars WHERE isin = ?1 ORDER BY session_date`,
    )
    .bind(syntheticIsin(index))
    .all<StoredBar>();
  return results;
}

async function countRows(table: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS total FROM ${table}`).first<{ total: number }>();
  return row?.total ?? 0;
}

async function history(key: string): Promise<HistoryData> {
  const result = await callTool(
    HISTORY_TOOL,
    { symbol: MAIN_TICKER, from: "2026-10-01", to: LATEST_SESSION },
    key,
  );
  return payloadOf<HistoryData>(result).data;
}

function preExBars(bars: StoredBar[]): StoredBar[] {
  return bars.filter((bar) => bar.session_date < EX_DATE);
}

function expectBarsClose(actual: StoredBar[], expected: StoredBar[]): void {
  expect(actual).toHaveLength(expected.length);
  for (const [index, bar] of expected.entries()) {
    const found = actual[index]!;
    expect(found.session_date).toBe(bar.session_date);
    expect(found.raw_derived).toBe(bar.raw_derived);
    for (const column of ["open", "high", "low", "close", "adj_open", "adj_high", "adj_low", "adj_close", "adj_factor"] as const) {
      expect(Math.abs(found[column] - bar[column]) / Math.abs(bar[column])).toBeLessThan(RELATIVE_TOLERANCE);
    }
  }
}

function recordStatements(): RecordedStatement[] {
  const recorded: RecordedStatement[] = [];
  const original = env.DB.prepare.bind(env.DB);
  vi.spyOn(env.DB, "prepare").mockImplementation((sql: string) => {
    recorded.push({ sql });
    return original(sql);
  });
  return recorded;
}

type BatchOutcome = { meta: { rows_written: number } }[];

function recordBatchRows(): Promise<number>[] {
  const totals: Promise<number>[] = [];
  const original = env.DB.batch.bind(env.DB);
  vi.spyOn(env.DB, "batch").mockImplementation(((statements: D1PreparedStatement[]) => {
    const outcome = original(statements) as Promise<BatchOutcome>;
    totals.push(outcome.then((results) => results.reduce((sum, result) => sum + result.meta.rows_written, 0)));
    return outcome;
  }) as typeof env.DB.batch);
  return totals;
}

async function applyQueuedAsEndOfDay(candidates: ApplyCandidate[]): Promise<void> {
  let rowsApplied = 0;
  for (const candidate of candidates) {
    const result = await applyAdjustment(
      env.DB,
      { ...candidate, adjustRowsToday: candidate.adjustRowsToday + rowsApplied },
      ADJUST_CAP,
      UTC_DAY,
      AFTER_CLOSE,
    );
    if (result.refusedReason === "daily_cap" || result.refusedReason === "concurrent_change") return;
    if (result.applied) rowsApplied += result.rows + ADJUST_BATCH_OVERHEAD_ROWS;
  }
}

async function listToolAnnotations(bearer: string): Promise<Record<string, { readOnlyHint?: boolean }>> {
  await postMcp(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "egx-test", version: "1.0.0" } },
    },
    bearer,
  );
  const response = await postMcp({ jsonrpc: "2.0", id: 2, method: "tools/list" }, bearer);
  const text = await response.text();
  const dataLine = text.split("\n").find((line) => line.startsWith("data: "));
  const body = JSON.parse(dataLine ? dataLine.slice("data: ".length) : text) as {
    result: { tools: { name: string; annotations?: { readOnlyHint?: boolean } }[] };
  };
  return Object.fromEntries(body.result.tools.map((tool) => [tool.name, tool.annotations ?? {}]));
}

describe("admin tool contract", () => {
  let ownerKey: string;
  let userKey: string;
  let userId: string;

  beforeEach(async () => {
    setNow(AFTER_CLOSE);
    setBindings({ OWNER_EMAILS: OWNER_EMAIL });
    await clearAdminState();
    ownerKey = await seedKey(await seedUser(OWNER_EMAIL));
    userId = await seedUser(USER_EMAIL);
    userKey = await seedKey(userId);
    await seedSymbols(
      [MAIN, 1, 2, 3, 4, 5, 6, 7].map((index) => stockSymbol(syntheticIsin(index), syntheticTicker(index))),
    );
    await seedSnapshot();
    await insertSymbol(MAIN);
    await setLatestSession(LATEST_SESSION);
  });

  afterEach(() => {
    restoreBindings();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("owner check", () => {
    const readOnlyDay = { from: "2026-10-01", to: "2026-10-31" };
    const everyAction: [string, Record<string, unknown>][] = [
      ["list_notices", {}],
      ["mark_notice_done", { ids: [1] }],
      ["set_calendar_day", { date: "2026-11-01", kind: "holiday" }],
      ["remove_calendar_day", { date: "2026-11-01" }],
      ["list_calendar", readOnlyDay],
      ["set_inflation", { month: "2026-09", cpiIndex: 120, yoyPct: 10, source: "CAPMAS" }],
      ["set_action_ratio", { actionId: 1, ratio: BONUS_RATIO }],
      ["add_corporate_action", { symbol: MAIN_TICKER, kind: "bonus", exDate: EX_DATE, ratio: BONUS_RATIO }],
      ["apply_queued_actions", {}],
      ["revert_action", { actionId: 1 }],
      ["list_discrepancies", { ...readOnlyDay, limit: 10 }],
      ["usage_summary", {}],
      ["activate_symbol", { isin: syntheticIsin(PENDING_SYMBOL) }],
    ];

    it.each(everyAction)("refuses %s with forbidden for a caller outside OWNER_EMAILS", async (action, args) => {
      await insertSymbol(PENDING_SYMBOL, "pending");
      const actionId = await seedAction({ status: "needs_ratio" });
      await seedMainBars();
      const barsBefore = await readStoredBars();

      const result = await admin({ action, ...args }, userKey);

      expect(result.isError).toBe(true);
      expect(errorCodeOf(result)).toBe("forbidden");
      expect(await countRows("market_calendar")).toBe(0);
      expect(await countRows("inflation_figures")).toBe(0);
      expect(await actionRow(actionId)).toEqual({ status: "needs_ratio", ratio: null });
      expect(await readStoredBars()).toEqual(barsBefore);
      const pending = await env.DB
        .prepare("SELECT status FROM symbols WHERE isin = ?1")
        .bind(syntheticIsin(PENDING_SYMBOL))
        .first<{ status: string }>();
      expect(pending?.status).toBe("pending");
    });

    it("labels the forbidden envelope owner_entered and carries the notice", async () => {
      const result = await admin({ action: "usage_summary" }, userKey);

      expect(errorMetaOf(result).label).toBe("owner_entered");
      expect(noticeOf(result)).toBe(NOTICE);
    });

    it("reads nothing but accounting tables before refusing a non-owner", async () => {
      await seedMainBars();
      await seedAction({ status: "needs_ratio" });
      const statements = recordStatements();

      const result = await admin({ action: "set_action_ratio", actionId: 1, ratio: BONUS_RATIO }, userKey);

      expect(errorCodeOf(result)).toBe("forbidden");
      expect(statements.length).toBeGreaterThan(0);
      const touched = statements.filter(({ sql }) =>
        GUARDED_TABLES.some((table) => new RegExp(`\\b${table}\\b`).test(sql)),
      );
      expect(touched).toEqual([]);
    });

    it("counts a forbidden call against the global calls cap", async () => {
      const before = await readGlobalColumn("calls");

      await admin({ action: "usage_summary" }, userKey);

      expect(await readGlobalColumn("calls")).toBe(before + 1);
    });

    it("advertises admin with readOnlyHint false in tools/list", async () => {
      const tools = await listToolAnnotations(ownerKey);

      expect(tools[ADMIN_TOOL]).toMatchObject({ readOnlyHint: false });
    });
  });

  describe("global caps", () => {
    it("refuses an owner call with capacity once the global calls cap is reached", async () => {
      setBindings({ GLOBAL_DAILY_CALLS: "1" });
      await setGlobal("calls", 1);

      const result = await admin({ action: "usage_summary" }, ownerKey);

      expect(result.isError).toBe(true);
      expect(errorCodeOf(result)).toBe("capacity");
      expect(errorMetaOf(result).label).toBe("owner_entered");
    });

    it("counts a served owner call in usage_global", async () => {
      const before = await readGlobalColumn("calls");

      const result = await admin({ action: "usage_summary" }, ownerKey);

      expect(result.isError).toBeFalsy();
      expect(await readGlobalColumn("calls")).toBe(before + 1);
    });
  });

  describe("notices", () => {
    it("lists open notices by default, newest first, in pages with a cursor", async () => {
      await seedPlainNotices(["open", "open", "open", "done"]);

      const first = await adminData<NoticePage>({ action: "list_notices", limit: NOTICES_PAGE }, ownerKey);
      const second = await adminData<NoticePage>(
        { action: "list_notices", limit: NOTICES_PAGE, cursor: first.nextCursor },
        ownerKey,
      );

      expect(first.items.map((item) => item.subject)).toEqual(["job 2", "job 1"]);
      expect(first.items[0]).toEqual(
        expect.objectContaining({
          id: expect.any(Number),
          kind: "job_failed",
          details: {},
          createdAt: expect.anything(),
          status: "open",
        }),
      );
      expect(first.nextCursor).not.toBeNull();
      expect(second.items.map((item) => item.subject)).toEqual(["job 0"]);
      expect(second.nextCursor).toBeNull();
    });

    it("filters by status", async () => {
      await seedPlainNotices(["open", "done", "done"]);

      const done = await adminData<NoticePage>({ action: "list_notices", status: "done" }, ownerKey);

      expect(done.items.map((item) => item.status)).toEqual(["done", "done"]);
    });

    it("marks notices done and reports how many changed", async () => {
      const ids = await seedPlainNotices(["open", "open", "open"]);

      const data = await adminData<{ updated: number }>({ action: "mark_notice_done", ids: ids.slice(0, 2) }, ownerKey);
      const open = await adminData<NoticePage>({ action: "list_notices" }, ownerKey);

      expect(data.updated).toBe(2);
      expect(open.items.map((item) => item.id)).toEqual([ids[2]]);
    });

    it.each([
      ["no ids", []],
      ["more than 50 ids", Array.from({ length: MAX_NOTICE_IDS + 1 }, (_value, index) => index + 1)],
    ])("rejects mark_notice_done with %s", async (_label, ids) => {
      const result = await admin({ action: "mark_notice_done", ids }, ownerKey);

      expect(errorCodeOf(result)).toBe("invalid_input");
    });
  });

  describe("calendar", () => {
    it("stores a holiday, lists it and removes it", async () => {
      const set = await adminData<{ date: string }>(
        { action: "set_calendar_day", date: "2026-11-01", kind: "holiday", note: "Test holiday" },
        ownerKey,
      );
      const listed = await adminData<{ items: Record<string, unknown>[] }>(
        { action: "list_calendar", from: "2026-10-01", to: "2026-12-31" },
        ownerKey,
      );
      const removed = await adminData<{ removed: unknown }>({ action: "remove_calendar_day", date: "2026-11-01" }, ownerKey);
      const again = await adminData<{ removed: unknown }>({ action: "remove_calendar_day", date: "2026-11-01" }, ownerKey);

      expect(set).toEqual({ date: "2026-11-01" });
      expect(listed.items).toHaveLength(1);
      expect(listed.items[0]).toMatchObject({ date: "2026-11-01", kind: "holiday" });
      expect(removed.removed).toBeTruthy();
      expect(again.removed).toBeFalsy();
      expect(await countRows("market_calendar")).toBe(0);
    });

    it("stores special hours with both times", async () => {
      await adminData(
        { action: "set_calendar_day", date: "2026-11-02", kind: "special_hours", openTime: "10:00", closeTime: "12:30" },
        ownerKey,
      );

      const row = await env.DB
        .prepare("SELECT kind, open_time, close_time FROM market_calendar WHERE date = '2026-11-02'")
        .first<{ kind: string; open_time: string; close_time: string }>();
      expect(row).toEqual({ kind: "special_hours", open_time: "10:00", close_time: "12:30" });
    });

    it.each([
      ["no times", {}],
      ["only an open time", { openTime: "10:00" }],
      ["only a close time", { closeTime: "12:30" }],
    ])("rejects special_hours with %s and writes nothing", async (_label, times) => {
      const result = await admin({ action: "set_calendar_day", date: "2026-11-02", kind: "special_hours", ...times }, ownerKey);

      expect(errorCodeOf(result)).toBe("invalid_input");
      expect(await countRows("market_calendar")).toBe(0);
    });
  });

  describe("inflation", () => {
    it("stores a monthly figure", async () => {
      const data = await adminData<{ month: string }>(
        { action: "set_inflation", month: "2026-09", cpiIndex: 123.4, yoyPct: 11.2, source: "CAPMAS" },
        ownerKey,
      );

      const row = await env.DB
        .prepare("SELECT cpi_index, yoy_pct, source FROM inflation_figures WHERE month = '2026-09'")
        .first<{ cpi_index: number; yoy_pct: number; source: string }>();
      expect(data).toEqual({ month: "2026-09" });
      expect(row).toEqual({ cpi_index: 123.4, yoy_pct: 11.2, source: "CAPMAS" });
    });

    it.each([
      ["a zero index", { cpiIndex: 0 }],
      ["a negative index", { cpiIndex: -1 }],
      ["a month without leading zero", { month: "2026-9" }],
      ["a month above 12", { month: "2026-13" }],
      ["a two digit year", { month: "26-09" }],
      ["a full date", { month: "2026-09-01" }],
    ])("rejects %s", async (_label, overrides) => {
      const args = { action: "set_inflation", month: "2026-09", cpiIndex: 120, yoyPct: 10, source: "CAPMAS", ...overrides };

      const result = await admin(args, ownerKey);

      expect(errorCodeOf(result)).toBe("invalid_input");
      expect(await countRows("inflation_figures")).toBe(0);
    });
  });

  describe("set_action_ratio validation", () => {
    it.each([
      ["a zero ratio", "bonus", 0],
      ["a negative ratio", "bonus", -0.5],
      ["a reverse split with 10", "reverse_split", 10],
      ["a split with 0.5", "split", 0.5],
      ["a bonus with 12", "bonus", 12],
    ] as const)("rejects %s as invalid_input and changes nothing", async (_label, kind, ratio) => {
      await seedMainBars();
      const actionId = await seedAction({ kind, status: "needs_ratio" });
      const barsBefore = await readStoredBars();

      const result = await admin({ action: "set_action_ratio", actionId, ratio }, ownerKey);

      expect(result.isError).toBe(true);
      expect(errorCodeOf(result)).toBe("invalid_input");
      expect(await actionRow(actionId)).toEqual({ status: "needs_ratio", ratio: null });
      expect(await readStoredBars()).toEqual(barsBefore);
      expect(await noticeStatus(MAIN, kind, EX_DATE)).toBe("open");
    });

    it("labels a ratio refusal owner_entered and carries the notice", async () => {
      const actionId = await seedAction({ status: "needs_ratio" });

      const result = await admin({ action: "set_action_ratio", actionId, ratio: 12 }, ownerKey);

      expect(errorMetaOf(result).label).toBe("owner_entered");
      expect(noticeOf(result)).toBe(NOTICE);
    });

    it("rejects an action that is not in needs_ratio with owner_entered meta", async () => {
      const actionId = await seedAction({ status: "recorded", ratio: BONUS_RATIO });

      const result = await admin({ action: "set_action_ratio", actionId, ratio: CORRECTED_RATIO }, ownerKey);

      expect(errorCodeOf(result)).toBe("invalid_input");
      expect(errorMetaOf(result).label).toBe("owner_entered");
      expect(await actionRow(actionId)).toEqual({ status: "recorded", ratio: BONUS_RATIO });
    });

    it("rejects a missing action", async () => {
      const result = await admin({ action: "set_action_ratio", actionId: 9999, ratio: BONUS_RATIO }, ownerKey);

      expect(errorCodeOf(result)).toBe("invalid_input");
      expect(errorMetaOf(result).label).toBe("owner_entered");
    });

    it("rejects a cash dividend that never takes a ratio", async () => {
      const result = await env.DB
        .prepare(
          `INSERT INTO corporate_actions (isin, kind, ex_date, status, source, created_at, updated_at)
           VALUES (?1, 'cash_dividend', ?2, 'needs_ratio', 'mubasher', 0, 0)`,
        )
        .bind(MAIN_ISIN, EX_DATE)
        .run();

      const refused = await admin({ action: "set_action_ratio", actionId: result.meta.last_row_id, ratio: 1 }, ownerKey);

      expect(errorCodeOf(refused)).toBe("invalid_input");
    });
  });

  describe("set_action_ratio apply", () => {
    it("applies at once when the ex date is stored: status applied, bars adjusted, notice done, labels cleared", async () => {
      await seedMainBars();
      const actionId = await seedAction({ status: "needs_ratio" });

      const data = await adminData<Outcome>({ action: "set_action_ratio", actionId, ratio: BONUS_RATIO }, ownerKey);
      const stored = await readStoredBars();
      const labeled = await history(ownerKey);

      expect(data).toEqual({ actionId, status: "applied", rowsAdjusted: PRE_EX_DATES.length, refusedReason: null });
      expect(await actionRow(actionId)).toEqual({ status: "applied", ratio: BONUS_RATIO });
      for (const bar of preExBars(stored)) {
        expect(bar.adj_close).toBeCloseTo(PRICE * BONUS_FACTOR, 9);
        expect(bar.adj_factor).toBeCloseTo(BONUS_FACTOR, 12);
        expect(bar.close).toBe(PRICE);
      }
      expect(await noticeStatus(MAIN, "bonus", EX_DATE)).toBe("done");
      expect(labeled.pendingAdjustments).toEqual([]);
      expect(labeled.bars.every((bar) => bar.adjustmentPending === false)).toBe(true);
    });

    it("returns the stored status read after the attempt", async () => {
      await seedMainBars();
      const actionId = await seedAction({ status: "needs_ratio" });

      const data = await adminData<Outcome>({ action: "set_action_ratio", actionId, ratio: BONUS_RATIO }, ownerKey);

      expect(data.status).toBe((await actionRow(actionId)).status);
    });

    it("INV-2: records a ratio entered before the ex date without touching bars and applies after the session is stored", async () => {
      await seedMainBars();
      const actionId = await seedAction({ exDate: FUTURE_EX_DATE, status: "needs_ratio" });
      const barsBefore = await readStoredBars();
      const rowsBefore = await readGlobalColumn("adjust_rows");

      const data = await adminData<Outcome>({ action: "set_action_ratio", actionId, ratio: BONUS_RATIO }, ownerKey);

      expect(data).toEqual({ actionId, status: "recorded", rowsAdjusted: 0, refusedReason: "ex_date_not_reached" });
      expect(await actionRow(actionId)).toEqual({ status: "recorded", ratio: BONUS_RATIO });
      expect(await readStoredBars()).toEqual(barsBefore);
      expect(await readGlobalColumn("adjust_rows")).toBe(rowsBefore);
      expect(await noticeStatus(MAIN, "bonus", FUTURE_EX_DATE)).toBe("open");

      await setLatestSession(FUTURE_EX_DATE);
      await applyQueuedAsEndOfDay(await readApplyCandidates(env.DB, { limit: 2 }, UTC_DAY));

      expect((await actionRow(actionId)).status).toBe("applied");
      expect(await noticeStatus(MAIN, "bonus", FUTURE_EX_DATE)).toBe("done");
    });

    it("INV-7: at the daily cap it keeps the action recorded, the notice open and labels the bars queued", async () => {
      await seedMainBars();
      const actionId = await seedAction({ status: "needs_ratio" });
      await setGlobal("adjust_rows", ADJUST_CAP);
      const barsBefore = await readStoredBars();

      const data = await adminData<Outcome>({ action: "set_action_ratio", actionId, ratio: BONUS_RATIO }, ownerKey);
      const labeled = await history(ownerKey);

      expect(data).toEqual({ actionId, status: "recorded", rowsAdjusted: 0, refusedReason: "daily_cap" });
      expect(await actionRow(actionId)).toEqual({ status: "recorded", ratio: BONUS_RATIO });
      expect(await noticeStatus(MAIN, "bonus", EX_DATE)).toBe("open");
      expect(await readStoredBars()).toEqual(barsBefore);
      expect(await readGlobalColumn("adjust_rows")).toBe(ADJUST_CAP);
      expect(labeled.pendingAdjustments[0]).toMatchObject({ state: "queued" });
      for (const date of PRE_EX_DATES) {
        expect(labeled.bars.find((bar) => bar.date === date)?.adjustmentPending).toBe(true);
      }
    });

    it("INV-5: refuses with backfill_loading while the symbol backfill is loading", async () => {
      await seedMainBars();
      await setSymbolState(MAIN, LATEST_SESSION, "loading");
      const actionId = await seedAction({ status: "needs_ratio" });
      const barsBefore = await readStoredBars();

      const data = await adminData<Outcome>({ action: "set_action_ratio", actionId, ratio: BONUS_RATIO }, ownerKey);

      expect(data).toEqual({ actionId, status: "recorded", rowsAdjusted: 0, refusedReason: "backfill_loading" });
      expect(await readStoredBars()).toEqual(barsBefore);
      expect(await noticeStatus(MAIN, "bonus", EX_DATE)).toBe("open");
    });

    it("basis rule: on a backfilled symbol the apply keeps adj of derived bars and divides their raw", async () => {
      await seedMainBars();
      await setSymbolState(MAIN, LATEST_SESSION, "done");
      await env.DB
        .prepare(
          `UPDATE daily_bars SET adj_open = open * ?2, adj_high = high * ?2, adj_low = low * ?2, adj_close = close * ?2,
             raw_derived = 1 WHERE isin = ?1 AND session_date < ?3`,
        )
        .bind(MAIN_ISIN, BONUS_FACTOR, EX_DATE)
        .run();
      const actionId = await seedAction({ status: "needs_ratio" });
      const before = preExBars(await readStoredBars());

      const data = await adminData<Outcome>({ action: "set_action_ratio", actionId, ratio: BONUS_RATIO }, ownerKey);
      const after = preExBars(await readStoredBars());

      expect(data.status).toBe("applied");
      for (const [index, bar] of after.entries()) {
        expect(bar.adj_close).toBe(before[index]!.adj_close);
        expect(bar.adj_open).toBe(before[index]!.adj_open);
        expect(bar.close).toBeCloseTo(PRICE / BONUS_FACTOR, 9);
        expect(bar.adj_factor).toBeCloseTo(BONUS_FACTOR, 12);
      }
    });

    it("INV-1: a second ratio for an applied action is invalid_input and changes nothing", async () => {
      await seedMainBars();
      const actionId = await seedAction({ status: "needs_ratio" });
      await adminData({ action: "set_action_ratio", actionId, ratio: BONUS_RATIO }, ownerKey);
      const barsAfterFirst = await readStoredBars();
      const rowsAfterFirst = await readGlobalColumn("adjust_rows");

      const second = await admin({ action: "set_action_ratio", actionId, ratio: BONUS_RATIO }, ownerKey);

      expect(second.isError).toBe(true);
      expect(errorCodeOf(second)).toBe("invalid_input");
      expect(await readStoredBars()).toEqual(barsAfterFirst);
      expect(await readGlobalColumn("adjust_rows")).toBe(rowsAfterFirst);
      expect(await actionRow(actionId)).toEqual({ status: "applied", ratio: BONUS_RATIO });
    });
  });

  describe("revert_action", () => {
    async function appliedBonus(): Promise<{ actionId: number; barsBefore: StoredBar[] }> {
      await seedMainBars();
      const actionId = await seedAction({ status: "needs_ratio" });
      const barsBefore = await readStoredBars();
      await adminData({ action: "set_action_ratio", actionId, ratio: BONUS_RATIO }, ownerKey);
      return { actionId, barsBefore };
    }

    it("C20: restores the bars, sets needs_ratio with a null ratio, reopens the notice and labels the bars again", async () => {
      const { actionId, barsBefore } = await appliedBonus();
      const rowsAfterApply = await readGlobalColumn("adjust_rows");

      const data = await adminData<Outcome>({ action: "revert_action", actionId }, ownerKey);
      const labeled = await history(ownerKey);

      expect(data).toEqual({ actionId, status: "needs_ratio", rowsAdjusted: PRE_EX_DATES.length, refusedReason: null });
      expect(await actionRow(actionId)).toEqual({ status: "needs_ratio", ratio: null });
      expectBarsClose(await readStoredBars(), barsBefore);
      expect(await noticeStatus(MAIN, "bonus", EX_DATE)).toBe("open");
      expect(await readGlobalColumn("adjust_rows")).toBe(rowsAfterApply + PRE_EX_DATES.length + ADJUST_BATCH_OVERHEAD_ROWS);
      expect(labeled.pendingAdjustments).toHaveLength(1);
      for (const date of PRE_EX_DATES) {
        expect(labeled.bars.find((bar) => bar.date === date)?.adjustmentPending).toBe(true);
      }
    });

    it("applies the corrected ratio exactly once after a revert", async () => {
      const { actionId } = await appliedBonus();
      await adminData({ action: "revert_action", actionId }, ownerKey);

      const data = await adminData<Outcome>(
        { action: "set_action_ratio", actionId, ratio: CORRECTED_RATIO },
        ownerKey,
      );

      expect(data.status).toBe("applied");
      for (const bar of preExBars(await readStoredBars())) {
        expect(bar.adj_close).toBeCloseTo(PRICE / (1 + CORRECTED_RATIO), 9);
        expect(bar.adj_factor).toBeCloseTo(1 / (1 + CORRECTED_RATIO), 12);
      }
      expect(await noticeStatus(MAIN, "bonus", EX_DATE)).toBe("done");
    });

    it("reverts the raw of derived bars too", async () => {
      await seedMainBars();
      await setSymbolState(MAIN, LATEST_SESSION, "done");
      await env.DB
        .prepare(
          `UPDATE daily_bars SET adj_open = open * ?2, adj_high = high * ?2, adj_low = low * ?2, adj_close = close * ?2,
             raw_derived = 1 WHERE isin = ?1 AND session_date < ?3`,
        )
        .bind(MAIN_ISIN, BONUS_FACTOR, EX_DATE)
        .run();
      const actionId = await seedAction({ status: "needs_ratio" });
      const barsBefore = await readStoredBars();
      await adminData({ action: "set_action_ratio", actionId, ratio: BONUS_RATIO }, ownerKey);

      await adminData({ action: "revert_action", actionId }, ownerKey);

      expectBarsClose(await readStoredBars(), barsBefore);
    });

    it("rejects a recorded action as invalid_input", async () => {
      await seedMainBars();
      const actionId = await seedAction({ status: "recorded", ratio: BONUS_RATIO, exDate: FUTURE_EX_DATE });

      const result = await admin({ action: "revert_action", actionId }, ownerKey);

      expect(errorCodeOf(result)).toBe("invalid_input");
      expect(await actionRow(actionId)).toEqual({ status: "recorded", ratio: BONUS_RATIO });
    });

    it("rejects a needs_ratio action and a missing action as invalid_input", async () => {
      const actionId = await seedAction({ status: "needs_ratio" });

      expect(errorCodeOf(await admin({ action: "revert_action", actionId }, ownerKey))).toBe("invalid_input");
      expect(errorCodeOf(await admin({ action: "revert_action", actionId: 9999 }, ownerKey))).toBe("invalid_input");
    });

    it("refuses with daily_cap at the cap and changes nothing", async () => {
      const { actionId } = await appliedBonus();
      await setGlobal("adjust_rows", ADJUST_CAP);
      const barsApplied = await readStoredBars();

      const data = await adminData<Outcome>({ action: "revert_action", actionId }, ownerKey);

      expect(data).toEqual({ actionId, status: "applied", rowsAdjusted: 0, refusedReason: "daily_cap" });
      expect(await actionRow(actionId)).toEqual({ status: "applied", ratio: BONUS_RATIO });
      expect(await readStoredBars()).toEqual(barsApplied);
      expect(await readGlobalColumn("adjust_rows")).toBe(ADJUST_CAP);
      expect(await noticeStatus(MAIN, "bonus", EX_DATE)).toBe("done");
    });
  });

  describe("D14 concurrency", () => {
    const FIRST_BIG = 6;
    const SECOND_BIG = 7;

    it("applies exactly one of two queued actions when the end-of-day path and apply_queued_actions race", async () => {
      await insertSymbol(FIRST_BIG);
      await insertSymbol(SECOND_BIG);
      await seedBigHistory(FIRST_BIG);
      await seedBigHistory(SECOND_BIG);
      const firstId = await seedAction({ index: FIRST_BIG, exDate: "2026-10-10", ratio: BONUS_RATIO, status: "recorded" });
      const secondId = await seedAction({ index: SECOND_BIG, exDate: "2026-10-11", ratio: BONUS_RATIO, status: "recorded" });
      const startRows = ADJUST_CAP - CAP_HEADROOM;
      await setGlobal("adjust_rows", startRows);
      const candidates = await readApplyCandidates(env.DB, { limit: 2 }, UTC_DAY);
      const batchTotals = recordBatchRows();

      const [, tool] = await Promise.all([
        applyQueuedAsEndOfDay(candidates),
        admin({ action: "apply_queued_actions", limit: 3 }, ownerKey),
      ]);
      const written = await Promise.all(batchTotals);
      const data = payloadOf<{ applied: { actionId: number; rowsAdjusted: number }[]; remaining: number }>(tool).data;
      const statuses = new Map([
        [firstId, (await actionRow(firstId)).status],
        [secondId, (await actionRow(secondId)).status],
      ]);
      const appliedIds = [...statuses].filter(([, status]) => status === "applied").map(([id]) => id);
      const recordedId = [firstId, secondId].find((id) => statuses.get(id) === "recorded");
      const recordedIndex = recordedId === firstId ? FIRST_BIG : SECOND_BIG;
      const adjustRows = await readGlobalColumn("adjust_rows");

      expect(appliedIds).toHaveLength(1);
      expect(recordedId).toBeDefined();
      expect(adjustRows).toBeLessThanOrEqual(ADJUST_CAP);
      expect(adjustRows - startRows).toBe(BIG_HISTORY_BARS + ADJUST_BATCH_OVERHEAD_ROWS);
      expect(adjustRows - startRows).toBeGreaterThanOrEqual(Math.max(...written));
      expect((await readStoredBars(recordedIndex)).every((bar) => bar.adj_close === 10 && bar.adj_factor === 1)).toBe(true);
      expect(data.applied.map((entry) => entry.actionId)).not.toContain(recordedId);
    });
  });

  describe("apply_queued_actions", () => {
    async function seedQueue(): Promise<number[]> {
      const ids: number[] = [];
      for (let offset = 0; offset < QUEUED_ACTIONS; offset += 1) {
        const index = FIRST_QUEUED_SYMBOL + offset;
        await insertSymbol(index);
        await seedBars(syntheticIsin(index), [
          { sessionDate: "2026-10-01", open: PRICE, high: PRICE, low: PRICE, close: PRICE },
        ]);
        ids.push(
          await seedAction({ index, exDate: addDays("2026-10-10", offset), ratio: BONUS_RATIO, status: "recorded" }),
        );
      }
      return ids;
    }

    it("applies the 3 oldest with limit 3 and reports remaining 2", async () => {
      const ids = await seedQueue();

      const data = await adminData<{ applied: { actionId: number; rowsAdjusted: number }[]; remaining: number }>(
        { action: "apply_queued_actions", limit: 3 },
        ownerKey,
      );

      expect(data.applied).toEqual(ids.slice(0, 3).map((actionId) => ({ actionId, rowsAdjusted: 1 })));
      expect(data.remaining).toBe(2);
      expect((await Promise.all(ids.map((id) => actionRow(id)))).map((row) => row.status)).toEqual([
        "applied",
        "applied",
        "applied",
        "recorded",
        "recorded",
      ]);
    });

    it("defaults to 3 applies", async () => {
      await seedQueue();

      const data = await adminData<{ applied: unknown[]; remaining: number }>({ action: "apply_queued_actions" }, ownerKey);

      expect(data.applied).toHaveLength(3);
      expect(data.remaining).toBe(2);
    });

    it("applies fewer when limit is smaller", async () => {
      await seedQueue();

      const data = await adminData<{ applied: unknown[]; remaining: number }>(
        { action: "apply_queued_actions", limit: 1 },
        ownerKey,
      );

      expect(data.applied).toHaveLength(1);
      expect(data.remaining).toBe(QUEUED_ACTIONS - 1);
    });

    it.each([0, 4])("rejects limit %i as invalid_input", async (limit) => {
      await seedQueue();

      const result = await admin({ action: "apply_queued_actions", limit }, ownerKey);

      expect(errorCodeOf(result)).toBe("invalid_input");
      expect(await countRows("daily_bars")).toBe(QUEUED_ACTIONS);
    });

    it("stops at the first daily_cap refusal and leaves the rest queued", async () => {
      const ids = await seedQueue();
      await setGlobal("adjust_rows", ADJUST_CAP);

      const data = await adminData<{ applied: unknown[]; remaining: number }>(
        { action: "apply_queued_actions", limit: 3 },
        ownerKey,
      );

      expect(data.applied).toEqual([]);
      expect(data.remaining).toBe(QUEUED_ACTIONS);
      expect((await actionRow(ids[0]!)).status).toBe("recorded");
    });
  });

  describe("owner_entered refusals", () => {
    it("labels a schema invalid_input refusal owner_entered", async () => {
      const result = await admin({ action: "not_an_action" }, ownerKey);

      expect(errorCodeOf(result)).toBe("invalid_input");
      expect(errorMetaOf(result).label).toBe("owner_entered");
    });

    it("labels an unresolved symbol in add_corporate_action owner_entered", async () => {
      const result = await admin(
        { action: "add_corporate_action", symbol: "NOSUCHSYMBOL", kind: "bonus", exDate: EX_DATE, ratio: BONUS_RATIO },
        ownerKey,
      );

      expect(errorCodeOf(result)).toBe("not_found");
      expect(errorMetaOf(result).label).toBe("owner_entered");
    });

    it("labels an internal handler failure owner_entered", async () => {
      const original = env.DB.prepare.bind(env.DB);
      vi.spyOn(env.DB, "prepare").mockImplementation((sql: string) => {
        if (sql.includes("FROM notices")) throw new Error("d1 unavailable");
        return original(sql);
      });
      vi.spyOn(console, "error").mockImplementation(() => undefined);

      const result = await admin({ action: "list_notices" }, ownerKey);

      expect(errorCodeOf(result)).toBe("not_available");
      expect(errorMetaOf(result).label).toBe("owner_entered");
    });

    describe("rows read by the list and summary actions", () => {
      const SEEDED_ROWS = 20;

      async function seedDiscrepancies(): Promise<void> {
        await env.DB.batch(
          Array.from({ length: SEEDED_ROWS }, (_value, index) =>
            env.DB
              .prepare(
                `INSERT INTO source_discrepancies (isin, session_date, diff_pct, created_at) VALUES (?1, '2026-10-15', 1, 0)`,
              )
              .bind(syntheticIsin(index)),
          ),
        );
      }

      async function seedUsageRows(): Promise<void> {
        await env.DB.batch(
          Array.from({ length: SEEDED_ROWS }, (_value, index) =>
            env.DB
              .prepare("INSERT INTO usage_daily (day, user_id, tool, calls) VALUES (?1, ?2, 'search', 1)")
              .bind(UTC_DAY, `seeded-user-${index}`),
          ),
        );
      }

      async function seedNoticeRows(): Promise<void> {
        await seedPlainNotices(Array.from({ length: SEEDED_ROWS }, () => "open" as const));
      }

      async function rowsReadBy(args: Record<string, unknown>): Promise<number> {
        const before = await readGlobalColumn("rows_read");
        const result = await admin(args, ownerKey);
        expect(result.isError).toBeFalsy();
        return (await readGlobalColumn("rows_read")) - before;
      }

      it.each([
        ["list_notices", { action: "list_notices", limit: 50 }, seedNoticeRows],
        ["list_discrepancies", { action: "list_discrepancies", from: "2026-10-01", to: "2026-10-31" }, seedDiscrepancies],
        ["usage_summary", { action: "usage_summary" }, seedUsageRows],
      ])("adds the rows the %s handler read to the global counter", async (_name, args, seed) => {
        const baseline = await rowsReadBy(args);

        await seed();
        const seeded = await rowsReadBy(args);

        expect(seeded - baseline).toBeGreaterThanOrEqual(SEEDED_ROWS);
      });
    });
  });

  describe("add_corporate_action", () => {
    it("applies a past bonus at once and returns rowsAdjusted", async () => {
      await seedMainBars();

      const data = await adminData<Outcome>(
        { action: "add_corporate_action", symbol: MAIN_TICKER, kind: "bonus", exDate: EX_DATE, ratio: 0.1 },
        ownerKey,
      );

      expect(data).toEqual({
        actionId: expect.any(Number),
        status: "applied",
        rowsAdjusted: PRE_EX_DATES.length,
        refusedReason: null,
      });
      expect(await actionRow(data.actionId)).toEqual({ status: "applied", ratio: 0.1 });
      for (const bar of preExBars(await readStoredBars())) expect(bar.adj_close).toBeCloseTo(PRICE / 1.1, 9);
    });

    it("records a bonus whose ex date is not stored yet with ex_date_not_reached", async () => {
      await seedMainBars();

      const data = await adminData<Outcome>(
        { action: "add_corporate_action", symbol: MAIN_TICKER, kind: "bonus", exDate: FUTURE_EX_DATE, ratio: 0.1 },
        ownerKey,
      );

      expect(data).toMatchObject({ status: "recorded", rowsAdjusted: 0, refusedReason: "ex_date_not_reached" });
    });

    it("records a cash dividend without an apply attempt", async () => {
      await seedMainBars();

      const data = await adminData<Outcome>(
        { action: "add_corporate_action", symbol: MAIN_TICKER, kind: "cash_dividend", exDate: EX_DATE, amount: 1.5, currency: "EGP" },
        ownerKey,
      );

      expect(data).toMatchObject({ status: "recorded", rowsAdjusted: 0, refusedReason: null });
      expect(await readGlobalColumn("adjust_rows")).toBe(0);
    });

    it.each([
      ["a bonus without a ratio", { kind: "bonus" }],
      ["a split with ratio 0.5", { kind: "split", ratio: 0.5 }],
      ["a bonus with ratio 12", { kind: "bonus", ratio: 12 }],
      ["a reverse split with ratio 10", { kind: "reverse_split", ratio: 10 }],
    ])("rejects %s as invalid_input and stores nothing", async (_label, fields) => {
      await seedMainBars();

      const result = await admin(
        { action: "add_corporate_action", symbol: MAIN_TICKER, exDate: EX_DATE, ...fields },
        ownerKey,
      );

      expect(errorCodeOf(result)).toBe("invalid_input");
      expect(await countRows("corporate_actions")).toBe(0);
    });
  });

  describe("personal-write cap", () => {
    beforeEach(() => {
      setBindings({ PERSONAL_DAILY_ROWS: String(PERSONAL_CAP) });
    });

    it("adds the rows of a served calendar write to personal_rows", async () => {
      const before = await readGlobalColumn("personal_rows");

      const result = await admin({ action: "set_calendar_day", date: "2026-11-01", kind: "holiday" }, ownerKey);

      expect(result.isError).toBeFalsy();
      expect(await readGlobalColumn("personal_rows")).toBeGreaterThan(before);
    });

    it("refuses set_calendar_day with capacity at the cap and writes nothing, while set_action_ratio still applies", async () => {
      await setGlobal("personal_rows", PERSONAL_CAP);
      await seedMainBars();
      const actionId = await seedAction({ status: "needs_ratio" });

      const refused = await admin({ action: "set_calendar_day", date: "2026-11-01", kind: "holiday" }, ownerKey);
      const applied = await adminData<Outcome>({ action: "set_action_ratio", actionId, ratio: BONUS_RATIO }, ownerKey);

      expect(refused.isError).toBe(true);
      expect(errorCodeOf(refused)).toBe("capacity");
      expect(errorMetaOf(refused).label).toBe("owner_entered");
      expect(await countRows("market_calendar")).toBe(0);
      expect(applied.status).toBe("applied");
      expect(await readGlobalColumn("adjust_rows")).toBe(PRE_EX_DATES.length + ADJUST_BATCH_OVERHEAD_ROWS);
      expect(await readGlobalColumn("personal_rows")).toBe(PERSONAL_CAP);
    });

    it("still serves reads at the cap", async () => {
      await setGlobal("personal_rows", PERSONAL_CAP);

      const result = await admin({ action: "list_calendar", from: "2026-10-01", to: "2026-12-31" }, ownerKey);

      expect(result.isError).toBeFalsy();
    });
  });

  describe("reads", () => {
    it("lists discrepancies in the range", async () => {
      await env.DB
        .prepare(
          `INSERT INTO source_discrepancies (isin, session_date, primary_source, backup_source, primary_close, backup_close, diff_pct, created_at)
           VALUES (?1, '2026-10-20', 'mubasher', 'tradingview', 100, 103, 3, 0), (?1, '2026-09-01', 'mubasher', 'tradingview', 100, 110, 10, 0)`,
        )
        .bind(MAIN_ISIN)
        .run();

      const data = await adminData<{ items: Record<string, unknown>[] }>(
        { action: "list_discrepancies", from: "2026-10-01", to: "2026-10-31", limit: 10 },
        ownerKey,
      );

      expect(data.items).toHaveLength(1);
      expect(data.items[0]).toMatchObject({ isin: MAIN_ISIN, sessionDate: "2026-10-20", diffPct: 3 });
    });

    it("summarizes usage with personalRows, caps and the top users", async () => {
      await setGlobal("personal_rows", 7);
      await setGlobal("adjust_rows", 9);
      await env.DB
        .prepare("INSERT INTO usage_daily (day, user_id, tool, calls) VALUES (?1, ?2, 'search', 5)")
        .bind(UTC_DAY, userId)
        .run();

      const data = await adminData<{
        global: Record<string, number>;
        caps: Record<string, number>;
        topUsers: { userId: string; calls: number }[];
      }>({ action: "usage_summary" }, ownerKey);

      expect(data.global).toMatchObject({ personalRows: 7, adjustRows: 9 });
      expect(data.global).toHaveProperty("calls");
      expect(data.global).toHaveProperty("rowsRead");
      expect(data.global).toHaveProperty("oauthKvWrites");
      expect(data.global).toHaveProperty("backfillRows");
      expect(Object.values(data.caps)).toEqual(expect.arrayContaining([ADJUST_CAP, 5000]));
      expect(data.topUsers[0]).toMatchObject({ userId, calls: 5 });
    });

    it("labels served data owner_entered", async () => {
      const result = await admin({ action: "usage_summary" }, ownerKey);

      expect(payloadOf<unknown>(result).meta.label).toBe("owner_entered");
    });
  });

  describe("activate_symbol", () => {
    it("moves a pending symbol to active", async () => {
      await insertSymbol(PENDING_SYMBOL, "pending");

      const data = await adminData<{ isin: string; status: string }>(
        { action: "activate_symbol", isin: syntheticIsin(PENDING_SYMBOL) },
        ownerKey,
      );
      const row = await env.DB
        .prepare("SELECT status FROM symbols WHERE isin = ?1")
        .bind(syntheticIsin(PENDING_SYMBOL))
        .first<{ status: string }>();

      expect(data).toEqual({ isin: syntheticIsin(PENDING_SYMBOL), status: "active" });
      expect(row?.status).toBe("active");
    });
  });
});
