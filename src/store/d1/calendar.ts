import { cairoParts, SECONDS_PER_DAY, type CalendarRow } from "../../domain/calendar";
import type { ReadResult, WriteResult } from "./users";

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

export async function holidaysBetween(db: D1Database, from: string, to: string): Promise<ReadResult<Set<string>>> {
  const { results, meta } = await db
    .prepare("SELECT date FROM market_calendar WHERE kind = 'holiday' AND date BETWEEN ?1 AND ?2")
    .bind(from, to)
    .all<{ date: string }>();
  return { value: new Set(results.map((row) => row.date)), rowsRead: meta.rows_read ?? 0 };
}

export type CalendarDay = {
  date: string;
  kind: CalendarRow["kind"];
  openTime: string | null;
  closeTime: string | null;
  note: string | null;
};

export type RemoveCalendarResult = WriteResult & { removed: boolean };

type CalendarDayRecord = {
  date: string;
  kind: CalendarRow["kind"];
  open_time: string | null;
  close_time: string | null;
  note: string | null;
};

export async function upsertCalendarDay(db: D1Database, day: CalendarDay): Promise<WriteResult> {
  const { meta } = await db
    .prepare(
      `INSERT INTO market_calendar (date, kind, open_time, close_time, note) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (date) DO UPDATE SET
         kind = excluded.kind,
         open_time = excluded.open_time,
         close_time = excluded.close_time,
         note = excluded.note`,
    )
    .bind(day.date, day.kind, day.openTime, day.closeTime, day.note)
    .run();
  return { rowsWritten: meta.rows_written };
}

export async function removeCalendarDay(db: D1Database, date: string): Promise<RemoveCalendarResult> {
  const { meta } = await db.prepare("DELETE FROM market_calendar WHERE date = ?1").bind(date).run();
  return { removed: meta.changes > 0, rowsWritten: meta.rows_written };
}

export async function listCalendar(db: D1Database, from: string, to: string): Promise<ReadResult<CalendarDay[]>> {
  const { results, meta } = await db
    .prepare(
      "SELECT date, kind, open_time, close_time, note FROM market_calendar WHERE date BETWEEN ?1 AND ?2 ORDER BY date",
    )
    .bind(from, to)
    .all<CalendarDayRecord>();
  const days = results.map((row) => ({
    date: row.date,
    kind: row.kind,
    openTime: row.open_time,
    closeTime: row.close_time,
    note: row.note,
  }));
  return { value: days, rowsRead: meta.rows_read ?? 0 };
}
