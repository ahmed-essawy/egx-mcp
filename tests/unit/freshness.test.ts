import { describe, expect, it } from "vitest";
import type { CalendarRow } from "../../src/domain/calendar";
import {
  currentSessionDate,
  isNavStale,
  isQuoteStale,
  tradingDaysBetween,
} from "../../src/domain/freshness";

const MILLIS_PER_SECOND = 1000;
const WEEKLY_CYCLE_DAYS = 5;
const NO_HOLIDAYS: ReadonlySet<string> = new Set();

const SESSION_SUNDAY = "2026-10-25";
const PREVIOUS_TRADING_DAY = "2026-10-22";
const TWO_TRADING_DAYS_BACK = "2026-10-21";

const NAV_DATE_5_TRADING_DAYS_OLD = "2026-10-18";
const NAV_DATE_6_TRADING_DAYS_OLD = "2026-10-15";
const NAV_DATE_7_TRADING_DAYS_OLD = "2026-10-14";

const HOLIDAY_THURSDAY = "2026-10-22";
const NAV_DATE_BEFORE_HOLIDAY = "2026-10-18";
const NAV_DATE_BEFORE_HOLIDAY_STALE = "2026-10-13";
const NAV_DATE_BEFORE_HOLIDAY_STALE_BOUNDARY = "2026-10-14";

const SUNDAY_BEFORE_OPEN_UTC = "2026-10-25T06:00:00Z";
const WEDNESDAY = "2026-10-28";
const TUESDAY = "2026-10-27";
const THURSDAY = "2026-10-29";
const WEDNESDAY_PRE_OPEN_UTC = "2026-10-28T06:59:00Z";
const WEDNESDAY_OPEN_UTC = "2026-10-28T07:00:00Z";
const WEDNESDAY_AFTER_CLOSE_UTC = "2026-10-28T12:00:00Z";
const TRADING_DAY_BEFORE_TWO_HOLIDAYS = "2026-10-20";
const TRADING_DAY_BEFORE_HOLIDAY = "2026-10-21";
const NAV_DATE_VERY_OLD = "2020-01-01";
const WEDNESDAY_SPECIAL_OPEN = "11:00";
const WEDNESDAY_SPECIAL_CLOSE = "13:30";
const WEDNESDAY_EARLY_SPECIAL_OPEN = "9:30";
const WEDNESDAY_BEFORE_SPECIAL_OPEN_UTC = "2026-10-28T07:30:00Z";
const WEDNESDAY_AT_SPECIAL_OPEN_UTC = "2026-10-28T08:00:00Z";
const WEDNESDAY_AFTER_EARLY_SPECIAL_OPEN_UTC = "2026-10-28T06:45:00Z";
const FRIDAY_MIDDAY_UTC = "2026-10-30T09:00:00Z";

function unixOf(isoUtc: string): number {
  return Date.parse(isoUtc) / MILLIS_PER_SECOND;
}

function holidayRow(date: string): CalendarRow {
  return { date, kind: "holiday", open_time: null, close_time: null };
}

function specialHoursRow(date: string, openTime: string): CalendarRow {
  return { date, kind: "special_hours", open_time: openTime, close_time: WEDNESDAY_SPECIAL_CLOSE };
}

function calendarOf(...rows: CalendarRow[]): (date: string) => CalendarRow | null {
  return (date) => rows.find((row) => row.date === date) ?? null;
}

describe("currentSessionDate", () => {
  it("returns the previous trading day on a trading day before the open", () => {
    expect(currentSessionDate(unixOf(WEDNESDAY_PRE_OPEN_UTC), calendarOf())).toBe(TUESDAY);
  });

  it("returns today on a trading day at the open", () => {
    expect(currentSessionDate(unixOf(WEDNESDAY_OPEN_UTC), calendarOf())).toBe(WEDNESDAY);
  });

  it("returns today on a trading day after the close", () => {
    expect(currentSessionDate(unixOf(WEDNESDAY_AFTER_CLOSE_UTC), calendarOf())).toBe(WEDNESDAY);
  });

  it("returns the previous trading day on a weekend", () => {
    expect(currentSessionDate(unixOf(FRIDAY_MIDDAY_UTC), calendarOf())).toBe(THURSDAY);
  });

  it("returns the previous trading day on a holiday", () => {
    const calendar = calendarOf(holidayRow(WEDNESDAY));
    expect(currentSessionDate(unixOf(WEDNESDAY_AFTER_CLOSE_UTC), calendar)).toBe(TUESDAY);
  });

  it("skips the weekend when a Sunday is before the open", () => {
    expect(currentSessionDate(unixOf(SUNDAY_BEFORE_OPEN_UTC), calendarOf())).toBe(
      PREVIOUS_TRADING_DAY,
    );
  });
});

describe("currentSessionDate with holidays and special hours", () => {
  it("skips a holiday when walking back from a Sunday before the open", () => {
    const calendar = calendarOf(holidayRow(HOLIDAY_THURSDAY));
    expect(currentSessionDate(unixOf(SUNDAY_BEFORE_OPEN_UTC), calendar)).toBe(
      TRADING_DAY_BEFORE_HOLIDAY,
    );
  });

  it("skips two holidays in a row", () => {
    const calendar = calendarOf(
      holidayRow(HOLIDAY_THURSDAY),
      holidayRow(TRADING_DAY_BEFORE_HOLIDAY),
    );
    expect(currentSessionDate(unixOf(SUNDAY_BEFORE_OPEN_UTC), calendar)).toBe(
      TRADING_DAY_BEFORE_TWO_HOLIDAYS,
    );
  });

  it("uses the special open time before the open", () => {
    const calendar = calendarOf(specialHoursRow(WEDNESDAY, WEDNESDAY_SPECIAL_OPEN));
    expect(currentSessionDate(unixOf(WEDNESDAY_BEFORE_SPECIAL_OPEN_UTC), calendar)).toBe(TUESDAY);
  });

  it("uses the special open time at the open", () => {
    const calendar = calendarOf(specialHoursRow(WEDNESDAY, WEDNESDAY_SPECIAL_OPEN));
    expect(currentSessionDate(unixOf(WEDNESDAY_AT_SPECIAL_OPEN_UTC), calendar)).toBe(WEDNESDAY);
  });

  it("compares an unpadded special open time in minutes", () => {
    const calendar = calendarOf(specialHoursRow(WEDNESDAY, WEDNESDAY_EARLY_SPECIAL_OPEN));
    expect(currentSessionDate(unixOf(WEDNESDAY_AFTER_EARLY_SPECIAL_OPEN_UTC), calendar)).toBe(
      WEDNESDAY,
    );
  });
});

describe("isQuoteStale", () => {
  it("is not stale when the trade date is the session date", () => {
    expect(isQuoteStale(SESSION_SUNDAY, SESSION_SUNDAY, NO_HOLIDAYS)).toBe(false);
  });

  it("is not stale when the trade date is the previous trading day", () => {
    expect(isQuoteStale(PREVIOUS_TRADING_DAY, SESSION_SUNDAY, NO_HOLIDAYS)).toBe(false);
  });

  it("is stale when the trade date is older than the previous trading day", () => {
    expect(isQuoteStale(TWO_TRADING_DAYS_BACK, SESSION_SUNDAY, NO_HOLIDAYS)).toBe(true);
  });

  it("treats a holiday as skipped when finding the previous trading day", () => {
    const holidays = new Set([HOLIDAY_THURSDAY]);
    expect(isQuoteStale(TWO_TRADING_DAYS_BACK, SESSION_SUNDAY, holidays)).toBe(false);
  });
});

describe("tradingDaysBetween", () => {
  it("returns zero for the same date", () => {
    expect(tradingDaysBetween(SESSION_SUNDAY, SESSION_SUNDAY, NO_HOLIDAYS)).toBe(0);
  });

  it("counts trading days after from up to and including to", () => {
    expect(tradingDaysBetween(NAV_DATE_5_TRADING_DAYS_OLD, SESSION_SUNDAY, NO_HOLIDAYS)).toBe(5);
    expect(tradingDaysBetween(NAV_DATE_6_TRADING_DAYS_OLD, SESSION_SUNDAY, NO_HOLIDAYS)).toBe(6);
    expect(tradingDaysBetween(NAV_DATE_7_TRADING_DAYS_OLD, SESSION_SUNDAY, NO_HOLIDAYS)).toBe(7);
  });

  it("does not count holidays", () => {
    const holidays = new Set([HOLIDAY_THURSDAY]);
    expect(tradingDaysBetween(NAV_DATE_BEFORE_HOLIDAY, SESSION_SUNDAY, holidays)).toBe(4);
  });
});

describe("isNavStale", () => {
  it("is not stale for a weekly fund with a NAV 5 trading days old", () => {
    expect(
      isNavStale(NAV_DATE_5_TRADING_DAYS_OLD, SESSION_SUNDAY, WEEKLY_CYCLE_DAYS, NO_HOLIDAYS),
    ).toBe(false);
  });

  it("is not stale for a weekly fund with a NAV 6 trading days old", () => {
    expect(
      isNavStale(NAV_DATE_6_TRADING_DAYS_OLD, SESSION_SUNDAY, WEEKLY_CYCLE_DAYS, NO_HOLIDAYS),
    ).toBe(false);
  });

  it("is stale for a weekly fund with a NAV 7 trading days old", () => {
    expect(
      isNavStale(NAV_DATE_7_TRADING_DAYS_OLD, SESSION_SUNDAY, WEEKLY_CYCLE_DAYS, NO_HOLIDAYS),
    ).toBe(true);
  });

  it("is stale for a very old NAV date", () => {
    expect(isNavStale(NAV_DATE_VERY_OLD, SESSION_SUNDAY, WEEKLY_CYCLE_DAYS, NO_HOLIDAYS)).toBe(
      true,
    );
  });

  it("counts trading days only, so a holiday extends the allowed calendar age", () => {
    const holidays = new Set([HOLIDAY_THURSDAY]);
    expect(
      isNavStale(
        NAV_DATE_BEFORE_HOLIDAY_STALE_BOUNDARY,
        SESSION_SUNDAY,
        WEEKLY_CYCLE_DAYS,
        holidays,
      ),
    ).toBe(false);
    expect(
      isNavStale(NAV_DATE_BEFORE_HOLIDAY_STALE, SESSION_SUNDAY, WEEKLY_CYCLE_DAYS, holidays),
    ).toBe(true);
  });
});
