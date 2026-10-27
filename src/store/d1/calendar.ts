import { cairoParts, SECONDS_PER_DAY, type CalendarRow } from "../../domain/calendar";

const HOLIDAY_LOOKBACK_DAYS = 14;

export type RecentCalendar = {
  todayRow: CalendarRow | null;
  holidays: Set<string>;
  rowsRead: number;
};

export async function getCalendarRow(db: D1Database, date: string): Promise<CalendarRow | null> {
  return db
    .prepare("SELECT date, kind, open_time, close_time FROM market_calendar WHERE date = ?1")
    .bind(date)
    .first<CalendarRow>();
}

export async function recentCalendar(db: D1Database, now: number): Promise<RecentCalendar> {
  const today = cairoParts(now).date;
  const from = cairoParts(now - HOLIDAY_LOOKBACK_DAYS * SECONDS_PER_DAY).date;
  const { results, meta } = await db
    .prepare("SELECT date, kind, open_time, close_time FROM market_calendar WHERE date BETWEEN ?1 AND ?2")
    .bind(from, today)
    .all<CalendarRow>();
  return {
    todayRow: results.find((row) => row.date === today) ?? null,
    holidays: new Set(results.filter((row) => row.kind === "holiday").map((row) => row.date)),
    rowsRead: meta.rows_read ?? 0,
  };
}
