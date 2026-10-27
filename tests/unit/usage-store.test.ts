import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addBackfillRows,
  addOauthKvWrites,
  addPersonalRows,
  readGlobal,
  readUsage,
  recordUsage,
  topUsers,
} from "../../src/store/d1/usage";

const GIVEN_DAY = "2026-10-25";
const OTHER_DAY = "2026-10-24";
const USER_ID = "user-1";
const OTHER_USER_ID = "user-2";
const MISSING_USER_ID = "user-missing";
const INDICES_TOOL = "get_indices";
const HISTORY_TOOL = "get_price_history";
const DELETED_AT = 1_792_000_000;
const ROWS_READ = 7;
const PERSONAL_ROWS = 3;

describe("usage store", () => {
  const db = env.DB;

  beforeEach(async () => {
    await db.batch([
      db.prepare("DELETE FROM usage_daily"),
      db.prepare("DELETE FROM usage_global"),
      db.prepare("DELETE FROM users"),
      db.prepare("INSERT INTO users (id, google_sub, email) VALUES (?1, ?2, ?3)").bind(USER_ID, "sub-1", "a@example.com"),
      db.prepare("INSERT INTO users (id, google_sub, email) VALUES (?1, ?2, ?3)").bind(OTHER_USER_ID, "sub-2", "b@example.com"),
    ]);
  });

  describe("readUsage", () => {
    it("returns zeros and an active account when nothing was recorded", async () => {
      const usage = await readUsage(db, USER_ID, GIVEN_DAY);

      expect(usage).toMatchObject({
        globalCalls: 0,
        globalRowsRead: 0,
        personalRows: 0,
        userCalls: 0,
        accountActive: true,
      });
    });

    it("sums the user's calls across tools for the day only", async () => {
      await recordUsage(db, { userId: USER_ID, day: GIVEN_DAY, tool: INDICES_TOOL, rowsRead: 0, personalRows: 0 });
      await recordUsage(db, { userId: USER_ID, day: GIVEN_DAY, tool: HISTORY_TOOL, rowsRead: 0, personalRows: 0 });
      await recordUsage(db, { userId: USER_ID, day: OTHER_DAY, tool: INDICES_TOOL, rowsRead: 0, personalRows: 0 });
      await recordUsage(db, { userId: OTHER_USER_ID, day: GIVEN_DAY, tool: INDICES_TOOL, rowsRead: 0, personalRows: 0 });

      const usage = await readUsage(db, USER_ID, GIVEN_DAY);

      expect(usage.userCalls).toBe(2);
      expect(usage.globalCalls).toBe(3);
    });

    it("reports a deleted account as inactive", async () => {
      await db.prepare("UPDATE users SET deleted_at = ?1 WHERE id = ?2").bind(DELETED_AT, USER_ID).run();

      expect((await readUsage(db, USER_ID, GIVEN_DAY)).accountActive).toBe(false);
    });

    it("reports an unknown user as inactive", async () => {
      expect((await readUsage(db, MISSING_USER_ID, GIVEN_DAY)).accountActive).toBe(false);
    });
  });

  describe("recordUsage", () => {
    it("creates both counters on the first call and increments them on the next", async () => {
      const entry = { userId: USER_ID, day: GIVEN_DAY, tool: INDICES_TOOL, rowsRead: ROWS_READ, personalRows: PERSONAL_ROWS };

      await recordUsage(db, entry);
      const second = await recordUsage(db, entry);

      const usage = await readUsage(db, USER_ID, GIVEN_DAY);
      expect(usage.userCalls).toBe(2);
      expect(usage.globalCalls).toBe(2);
      expect(usage.globalRowsRead).toBe(ROWS_READ * 2);
      expect(usage.personalRows).toBe(PERSONAL_ROWS * 2);
      expect(second.rowsWritten).toBe(2);
    });
  });

  describe("global counters", () => {
    it("adds to each counter without touching the others", async () => {
      await addPersonalRows(db, GIVEN_DAY, 4);
      await addPersonalRows(db, GIVEN_DAY, 1);
      await addOauthKvWrites(db, GIVEN_DAY, 2);
      await addBackfillRows(db, GIVEN_DAY, 9);

      expect(await readGlobal(db, GIVEN_DAY)).toEqual({
        calls: 0,
        rowsRead: 0,
        oauthKvWrites: 2,
        backfillRows: 9,
        adjustRows: 0,
        personalRows: 5,
      });
    });

    it("reads zeros for a day without a row", async () => {
      expect(await readGlobal(db, OTHER_DAY)).toEqual({
        calls: 0,
        rowsRead: 0,
        oauthKvWrites: 0,
        backfillRows: 0,
        adjustRows: 0,
        personalRows: 0,
      });
    });
  });

  describe("topUsers", () => {
    it("groups calls per user for the day, highest first, up to the limit", async () => {
      const calls: [string, string, string][] = [
        [USER_ID, GIVEN_DAY, INDICES_TOOL],
        [OTHER_USER_ID, GIVEN_DAY, INDICES_TOOL],
        [OTHER_USER_ID, GIVEN_DAY, HISTORY_TOOL],
        [USER_ID, OTHER_DAY, INDICES_TOOL],
      ];
      for (const [userId, day, tool] of calls) {
        await recordUsage(db, { userId, day, tool, rowsRead: 0, personalRows: 0 });
      }

      expect(await topUsers(db, GIVEN_DAY, 10)).toEqual([
        { userId: OTHER_USER_ID, calls: 2 },
        { userId: USER_ID, calls: 1 },
      ]);
      expect(await topUsers(db, GIVEN_DAY, 1)).toEqual([{ userId: OTHER_USER_ID, calls: 2 }]);
    });
  });
});
