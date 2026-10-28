import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { insertNavs, recomputeCycles, upsertFunds, type NavRow } from "../../src/store/d1/funds";
import { createSqliteD1 } from "../helpers/sqlite-d1";

type StoredRow = Record<string, unknown>;

const FUND_ID = "fund-1";
const SOURCE = "mubasher";
const NOW = 1_792_000_000;
const LATER = NOW + 86_400;
const WEEKLY_NAV_DATES = ["2026-08-06", "2026-08-13", "2026-08-20", "2026-08-27"];
const HOLIDAYS_INSIDE_GAPS = ["2026-08-10", "2026-08-17", "2026-08-24"];
const WEEKLY_CYCLE_DAYS = 5;
const WEEKLY_CYCLE_DAYS_WITH_HOLIDAY = 4;

function navRow(navDate: string, nav = 10, fetchedAt = NOW): NavRow {
  return { fundId: FUND_ID, navDate, nav, source: SOURCE, fetchedAt };
}

describe("funds store", () => {
  let db: D1Database;
  let sqlite: DatabaseSync;

  beforeEach(async () => {
    ({ db, sqlite } = createSqliteD1());
    await upsertFunds(db, [{ fundId: FUND_ID, nameAr: "صندوق", nameEn: null, manager: null, currency: "EGP", category: null }], NOW);
  });

  function cycleDays(): number {
    return (sqlite.prepare("SELECT cycle_days FROM funds WHERE fund_id = ?1").get(FUND_ID) as { cycle_days: number }).cycle_days;
  }

  describe("insertNavs", () => {
    it("writes the new_nav event of every new NAV and none for an existing one", async () => {
      await insertNavs(db, [navRow("2026-10-20")]);

      const inserted = await insertNavs(db, [navRow("2026-10-20", 11, LATER), navRow("2026-10-21", 12, LATER)]);

      expect(inserted).toEqual([FUND_ID]);
      const events = sqlite.prepare("SELECT kind, occurred_at, fund_id, payload FROM market_events ORDER BY id").all() as StoredRow[];
      expect(events.map((event) => ({ ...event, payload: JSON.parse(String(event.payload)) }))).toEqual([
        { kind: "new_nav", occurred_at: NOW, fund_id: FUND_ID, payload: { navDate: "2026-10-20", nav: 10 } },
        { kind: "new_nav", occurred_at: LATER, fund_id: FUND_ID, payload: { navDate: "2026-10-21", nav: 12 } },
      ]);
    });

    it("keeps no NAV when its event cannot be written", async () => {
      sqlite.exec("DROP TABLE market_events");

      await expect(insertNavs(db, [navRow("2026-10-20")])).rejects.toThrow();

      expect(sqlite.prepare("SELECT COUNT(*) AS total FROM nav_records").get()).toEqual({ total: 0 });
    });
  });

  describe("recomputeCycles", () => {
    it("counts a holiday older than the recent calendar window inside the NAV window", async () => {
      await insertNavs(db, WEEKLY_NAV_DATES.map((date) => navRow(date)));
      const insertHoliday = sqlite.prepare("INSERT INTO market_calendar (date, kind) VALUES (?1, 'holiday')");
      for (const date of HOLIDAYS_INSIDE_GAPS) insertHoliday.run(date);

      await recomputeCycles(db, [FUND_ID]);

      expect(cycleDays()).toBe(WEEKLY_CYCLE_DAYS_WITH_HOLIDAY);
    });

    it("is the plain trading day gap when no holiday falls in the window", async () => {
      await insertNavs(db, WEEKLY_NAV_DATES.map((date) => navRow(date)));

      await recomputeCycles(db, [FUND_ID]);

      expect(cycleDays()).toBe(WEEKLY_CYCLE_DAYS);
    });
  });
});
