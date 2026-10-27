import { cairoParts, sessionStatus, type CalendarRow } from "../domain/calendar";
import { currentSessionDate } from "../domain/freshness";
import type { RowsCounter } from "../limits/usage";
import { recentCalendar } from "../store/d1/calendar";
import type { Snapshot } from "../store/kv";

export type MarketClock = {
  now: number;
  today: string;
  todayRow: CalendarRow | null;
  holidays: ReadonlySet<string>;
  sessionDate: string;
};

export type SessionMeta = { date: string; status: string };

function holidayRow(date: string): CalendarRow {
  return { date, kind: "holiday", open_time: null, close_time: null };
}

function calendarOf(
  today: string,
  todayRow: CalendarRow | null,
  holidays: ReadonlySet<string>,
): (date: string) => CalendarRow | null {
  return (date) => {
    if (date === today) return todayRow;
    return holidays.has(date) ? holidayRow(date) : null;
  };
}

export async function loadMarketClock(db: D1Database, now: number, rows: RowsCounter): Promise<MarketClock> {
  const today = cairoParts(now).date;
  const { todayRow, holidays, rowsRead } = await recentCalendar(db, now);
  rows.add({ rows_read: rowsRead });
  const sessionDate = currentSessionDate(now, calendarOf(today, todayRow, holidays));
  return { now, today, todayRow, holidays, sessionDate };
}

export function sessionMeta(clock: MarketClock, snapshot: Snapshot | null): SessionMeta {
  if (snapshot?.session.noTradesToday && snapshot.session.date === clock.today) {
    return { date: snapshot.session.date, status: snapshot.session.status };
  }
  return { date: clock.sessionDate, status: sessionStatus(clock.now, clock.todayRow) };
}
