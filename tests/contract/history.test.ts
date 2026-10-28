import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApplyCandidate } from "../../src/domain/adjust";
import { ADJUST_BATCH_OVERHEAD_ROWS } from "../../src/domain/budget";
import { applyAdjustment, compareRange, earliestDate, getHistoryPage, pendingForIsins, readApplyCandidates } from "../../src/store/d1/bars";
import { decodeBase64Url } from "../helpers/base64url";
import { clearState, restoreBindings } from "../helpers/bindings";
import { bindMember } from "../helpers/jobs";
import { callTool, errorCodeOf, payloadOf as structuredPayloadOf, type ToolResult } from "../helpers/mcp";
import { seedKey, seedSnapshot, seedSymbols, seedUser, setNow, stockSymbol, syntheticIsin, syntheticTicker } from "../helpers/seed";
import { cairoSummerEpoch } from "../helpers/time";

const AFTER_CLOSE = cairoSummerEpoch("2026-10-25", "15:00");
const USER_EMAIL = "user@example.com";
const UTC_DAY = "2026-10-25";
const LATEST_SESSION = "2026-10-23";
const HISTORY_TOOL = "get_price_history";
const COMPARE_TOOL = "compare_symbols";
const SYMBOL_COUNT = 6;
const PAGE_SIZE = 500;
const OVER_PAGE_SIZE = 502;
const MS_PER_DAY = 86_400_000;
const MAX_ROWS_PER_DAY = 10_000;
const CAPPED_ROWS_PER_DAY = 5;
const BONUS_RATIO = 0.25;
const BONUS_FACTOR = 0.8;
const SPLIT_RATIO = 2;
const SPLIT_FACTOR = 0.5;
const PRICE = 100;
const POST_EX_PRICE = 80;
const EX_DATE = "2026-06-01";
const NEEDS_RATIO_REASON = "not yet adjusted: awaiting the owner's ratio";
const QUEUED_REASON = "not yet adjusted: adjustment queued";
const CAP_CAUSE = "daily adjustment limit reached";
const BACKFILL_CAUSE = "until the backfill of this symbol finishes";
const EX_DATE_CAUSE = "until the ex-date session is stored";
const ADJUSTED_FIELD = "adjusted";
const FIRST = syntheticIsin(0);
const FIRST_TICKER = syntheticTicker(0);
const ALL_ISINS = Array.from({ length: SYMBOL_COUNT }, (_, index) => syntheticIsin(index));

type PendingItem = {
  actionId: number;
  kind: string;
  exDate: string;
  announcedOn: string | null;
  source: string;
  state: string;
  reason: string;
};
type HistoryBar = Record<string, unknown> & { date: string };
type HistoryData = {
  isin: string;
  earliestAvailable: string | null;
  pendingAdjustments: PendingItem[];
  bars: HistoryBar[];
  nextCursor: string | null;
};
type CompareItem = {
  isin: string;
  ticker: string;
  returnPct: number;
  high: number;
  low: number;
  totalVolume: number;
  firstDate: string;
  lastDate: string;
  adjustmentPending: boolean;
  pendingAdjustments: PendingItem[];
};
type CompareData = { items: CompareItem[]; commonFrom: string; commonTo: string };
type Meta = { label: string; notAvailable: { field: string; reason: string }[] };
type Payload<T> = { data: T; meta: Meta };

type BarSeed = {
  date: string;
  close: number;
  open?: number;
  high?: number;
  low?: number;
  adjClose?: number;
  adjFactor?: number;
  rawDerived?: boolean;
  volume?: number;
  source?: string;
};
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
};
type ActionSeed = {
  isin?: string;
  kind?: "bonus" | "split" | "reverse_split";
  exDate?: string;
  ratio?: number | null;
  status?: "needs_ratio" | "recorded" | "applied";
};
type RecordedStatement = { sql: string; params: unknown[] };
type BatchOutcome = { meta: { rows_written: number } }[];

function payloadOf<T>(result: ToolResult): Payload<T> {
  return structuredPayloadOf<Payload<T>>(result);
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

function factorOf(kind: string, ratio: number): number {
  return kind === "bonus" ? 1 / (1 + ratio) : 1 / ratio;
}

async function history(args: Record<string, unknown>, key: string): Promise<Payload<HistoryData>> {
  return payloadOf<HistoryData>(await callTool(HISTORY_TOOL, { symbol: FIRST_TICKER, from: "2026-05-01", to: LATEST_SESSION, ...args }, key));
}

async function compare(args: Record<string, unknown>, key: string): Promise<ToolResult> {
  return callTool(COMPARE_TOOL, { from: "2026-05-01", to: LATEST_SESSION, ...args }, key);
}

async function insertSymbols(): Promise<void> {
  const insert = env.DB.prepare(
    "INSERT INTO symbols (isin, ticker, status, created_at, updated_at) VALUES (?1, ?2, 'active', 0, 0)",
  );
  await env.DB.batch(ALL_ISINS.map((isin, index) => insert.bind(isin, syntheticTicker(index))));
}

async function clearHistoryState(): Promise<void> {
  await clearState();
  await env.DB.batch(
    ["corporate_actions", "symbols", "notices", "job_state"].map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
  );
}

async function setLatestSession(date: string): Promise<void> {
  await env.DB
    .prepare(
      "INSERT INTO job_state (job, last_run_date) VALUES ('eod_bars', ?1) ON CONFLICT (job) DO UPDATE SET last_run_date = excluded.last_run_date",
    )
    .bind(date)
    .run();
}

async function setSymbolState(isin: string, basisDate: string | null, backfillState: string | null): Promise<void> {
  await env.DB
    .prepare("UPDATE symbols SET adj_basis_date = ?2, backfill_state = ?3 WHERE isin = ?1")
    .bind(isin, basisDate, backfillState)
    .run();
}

async function seedBarRows(isin: string, rows: BarSeed[]): Promise<void> {
  const values = rows.map((row) => {
    const open = row.open ?? row.close;
    const high = row.high ?? row.close;
    const low = row.low ?? row.close;
    const scale = (row.adjClose ?? row.close) / row.close;
    return {
      d: row.date,
      o: open,
      h: high,
      l: low,
      c: row.close,
      v: row.volume ?? 0,
      ao: open * scale,
      ah: high * scale,
      al: low * scale,
      ac: row.close * scale,
      af: row.adjFactor ?? 1,
      rd: row.rawDerived ? 1 : 0,
      s: row.source ?? "test",
    };
  });
  await env.DB
    .prepare(
      `INSERT INTO daily_bars
         (isin, session_date, open, high, low, close, volume, adj_open, adj_high, adj_low, adj_close, adj_factor, raw_derived, source)
       SELECT ?1, json_extract(value, '$.d'), json_extract(value, '$.o'), json_extract(value, '$.h'), json_extract(value, '$.l'),
              json_extract(value, '$.c'), json_extract(value, '$.v'), json_extract(value, '$.ao'), json_extract(value, '$.ah'),
              json_extract(value, '$.al'), json_extract(value, '$.ac'), json_extract(value, '$.af'), json_extract(value, '$.rd'),
              json_extract(value, '$.s')
       FROM json_each(?2)`,
    )
    .bind(isin, JSON.stringify(values))
    .run();
}

async function readStoredBars(isin: string): Promise<Record<string, StoredBar>> {
  const { results } = await env.DB
    .prepare(
      `SELECT session_date, open, high, low, close, adj_open, adj_high, adj_low, adj_close, adj_factor
       FROM daily_bars WHERE isin = ?1 ORDER BY session_date`,
    )
    .bind(isin)
    .all<StoredBar>();
  return Object.fromEntries(results.map((row) => [row.session_date, row]));
}

async function seedAction(action: ActionSeed = {}): Promise<number> {
  const { isin = FIRST, kind = "bonus", exDate = EX_DATE, ratio = null, status = "needs_ratio" } = action;
  const result = await env.DB
    .prepare(
      `INSERT INTO corporate_actions (isin, kind, announced_on, ex_date, ratio, status, source, created_at, updated_at)
       VALUES (?1, ?2, '2026-05-10', ?3, ?4, ?5, 'mubasher', 0, 0)`,
    )
    .bind(isin, kind, exDate, ratio, status)
    .run();
  return result.meta.last_row_id;
}

async function seedNotice(ticker: string, kind: string, exDate: string): Promise<void> {
  const subject = `${ticker} ${kind} ${exDate}`;
  await env.DB
    .prepare(
      `INSERT INTO notices (kind, subject, details, created_at, status, dedupe_key)
       VALUES ('needs_ratio', ?1, '{}', 0, 'open', ?2)`,
    )
    .bind(subject, `needs_ratio:${subject}`)
    .run();
}

async function noticeStatus(ticker: string, kind: string, exDate: string): Promise<string | null> {
  const row = await env.DB
    .prepare("SELECT status FROM notices WHERE kind = 'needs_ratio' AND subject = ?1")
    .bind(`${ticker} ${kind} ${exDate}`)
    .first<{ status: string }>();
  return row?.status ?? null;
}

async function actionStatus(actionId: number): Promise<{ status: string; ratio: number | null }> {
  const row = await env.DB
    .prepare("SELECT status, ratio FROM corporate_actions WHERE id = ?1")
    .bind(actionId)
    .first<{ status: string; ratio: number | null }>();
  if (!row) throw new Error(`action ${actionId} missing`);
  return row;
}

async function adjustRowsToday(): Promise<number | null> {
  const row = await env.DB
    .prepare("SELECT adjust_rows FROM usage_global WHERE day = ?1")
    .bind(UTC_DAY)
    .first<{ adjust_rows: number }>();
  return row?.adjust_rows ?? null;
}

async function usageRowsRead(): Promise<number> {
  const row = await env.DB
    .prepare("SELECT rows_read FROM usage_global WHERE day = ?1")
    .bind(UTC_DAY)
    .first<{ rows_read: number }>();
  return row?.rows_read ?? 0;
}

async function candidateOf(actionId: number): Promise<ApplyCandidate> {
  const [candidate] = await readApplyCandidates(env.DB, { actionId }, UTC_DAY);
  if (!candidate) throw new Error(`candidate ${actionId} missing`);
  return candidate;
}

function applyCandidate(candidate: ApplyCandidate, maxRowsPerDay = MAX_ROWS_PER_DAY) {
  return applyAdjustment(env.DB, candidate, maxRowsPerDay, UTC_DAY, AFTER_CLOSE);
}

async function applyAction(actionId: number, maxRowsPerDay = MAX_ROWS_PER_DAY) {
  return applyCandidate(await candidateOf(actionId), maxRowsPerDay);
}

function recordStatements(): RecordedStatement[] {
  const recorded: RecordedStatement[] = [];
  const original = env.DB.prepare.bind(env.DB);
  vi.spyOn(env.DB, "prepare").mockImplementation((sql: string) => {
    const statement = original(sql);
    const entry: RecordedStatement = { sql, params: [] };
    recorded.push(entry);
    return new Proxy(statement, {
      get(target, property) {
        if (property !== "bind") return bindMember(target, property);
        return (...values: unknown[]) => {
          entry.params = values;
          return target.bind(...values);
        };
      },
    });
  });
  return recorded;
}

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

function barOf(data: HistoryData, date: string): HistoryBar {
  const found = data.bars.find((entry) => entry.date === date);
  if (!found) throw new Error(`bar ${date} missing`);
  return found;
}

describe("history contract", () => {
  let key: string;

  beforeEach(async () => {
    setNow(AFTER_CLOSE);
    await clearHistoryState();
    key = await seedKey(await seedUser(USER_EMAIL));
    await seedSymbols(ALL_ISINS.map((isin, index) => stockSymbol(isin, syntheticTicker(index))));
    await seedSnapshot();
    await insertSymbols();
    await setLatestSession(LATEST_SESSION);
  });

  afterEach(() => {
    restoreBindings();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("get_price_history", () => {
    it("returns bars ordered by date with raw and adjusted fields and the end_of_day label", async () => {
      await seedBarRows(FIRST, [
        { date: "2026-09-03", close: 12, open: 11, high: 13, low: 10, adjClose: 6, volume: 300, source: "tradingview" },
        { date: "2026-09-01", close: 10, volume: 100, source: "mubasher" },
        { date: "2026-09-02", close: 11, volume: 200, source: "tradingview" },
      ]);

      const { data, meta } = await history({ from: "2026-09-01" }, key);

      expect(data.isin).toBe(FIRST);
      expect(data.bars.map((entry) => entry.date)).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
      expect(data.bars[2]).toMatchObject({
        open: 11,
        high: 13,
        low: 10,
        close: 12,
        volume: 300,
        adjOpen: 5.5,
        adjHigh: 6.5,
        adjLow: 5,
        adjClose: 6,
        source: "tradingview",
      });
      expect(data.bars[0]).toMatchObject({ source: "mubasher" });
      expect(meta.label).toBe("end_of_day");
    });

    it("records the summed D1 rows read in the usage counter", async () => {
      await seedBarRows(FIRST, [
        { date: "2026-09-01", close: 10 },
        { date: "2026-09-02", close: 11 },
        { date: "2026-09-03", close: 12 },
      ]);
      const range = { from: "2026-09-01", to: LATEST_SESSION };
      const [page, earliest, pending] = await Promise.all([
        getHistoryPage(env.DB, FIRST, range.from, range.to, null, PAGE_SIZE + 1),
        earliestDate(env.DB, FIRST),
        pendingForIsins(env.DB, [FIRST], UTC_DAY, range.from),
      ]);
      const storeRowsRead = page.rowsRead + earliest.rowsRead + pending.rowsRead;

      await history({ from: range.from }, key);

      expect(storeRowsRead).toBeGreaterThan(0);
      expect(await usageRowsRead()).toBeGreaterThanOrEqual(storeRowsRead);
    });

    it("omits the adjusted fields for series raw", async () => {
      await seedBarRows(FIRST, [{ date: "2026-09-01", close: 10, adjClose: 5 }]);

      const { data } = await history({ from: "2026-09-01", series: "raw" }, key);

      expect(data.bars[0]).toMatchObject({ date: "2026-09-01", close: 10 });
      for (const field of ["adjOpen", "adjHigh", "adjLow", "adjClose"]) expect(data.bars[0]).not.toHaveProperty(field);
    });

    it("passes rawDerived through", async () => {
      await seedBarRows(FIRST, [
        { date: "2026-09-01", close: 10, rawDerived: true },
        { date: "2026-09-02", close: 11 },
      ]);

      const { data } = await history({ from: "2026-09-01" }, key);

      expect(barOf(data, "2026-09-01").rawDerived).toBe(true);
      expect(barOf(data, "2026-09-02").rawDerived).toBe(false);
    });

    it("pages 500 bars at a time with a base64url cursor of the last returned date", async () => {
      const firstDate = "2025-01-01";
      const rows = Array.from({ length: OVER_PAGE_SIZE }, (_, index) => ({ date: addDays(firstDate, index), close: PRICE }));
      await seedBarRows(FIRST, rows);

      const first = (await history({ from: firstDate }, key)).data;
      const lastOfFirst = rows[PAGE_SIZE - 1]!.date;

      expect(first.bars).toHaveLength(PAGE_SIZE);
      expect(first.nextCursor).not.toBeNull();
      expect(decodeBase64Url(first.nextCursor!)).toBe(lastOfFirst);

      const second = (await history({ from: firstDate, cursor: first.nextCursor }, key)).data;

      expect(second.bars.map((entry) => entry.date)).toEqual([rows[PAGE_SIZE]!.date, rows[PAGE_SIZE + 1]!.date]);
      expect(second.nextCursor).toBeNull();
    });

    it("rejects a range above 5 years as invalid_input", async () => {
      const result = await callTool(HISTORY_TOOL, { symbol: FIRST_TICKER, from: "2021-10-01", to: LATEST_SESSION }, key);

      expect(result.isError).toBe(true);
      expect(errorCodeOf(result)).toBe("invalid_input");
    });

    it("reports earliestAvailable when from is before the earliest bar", async () => {
      await seedBarRows(FIRST, [
        { date: "2026-09-01", close: 10 },
        { date: "2026-09-02", close: 11 },
      ]);

      const { data } = await history({ from: "2026-01-01" }, key);

      expect(data.earliestAvailable).toBe("2026-09-01");
      expect(data.bars).toHaveLength(2);
    });
  });

  describe("pending adjustment labels", () => {
    const preEx = ["2026-05-28", "2026-05-29", "2026-05-31"];
    const postEx = ["2026-06-02", "2026-06-03"];

    async function seedPlainBars(): Promise<void> {
      await seedBarRows(FIRST, [
        ...preEx.map((date) => ({ date, close: PRICE })),
        ...postEx.map((date) => ({ date, close: POST_EX_PRICE })),
      ]);
    }

    it("INV-6: labels every bar before the ex date of a needs_ratio action", async () => {
      await seedPlainBars();
      const actionId = await seedAction({ status: "needs_ratio" });

      const { data, meta } = await history({}, key);

      for (const date of preEx) expect(barOf(data, date)).toMatchObject({ adjustmentPending: true, rawPending: false });
      for (const date of postEx) expect(barOf(data, date)).toMatchObject({ adjustmentPending: false, rawPending: false });
      expect(data.pendingAdjustments).toHaveLength(1);
      expect(data.pendingAdjustments[0]).toMatchObject({
        actionId,
        kind: "bonus",
        exDate: EX_DATE,
        announcedOn: "2026-05-10",
        source: "mubasher",
        state: "needs_ratio",
        reason: NEEDS_RATIO_REASON,
      });
      expect(meta.notAvailable).toContainEqual({ field: ADJUSTED_FIELD, reason: NEEDS_RATIO_REASON });
    });

    it("keeps every flag as queued when the daily cap refused the apply", async () => {
      await seedPlainBars();
      const actionId = await seedAction({ status: "recorded", ratio: BONUS_RATIO });

      const refused = await applyAction(actionId, CAPPED_ROWS_PER_DAY);
      const { data, meta } = await history({}, key);

      expect(refused).toMatchObject({ applied: false, refusedReason: "daily_cap" });
      for (const date of preEx) expect(barOf(data, date).adjustmentPending).toBe(true);
      expect(data.pendingAdjustments[0]).toMatchObject({ actionId, state: "queued" });
      expect(data.pendingAdjustments[0]!.reason).toContain(QUEUED_REASON);
      expect(data.pendingAdjustments[0]!.reason).toContain(CAP_CAUSE);
      expect(meta.notAvailable.find((entry) => entry.field === ADJUSTED_FIELD)?.reason).toContain(QUEUED_REASON);
    });

    it("names the ex-date session as the cause while it is not stored", async () => {
      await seedPlainBars();
      await seedAction({ status: "recorded", ratio: BONUS_RATIO });
      await setLatestSession("2026-05-29");

      const { data } = await history({}, key);

      expect(data.pendingAdjustments[0]).toMatchObject({ state: "queued" });
      expect(data.pendingAdjustments[0]!.reason).toContain(EX_DATE_CAUSE);
    });

    it("SC-007: clears the flags and the list entry after a successful apply with no drop at the ex date", async () => {
      await seedBarRows(FIRST, [
        { date: "2026-05-29", close: PRICE },
        { date: EX_DATE, close: POST_EX_PRICE },
        { date: "2026-06-02", close: POST_EX_PRICE },
      ]);
      const actionId = await seedAction({ status: "recorded", ratio: BONUS_RATIO });
      await seedNotice(FIRST_TICKER, "bonus", EX_DATE);

      const result = await applyAction(actionId);
      const { data, meta } = await history({}, key);

      expect(result).toMatchObject({ applied: true, refusedReason: null });
      expect((await actionStatus(actionId)).status).toBe("applied");
      expect(await noticeStatus(FIRST_TICKER, "bonus", EX_DATE)).toBe("done");
      expect(data.pendingAdjustments).toEqual([]);
      expect(data.bars.every((entry) => entry.adjustmentPending === false && entry.rawPending === false)).toBe(true);
      expect(meta.notAvailable.some((entry) => entry.field === ADJUSTED_FIELD)).toBe(false);
      expect(barOf(data, "2026-05-29").adjClose).toBeCloseTo(barOf(data, EX_DATE).adjClose as number, 6);
      expect(barOf(data, "2026-05-29").close).toBe(PRICE);
    });

    it("INV-2: refuses a ratio entered before the ex date, labels nothing, then applies once the session is stored", async () => {
      const futureEx = "2026-10-27";
      await seedBarRows(FIRST, [
        { date: "2026-10-22", close: PRICE },
        { date: LATEST_SESSION, close: PRICE },
      ]);
      const actionId = await seedAction({ exDate: futureEx, status: "recorded", ratio: BONUS_RATIO });
      const before = await readStoredBars(FIRST);

      const refused = await applyAction(actionId);
      const { data } = await history({ from: "2026-10-01" }, key);

      expect(refused).toMatchObject({ applied: false, rows: 0, refusedReason: "ex_date_not_reached" });
      expect(await readStoredBars(FIRST)).toEqual(before);
      expect(data.pendingAdjustments).toEqual([]);
      expect(data.bars.every((entry) => entry.adjustmentPending === false && entry.rawPending === false)).toBe(true);
      expect((await actionStatus(actionId)).status).toBe("recorded");

      await seedBarRows(FIRST, [
        { date: "2026-10-26", close: PRICE },
        { date: futureEx, close: POST_EX_PRICE },
      ]);
      await setLatestSession(futureEx);

      const applied = await applyAction(actionId);
      const stored = await readStoredBars(FIRST);

      expect(applied).toMatchObject({ applied: true, refusedReason: null });
      expect(stored["2026-10-26"]!.adj_close).toBeCloseTo(stored[futureEx]!.adj_close, 6);
      expect(stored["2026-10-22"]!.adj_close).toBeCloseTo(PRICE * BONUS_FACTOR, 6);
    });
  });

  describe("apply integrity", () => {
    const preEx = ["2026-05-28", "2026-05-29", "2026-05-31"];

    async function seedLiveBars(): Promise<void> {
      await seedBarRows(FIRST, [
        ...preEx.map((date) => ({ date, close: PRICE })),
        { date: "2026-06-02", close: POST_EX_PRICE },
      ]);
    }

    function expectAdjustedOnce(stored: Record<string, StoredBar>): void {
      for (const date of preEx) {
        expect(stored[date]!.adj_close).toBeCloseTo(PRICE * BONUS_FACTOR, 6);
        expect(stored[date]!.adj_factor).toBeCloseTo(BONUS_FACTOR, 9);
      }
      expect(stored["2026-06-02"]!.adj_close).toBe(POST_EX_PRICE);
      expect(stored["2026-06-02"]!.adj_factor).toBe(1);
    }

    it("INV-1: a second apply for the same action changes nothing", async () => {
      await seedLiveBars();
      const actionId = await seedAction({ status: "recorded", ratio: BONUS_RATIO });

      const first = await applyAction(actionId);
      const afterFirst = await readStoredBars(FIRST);
      const rowsAfterFirst = await adjustRowsToday();
      const second = await applyAction(actionId);

      expect(first.applied).toBe(true);
      expect(second).toMatchObject({ applied: false, rows: 0, refusedReason: "not_recorded" });
      expect(await readStoredBars(FIRST)).toEqual(afterFirst);
      expect(await adjustRowsToday()).toBe(rowsAfterFirst);
      expectAdjustedOnce(await readStoredBars(FIRST));
    });

    it("INV-1: a stale candidate applied again loses with concurrent_change and adds nothing", async () => {
      await seedLiveBars();
      const actionId = await seedAction({ status: "recorded", ratio: BONUS_RATIO });
      const stale = await candidateOf(actionId);

      const first = await applyCandidate(stale);
      const rowsAfterFirst = await adjustRowsToday();
      const second = await applyCandidate(stale);

      expect(first.applied).toBe(true);
      expect(second).toEqual({ applied: false, rows: 0, refusedReason: "concurrent_change" });
      expect(await adjustRowsToday()).toBe(rowsAfterFirst);
      expectAdjustedOnce(await readStoredBars(FIRST));
    });

    it("INV-1 and C25: two concurrent calls with candidates read before either batch change adj once", async () => {
      await seedLiveBars();
      const actionId = await seedAction({ status: "recorded", ratio: BONUS_RATIO });
      const candidate = await candidateOf(actionId);
      const rowsBefore = (await adjustRowsToday()) ?? 0;
      const batchTotals = recordBatchRows();

      const results = await Promise.all([applyCandidate(candidate), applyCandidate(candidate)]);
      const written = await Promise.all(batchTotals);
      const winners = results.filter((result) => result.applied);
      const losers = results.filter((result) => !result.applied);
      const delta = ((await adjustRowsToday()) ?? 0) - rowsBefore;

      expect(winners).toHaveLength(1);
      expect(losers).toEqual([{ applied: false, rows: 0, refusedReason: "concurrent_change" }]);
      expectAdjustedOnce(await readStoredBars(FIRST));
      expect(delta).toBe(preEx.length + ADJUST_BATCH_OVERHEAD_ROWS);
      expect(delta).toBeGreaterThanOrEqual(Math.max(...written));
    });

    it("basis rule: backfilled bars before the ex date are rawPending and live bars adjustmentPending, then each is adjusted once", async () => {
      await setSymbolState(FIRST, "2026-10-22", "done");
      await seedBarRows(FIRST, [
        { date: "2026-05-28", close: PRICE, adjClose: PRICE * BONUS_FACTOR, rawDerived: true },
        { date: "2026-05-29", close: PRICE },
        { date: "2026-05-31", close: PRICE, adjClose: PRICE * BONUS_FACTOR, rawDerived: true },
        { date: "2026-06-02", close: POST_EX_PRICE },
      ]);
      const actionId = await seedAction({ status: "needs_ratio" });

      const { data } = await history({}, key);

      expect(barOf(data, "2026-05-28")).toMatchObject({ rawPending: true, adjustmentPending: false });
      expect(barOf(data, "2026-05-31")).toMatchObject({ rawPending: true, adjustmentPending: false });
      expect(barOf(data, "2026-05-29")).toMatchObject({ rawPending: false, adjustmentPending: true });
      expect(barOf(data, "2026-06-02")).toMatchObject({ rawPending: false, adjustmentPending: false });

      await env.DB.prepare("UPDATE corporate_actions SET status = 'recorded', ratio = ?2 WHERE id = ?1").bind(actionId, BONUS_RATIO).run();
      const result = await applyAction(actionId);
      const stored = await readStoredBars(FIRST);

      expect(result.applied).toBe(true);
      for (const date of ["2026-05-28", "2026-05-31"]) {
        expect(stored[date]!.adj_close).toBeCloseTo(PRICE * BONUS_FACTOR, 6);
        expect(stored[date]!.close).toBeCloseTo(PRICE / BONUS_FACTOR, 6);
        expect(stored[date]!.adj_factor).toBeCloseTo(BONUS_FACTOR, 9);
      }
      expect(stored["2026-05-29"]!.adj_close).toBeCloseTo(PRICE * BONUS_FACTOR, 6);
      expect(stored["2026-05-29"]!.close).toBe(PRICE);
      expect(stored["2026-05-29"]!.adj_factor).toBeCloseTo(BONUS_FACTOR, 9);
      expect(stored["2026-06-02"]!.adj_close).toBe(POST_EX_PRICE);
    });

    it("basis rule: an ex date after the basis multiplies adj once for backfilled and live bars", async () => {
      const exDate = "2026-10-23";
      await setSymbolState(FIRST, "2026-10-22", "done");
      await seedBarRows(FIRST, [
        { date: "2026-10-20", close: PRICE, rawDerived: true },
        { date: "2026-10-21", close: PRICE, rawDerived: true },
        { date: "2026-10-22", close: PRICE },
        { date: exDate, close: POST_EX_PRICE },
      ]);
      const actionId = await seedAction({ exDate, status: "recorded", ratio: BONUS_RATIO });

      const { data } = await history({ from: "2026-10-01" }, key);
      const result = await applyAction(actionId);
      const stored = await readStoredBars(FIRST);

      for (const date of ["2026-10-20", "2026-10-21", "2026-10-22"]) {
        expect(barOf(data, date)).toMatchObject({ adjustmentPending: true, rawPending: false });
        expect(stored[date]!.adj_close).toBeCloseTo(PRICE * BONUS_FACTOR, 6);
        expect(stored[date]!.close).toBe(PRICE);
        expect(stored[date]!.adj_factor).toBeCloseTo(BONUS_FACTOR, 9);
      }
      expect(result.applied).toBe(true);
      expect(stored[exDate]!.adj_close).toBe(POST_EX_PRICE);
    });

    it("INV-5: an apply during a backfill is refused and labeled queued, then applies once after done", async () => {
      const splitEx = "2026-03-02";
      await setSymbolState(FIRST, "2026-10-22", "loading");
      await seedAction({ kind: "split", exDate: splitEx, ratio: SPLIT_RATIO, status: "applied" });
      const actionId = await seedAction({ status: "recorded", ratio: BONUS_RATIO });
      await seedBarRows(FIRST, [
        { date: "2026-02-25", close: PRICE, rawDerived: true, adjFactor: SPLIT_FACTOR },
        { date: "2026-03-04", close: PRICE, rawDerived: true },
      ]);

      const refused = await applyAction(actionId);
      const labeled = await history({}, key);

      expect(refused).toMatchObject({ applied: false, rows: 0, refusedReason: "backfill_loading" });
      expect((await actionStatus(actionId)).status).toBe("recorded");
      expect(labeled.data.pendingAdjustments[0]).toMatchObject({ state: "queued" });
      expect(labeled.data.pendingAdjustments[0]!.reason).toContain(BACKFILL_CAUSE);

      await seedBarRows(FIRST, [
        { date: "2026-02-27", close: PRICE, rawDerived: true, adjFactor: SPLIT_FACTOR },
        { date: "2026-05-28", close: PRICE, rawDerived: true },
      ]);
      await setSymbolState(FIRST, "2026-10-22", "done");
      const applied = await applyAction(actionId);
      const secondTry = await applyAction(actionId);
      const stored = await readStoredBars(FIRST);

      expect(applied.applied).toBe(true);
      expect(secondTry.applied).toBe(false);
      const expectedFactor = (date: string): number => {
        const afterSplit = date < splitEx ? factorOf("split", SPLIT_RATIO) : 1;
        const afterBonus = date < EX_DATE ? factorOf("bonus", BONUS_RATIO) : 1;
        return afterSplit * afterBonus;
      };
      expect(Object.keys(stored)).toHaveLength(4);
      for (const [date, row] of Object.entries(stored)) expect(row.adj_factor).toBeCloseTo(expectedFactor(date), 9);
    });

    it("INV-5 interleaving: a stale candidate applied after the loading statement writes nothing", async () => {
      const splitEx = "2026-03-02";
      await seedBarRows(FIRST, [
        { date: "2026-02-25", close: PRICE },
        { date: "2026-03-04", close: PRICE },
        { date: "2026-05-28", close: PRICE },
        { date: "2026-06-02", close: POST_EX_PRICE },
      ]);
      const earlier = await seedAction({ kind: "split", exDate: splitEx, ratio: SPLIT_RATIO, status: "recorded" });
      const stale = await seedAction({ status: "recorded", ratio: BONUS_RATIO });
      await seedNotice(FIRST_TICKER, "bonus", EX_DATE);

      const appliedBefore = await applyAction(earlier);
      const staleCandidate = await candidateOf(stale);
      const barsAfterEarlier = await readStoredBars(FIRST);
      const rowsAfterEarlier = await adjustRowsToday();
      await env.DB.prepare("UPDATE symbols SET backfill_state = 'loading' WHERE isin = ?1").bind(FIRST).run();

      const result = await applyCandidate(staleCandidate);
      const appliedSet = await env.DB
        .prepare(
          "SELECT kind, ratio, ex_date FROM corporate_actions WHERE isin = ?1 AND status = 'applied' AND kind IN ('bonus', 'split', 'reverse_split')",
        )
        .bind(FIRST)
        .all<{ kind: string; ratio: number; ex_date: string }>();

      expect(appliedBefore.applied).toBe(true);
      expect(result).toEqual({ applied: false, rows: 0, refusedReason: "concurrent_change" });
      expect(await readStoredBars(FIRST)).toEqual(barsAfterEarlier);
      expect(await adjustRowsToday()).toBe(rowsAfterEarlier);
      expect(await noticeStatus(FIRST_TICKER, "bonus", EX_DATE)).toBe("open");
      expect(await actionStatus(stale)).toEqual({ status: "recorded", ratio: BONUS_RATIO });
      expect(appliedSet.results).toEqual([{ kind: "split", ratio: SPLIT_RATIO, ex_date: splitEx }]);
    });
  });

  describe("compare_symbols", () => {
    const dates = ["2026-05-28", "2026-05-31", "2026-06-02", "2026-06-03"];
    const compared = [syntheticTicker(0), syntheticTicker(1), syntheticTicker(2)];

    async function seedComparable(): Promise<void> {
      for (const [index, isin] of ALL_ISINS.slice(0, compared.length).entries()) {
        const base = PRICE * (index + 1);
        await seedBarRows(
          isin,
          dates.map((date, step) => ({
            date,
            close: base + step,
            high: base + step + 2,
            low: base + step - 1,
            volume: 1000 * (index + 1),
          })),
        );
      }
    }

    it("returns one item per symbol over the common period from a single bars statement", async () => {
      await seedComparable();
      const statements = recordStatements();

      const result = await compare({ symbols: compared }, key);
      const { data } = payloadOf<CompareData>(result);
      const barStatements = statements.filter((entry) => entry.sql.includes("daily_bars") && !entry.sql.includes("corporate_actions"));

      expect(barStatements).toHaveLength(1);
      expect(data.items.map((item) => item.ticker)).toEqual(compared);
      expect(data.commonFrom).toBe(dates[0]);
      expect(data.commonTo).toBe(dates[dates.length - 1]);
      expect(data.items[1]).toMatchObject({
        isin: ALL_ISINS[1],
        firstDate: dates[0],
        lastDate: dates[dates.length - 1],
        high: 205,
        low: 199,
        totalVolume: 8000,
        adjustmentPending: false,
        pendingAdjustments: [],
      });
      expect(data.items[1]!.returnPct).toBeCloseTo((203 / 200 - 1) * 100, 2);
    });

    it("records the summed D1 rows read in the usage counter", async () => {
      await seedComparable();
      const [range, pending] = await Promise.all([
        compareRange(env.DB, ALL_ISINS.slice(0, compared.length), "2026-05-01", LATEST_SESSION),
        pendingForIsins(env.DB, ALL_ISINS.slice(0, compared.length), UTC_DAY, "2026-05-01"),
      ]);
      const storeRowsRead = range.rowsRead + pending.rowsRead;

      await compare({ symbols: compared }, key);

      expect(storeRowsRead).toBeGreaterThan(0);
      expect(await usageRowsRead()).toBeGreaterThanOrEqual(storeRowsRead);
    });

    it("measures every symbol over the same period when one symbol starts after from", async () => {
      await seedComparable();
      await seedBarRows(ALL_ISINS[3]!, [
        { date: dates[2]!, close: PRICE, volume: 500 },
        { date: dates[3]!, close: PRICE + 10, volume: 500 },
      ]);

      const { data } = payloadOf<CompareData>(await compare({ symbols: [compared[0]!, syntheticTicker(3)] }, key));

      expect(data.commonFrom).toBe(dates[2]);
      expect(data.items.map((item) => item.firstDate)).toEqual([dates[2], dates[2]]);
      expect(data.items[0]).toMatchObject({ totalVolume: 2000, high: 105, low: 101 });
      expect(data.items[0]!.returnPct).toBeCloseTo((103 / 102 - 1) * 100, 2);
    });

    it("returns not_available when the symbols' stored periods do not overlap", async () => {
      await seedBarRows(ALL_ISINS[0]!, [{ date: dates[0]!, close: PRICE }, { date: dates[1]!, close: PRICE }]);
      await seedBarRows(ALL_ISINS[1]!, [{ date: dates[2]!, close: PRICE }, { date: dates[3]!, close: PRICE }]);

      const result = await compare({ symbols: [compared[0]!, compared[1]!] }, key);

      expect(result.isError).toBe(true);
      expect(errorCodeOf(result)).toBe("not_available");
    });

    it.each([[1], [6]])("rejects %i symbols as invalid_input", async (count) => {
      const symbols = Array.from({ length: count }, (_, index) => syntheticTicker(index));

      const result = await compare({ symbols }, key);

      expect(result.isError).toBe(true);
      expect(errorCodeOf(result)).toBe("invalid_input");
    });

    it("marks adjustmentPending only for the symbol whose pending action affects a bar in the range", async () => {
      await seedComparable();
      const actionId = await seedAction({ isin: ALL_ISINS[1], status: "needs_ratio" });

      const { data, meta } = payloadOf<CompareData>(await compare({ symbols: compared }, key));

      expect(data.items.map((item) => item.adjustmentPending)).toEqual([false, true, false]);
      expect(data.items[1]!.pendingAdjustments).toHaveLength(1);
      expect(data.items[1]!.pendingAdjustments[0]).toMatchObject({ actionId, state: "needs_ratio", reason: NEEDS_RATIO_REASON });
      expect(data.items[0]!.pendingAdjustments).toEqual([]);
      expect(meta.notAvailable).toContainEqual({ field: ADJUSTED_FIELD, reason: NEEDS_RATIO_REASON });
    });

    it("does not mark a range that starts after the ex date as pending", async () => {
      await seedComparable();
      await seedAction({ isin: ALL_ISINS[1], status: "needs_ratio" });

      const { data } = payloadOf<CompareData>(await compare({ symbols: compared, from: "2026-06-02" }, key));

      expect(data.items.map((item) => item.adjustmentPending)).toEqual([false, false, false]);
    });

    it("looks up pending actions in one statement with one bound parameter for the symbol list", async () => {
      await seedComparable();
      await seedAction({ isin: ALL_ISINS[1], status: "needs_ratio" });
      const statements = recordStatements();

      await compare({ symbols: compared }, key);
      const pending = statements.filter((entry) => entry.sql.includes("corporate_actions"));
      const listParams = pending[0]!.params.filter((param) => typeof param === "string" && param.startsWith("["));

      expect(pending).toHaveLength(1);
      expect(listParams).toHaveLength(1);
      expect(JSON.parse(listParams[0] as string)).toEqual(ALL_ISINS.slice(0, compared.length));
      expect(pending[0]!.params.some((param) => typeof param === "string" && param.startsWith("EGS"))).toBe(false);
    });
  });
});
