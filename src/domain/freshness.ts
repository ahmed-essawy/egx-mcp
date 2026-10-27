import {
  cairoParts,
  hasSessionOpened,
  isTradingDate,
  isTradingDay,
  previousTradingDay,
  type CalendarRow,
} from "./calendar";

const NAV_GRACE_TRADING_DAYS = 1;
const NO_HOLIDAYS: ReadonlySet<string> = new Set();

function latestTradingDateOnOrBefore(date: string, holidays: ReadonlySet<string>): string {
  return isTradingDate(date, holidays) ? date : previousTradingDay(date, holidays);
}

function previousSessionDate(
  date: string,
  calendar: (date: string) => CalendarRow | null,
): string {
  let candidate = previousTradingDay(date, NO_HOLIDAYS);
  while (!isTradingDay(candidate, calendar(candidate))) {
    candidate = previousTradingDay(candidate, NO_HOLIDAYS);
  }
  return candidate;
}

function countTradingDays(
  from: string,
  to: string,
  holidays: ReadonlySet<string>,
  limit: number,
): number {
  let count = 0;
  let cursor = latestTradingDateOnOrBefore(to, holidays);
  while (cursor > from && count <= limit) {
    count += 1;
    cursor = previousTradingDay(cursor, holidays);
  }
  return count;
}

export function currentSessionDate(
  unixSeconds: number,
  calendar: (date: string) => CalendarRow | null,
): string {
  const { date, time } = cairoParts(unixSeconds);
  const row = calendar(date);
  if (isTradingDay(date, row) && hasSessionOpened(time, row)) return date;
  return previousSessionDate(date, calendar);
}

export function isQuoteStale(
  tradeDate: string,
  sessionDate: string,
  holidays: ReadonlySet<string>,
): boolean {
  return tradeDate < previousTradingDay(sessionDate, holidays);
}

export function tradingDaysBetween(
  from: string,
  to: string,
  holidays: ReadonlySet<string>,
): number {
  return countTradingDays(from, to, holidays, Number.POSITIVE_INFINITY);
}

export function isNavStale(
  navDate: string,
  today: string,
  cycleDays: number,
  holidays: ReadonlySet<string>,
): boolean {
  const allowedDays = cycleDays + NAV_GRACE_TRADING_DAYS;
  return countTradingDays(navDate, today, holidays, allowedDays) > allowedDays;
}
