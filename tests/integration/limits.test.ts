import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthProps } from "../../src/auth/api-keys";
import { RowsCounter, finishCall } from "../../src/limits/usage";
import { deleteAccount } from "../../src/store/d1/users";
import { clearState, restoreBindings, setBindings } from "../helpers/bindings";
import { MS_PER_SECOND } from "../helpers/time";
import { callTool } from "../helpers/mcp";
import { seedBars, seedDirectory, seedKey, seedSnapshot, seedUser, setNow } from "../helpers/seed";

const GIVEN_NOW = Date.UTC(2026, 9, 25, 12, 0, 0) / MS_PER_SECOND;
const GIVEN_DAY = "2026-10-25";
const NEXT_MIDNIGHT = Date.UTC(2026, 9, 26);
const SECONDS_PER_MINUTE = 60;
const DAILY_LIMIT = 100;
const GLOBAL_CALLS_CAP = 3;
const GLOBAL_ROWS_READ_CAP = 1000;
const PERSONAL_ROWS_CAP = 10;
const USER_EMAIL = "user@example.com";
const OTHER_EMAIL = "other@example.com";
const INDICES_TOOL = "get_indices";
const HISTORY_TOOL = "get_price_history";
const ISIN = "EGS60121C018";
const BAR_DATES = ["2026-10-20", "2026-10-21", "2026-10-22"];
const CAPACITY_MESSAGE = "The free service is at capacity until 00:00 UTC.";

type ToolOutcome = { isError?: boolean; structuredContent?: Record<string, unknown> };
type ErrorPayload = { code: string; message: string; retryAt: string | null };
type GlobalUsage = { calls: number; rows_read: number; personal_rows: number };

async function readKeyId(userId: string): Promise<string> {
  const row = await env.DB.prepare("SELECT id FROM api_keys WHERE user_id = ?1").bind(userId).first<{ id: string }>();
  return row?.id ?? "";
}

async function countUserUsageRows(userId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS rows FROM usage_daily WHERE user_id = ?1")
    .bind(userId)
    .first<{ rows: number }>();
  return row?.rows ?? 0;
}

async function seedCaller(email = USER_EMAIL): Promise<{ userId: string; key: string }> {
  const userId = await seedUser(email);
  return { userId, key: await seedKey(userId) };
}

async function seedGlobal(values: Partial<GlobalUsage>): Promise<void> {
  await env.DB.prepare("INSERT INTO usage_global (day, calls, rows_read, personal_rows) VALUES (?1, ?2, ?3, ?4)")
    .bind(GIVEN_DAY, values.calls ?? 0, values.rows_read ?? 0, values.personal_rows ?? 0)
    .run();
}

async function seedUserCalls(userId: string, calls: number): Promise<void> {
  await env.DB.prepare("INSERT INTO usage_daily (day, user_id, tool, calls) VALUES (?1, ?2, ?3, ?4)")
    .bind(GIVEN_DAY, userId, INDICES_TOOL, calls)
    .run();
}

async function readGlobal(): Promise<GlobalUsage> {
  const row = await env.DB.prepare("SELECT calls, rows_read, personal_rows FROM usage_global WHERE day = ?1")
    .bind(GIVEN_DAY)
    .first<GlobalUsage>();
  return row ?? { calls: 0, rows_read: 0, personal_rows: 0 };
}

async function readUserCalls(userId: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COALESCE(SUM(calls), 0) AS calls FROM usage_daily WHERE day = ?1 AND user_id = ?2",
  )
    .bind(GIVEN_DAY, userId)
    .first<{ calls: number }>();
  return row?.calls ?? 0;
}

async function readLastUsedAt(userId: string): Promise<number | null> {
  const row = await env.DB.prepare("SELECT last_used_at FROM api_keys WHERE user_id = ?1")
    .bind(userId)
    .first<{ last_used_at: number | null }>();
  return row?.last_used_at ?? null;
}

function callIndices(key: string): Promise<ToolOutcome> {
  return callTool(INDICES_TOOL, { names: [] }, key);
}

function errorOf(result: ToolOutcome): ErrorPayload {
  return (result.structuredContent as unknown as { error: ErrorPayload }).error;
}

function expectRefusal(result: ToolOutcome, code: string, retryAtMs: number): void {
  expect(result.isError).toBe(true);
  const error = errorOf(result);
  expect(error.code).toBe(code);
  expect(Date.parse(error.retryAt ?? "")).toBe(retryAtMs);
}

describe("limits", () => {
  beforeEach(async () => {
    setNow(GIVEN_NOW);
    await clearState();
    await seedSnapshot();
  });

  afterEach(() => {
    restoreBindings();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("global caps", () => {
    it("refuses the 4th call with capacity until the next 00:00 UTC", async () => {
      setBindings({ GLOBAL_DAILY_CALLS: String(GLOBAL_CALLS_CAP) });
      const { key } = await seedCaller();

      for (let call = 0; call < GLOBAL_CALLS_CAP; call += 1) {
        expect((await callIndices(key)).isError).toBeFalsy();
      }
      const refused = await callIndices(key);

      expectRefusal(refused, "capacity", NEXT_MIDNIGHT);
      expect(errorOf(refused).message).toBe(CAPACITY_MESSAGE);
    });

    it("refuses an unlimited user once the global call cap is reached", async () => {
      setBindings({ GLOBAL_DAILY_CALLS: String(GLOBAL_CALLS_CAP), UNLIMITED_EMAILS: USER_EMAIL });
      const { key } = await seedCaller();
      await seedGlobal({ calls: GLOBAL_CALLS_CAP });

      expectRefusal(await callIndices(key), "capacity", NEXT_MIDNIGHT);
    });

    it("refuses with capacity once the global rows-read cap is reached", async () => {
      setBindings({ GLOBAL_DAILY_ROWS_READ: String(GLOBAL_ROWS_READ_CAP) });
      const { key } = await seedCaller();
      await seedGlobal({ rows_read: GLOBAL_ROWS_READ_CAP });

      expectRefusal(await callIndices(key), "capacity", NEXT_MIDNIGHT);
    });
  });

  describe("per-user limits", () => {
    it("serves call 100 and refuses call 101 with rate_limited until the next 00:00 UTC", async () => {
      const { userId, key } = await seedCaller();
      await seedUserCalls(userId, DAILY_LIMIT - 1);

      expect((await callIndices(key)).isError).toBeFalsy();
      const refused = await callIndices(key);

      expectRefusal(refused, "rate_limited", NEXT_MIDNIGHT);
      expect(await readUserCalls(userId)).toBe(DAILY_LIMIT);
    });

    it("refuses with rate_limited one minute later when the rate limiter denies the call", async () => {
      vi.spyOn(env.RATE_LIMITER, "limit").mockResolvedValue({ success: false });
      const { key } = await seedCaller();

      const refused = await callIndices(key);

      expectRefusal(refused, "rate_limited", (GIVEN_NOW + SECONDS_PER_MINUTE) * MS_PER_SECOND);
      expect(errorOf(refused).message).toBe(`Rate limit reached. Retry at ${errorOf(refused).retryAt}.`);
    });

    it("skips the per-minute and per-day limits for an unlimited user", async () => {
      setBindings({ UNLIMITED_EMAILS: `${OTHER_EMAIL}, ${USER_EMAIL}` });
      const limiter = vi.spyOn(env.RATE_LIMITER, "limit").mockResolvedValue({ success: false });
      const { userId, key } = await seedCaller();
      await seedUserCalls(userId, DAILY_LIMIT);

      const served = await callIndices(key);

      expect(served.isError).toBeFalsy();
      expect(limiter).not.toHaveBeenCalled();
    });

    it("refuses a deleted user with unauthorized", async () => {
      const { userId, key } = await seedCaller();
      await env.DB.prepare("UPDATE users SET deleted_at = ?1 WHERE id = ?2").bind(GIVEN_NOW, userId).run();

      const refused = await callIndices(key);

      expect(refused.isError).toBe(true);
      expect(errorOf(refused).code).toBe("unauthorized");
      expect(errorOf(refused).message).toBe("Account not found.");
      expect(await readUserCalls(userId)).toBe(0);
    });
  });

  describe("deleted account", () => {
    it("refuses a cached key after the account is deleted and records no usage for it", async () => {
      const { userId, key } = await seedCaller();
      expect((await callIndices(key)).isError).toBeFalsy();
      await deleteAccount(env.DB, userId);

      const refused = await callIndices(key);

      expect(refused.isError).toBe(true);
      expect(errorOf(refused).code).toBe("unauthorized");
      expect(errorOf(refused).message).toBe("Account not found.");
      expect(await countUserUsageRows(userId)).toBe(0);
    });
  });

  describe("accounting", () => {
    it("increments usage_daily and usage_global.calls by 1 for each served call", async () => {
      const { userId, key } = await seedCaller();

      await callIndices(key);
      await callIndices(key);

      expect(await readUserCalls(userId)).toBe(2);
      expect((await readGlobal()).calls).toBe(2);
    });

    it("adds the rows a call read to usage_global.rows_read", async () => {
      const { key } = await seedCaller();
      await seedDirectory({
        symbols: [[ISIN, "COMI", null, "Commercial Intl Bank", "Banks", "active", "", "commercial intl bank", []]],
        tickerToIsin: { COMI: ISIN },
      });
      await seedBars(
        ISIN,
        BAR_DATES.map((sessionDate) => ({ sessionDate, open: 1, high: 2, low: 1, close: 2 })),
      );

      const served = await callTool(HISTORY_TOOL, { symbol: "COMI", from: BAR_DATES[0], to: BAR_DATES[2] }, key);

      expect(served.isError).toBeFalsy();
      expect((await readGlobal()).rows_read).toBeGreaterThanOrEqual(BAR_DATES.length);
    });
  });

  describe("personal-write cap", () => {
    it("serves a key call and skips touchKey without an error once the cap is reached", async () => {
      setBindings({ PERSONAL_DAILY_ROWS: String(PERSONAL_ROWS_CAP) });
      const { userId, key } = await seedCaller();
      await seedGlobal({ personal_rows: PERSONAL_ROWS_CAP });

      const served = await callIndices(key);

      expect(served.isError).toBeFalsy();
      expect(await readLastUsedAt(userId)).toBeNull();
      expect((await readGlobal()).personal_rows).toBe(PERSONAL_ROWS_CAP);
    });

    it("touches the key and counts its rows while under the cap", async () => {
      setBindings({ PERSONAL_DAILY_ROWS: String(PERSONAL_ROWS_CAP) });
      const { userId, key } = await seedCaller();

      await callIndices(key);

      expect(await readLastUsedAt(userId)).toBe(GIVEN_NOW);
      expect((await readGlobal()).personal_rows).toBeGreaterThan(0);
    });

    it("skips touchKey when the call's own personal writes land exactly on the cap", async () => {
      setBindings({ PERSONAL_DAILY_ROWS: String(PERSONAL_ROWS_CAP) });
      const { userId } = await seedCaller();
      const auth: AuthProps = {
        userId,
        email: USER_EMAIL,
        via: "key",
        keyId: await readKeyId(userId),
        scopes: ["mcp:read", "mcp:write"],
      };
      const rows = new RowsCounter();
      rows.add({ rows_written: PERSONAL_ROWS_CAP });

      await finishCall(env, auth, INDICES_TOOL, rows, GIVEN_NOW, {
        globalCalls: 0,
        globalRowsRead: 0,
        personalRows: 0,
        userCalls: 0,
        accountActive: true,
        rowsRead: 0,
      });

      expect(await readLastUsedAt(userId)).toBeNull();
      expect((await readGlobal()).personal_rows).toBe(PERSONAL_ROWS_CAP);
    });
  });
});
