import { describe, expect, it } from "vitest";
import {
  cairoParts,
  isTradingDay,
  nextUtcMidnight,
  previousTradingDay,
  refreshWindow,
  sessionStatus,
  type CalendarRow,
} from "../../src/domain/calendar";

const MILLIS_PER_SECOND = 1000;
const SUNDAY = 0;
const MONDAY = 1;
const WEDNESDAY = 3;

const GIVEN_TIMESTAMP = 1793001300;

const SUMMER_WEDNESDAY = "2026-10-28";
const SUMMER_WEDNESDAY_PRE_OPEN_UTC = "2026-10-28T06:59:00Z";
const SUMMER_WEDNESDAY_OPEN_UTC = "2026-10-28T07:00:00Z";
const SUMMER_WEDNESDAY_MIDDAY_UTC = "2026-10-28T09:00:00Z";
const SUMMER_WEDNESDAY_AFTER_CLOSE_UTC = "2026-10-28T11:31:00Z";
const SUMMER_WEDNESDAY_SPECIAL_AFTER_CLOSE_UTC = "2026-10-28T10:31:00Z";
const WINTER_SUNDAY = "2026-11-01";
const WINTER_SUNDAY_REFRESH_START_UTC = "2026-11-01T07:55:00Z";
const LAST_SECOND_BEFORE_DST_UTC = "2026-04-23T21:59:59Z";
const FIRST_SECOND_AFTER_DST_UTC = "2026-04-23T22:00:00Z";

const SUMMER_WEDNESDAY_CLOSE_UTC = "2026-10-28T11:30:00Z";
const FRIDAY_MIDDAY_UTC = "2026-10-30T09:00:00Z";
const SPECIAL_PRE_OPEN_UTC = "2026-10-28T07:15:00Z";
const FRIDAY_DATE = "2026-10-30";
const SATURDAY_DATE = "2026-10-31";
const SUNDAY_DATE = "2026-10-25";
const MONDAY_DATE = "2026-10-26";
const THURSDAY_DATE = "2026-10-22";

const DEFAULT_REFRESH_WINDOW = { start: "09:55", end: "14:45" };
const SPECIAL_REFRESH_WINDOW = { start: "09:55", end: "13:45" };

function unixOf(isoUtc: string): number {
  return Date.parse(isoUtc) / MILLIS_PER_SECOND;
}

function holidayRow(date: string): CalendarRow {
  return { date, kind: "holiday", open_time: null, close_time: null };
}

function specialHoursRow(date: string): CalendarRow {
  return { date, kind: "special_hours", open_time: "10:00", close_time: "13:30" };
}

describe("cairoParts", () => {
  it("returns the Cairo date and time of the given timestamp", () => {
    expect(cairoParts(GIVEN_TIMESTAMP)).toEqual({
      date: "2026-10-26",
      time: "10:55",
      weekday: MONDAY,
    });
  });

  it("applies UTC+3 on a summer Wednesday", () => {
    expect(cairoParts(unixOf("2026-10-28T07:55:00Z"))).toEqual({
      date: SUMMER_WEDNESDAY,
      time: "10:55",
      weekday: WEDNESDAY,
    });
  });

  it("applies UTC+2 on a winter Sunday", () => {
    expect(cairoParts(unixOf(WINTER_SUNDAY_REFRESH_START_UTC))).toEqual({
      date: WINTER_SUNDAY,
      time: "09:55",
      weekday: SUNDAY,
    });
  });

  it("honors the switch to UTC+3 on 2026-04-24", () => {
    expect(cairoParts(unixOf(LAST_SECOND_BEFORE_DST_UTC))).toMatchObject({
      date: "2026-04-23",
      time: "23:59",
    });
    expect(cairoParts(unixOf(FIRST_SECOND_AFTER_DST_UTC))).toMatchObject({
      date: "2026-04-24",
      time: "01:00",
    });
  });
});

describe("isTradingDay", () => {
  it("is true from Sunday to Thursday", () => {
    expect(isTradingDay(SUNDAY_DATE, null)).toBe(true);
    expect(isTradingDay(MONDAY_DATE, null)).toBe(true);
    expect(isTradingDay(SUMMER_WEDNESDAY, null)).toBe(true);
    expect(isTradingDay(THURSDAY_DATE, null)).toBe(true);
  });

  it("is false on Friday and Saturday", () => {
    expect(isTradingDay(FRIDAY_DATE, null)).toBe(false);
    expect(isTradingDay(SATURDAY_DATE, null)).toBe(false);
  });

  it("is false when the calendar row is a holiday", () => {
    expect(isTradingDay(MONDAY_DATE, holidayRow(MONDAY_DATE))).toBe(false);
  });

  it("stays true when the calendar row is special hours", () => {
    expect(isTradingDay(MONDAY_DATE, specialHoursRow(MONDAY_DATE))).toBe(true);
  });
});

describe("refreshWindow", () => {
  it("defaults to 09:55 until 14:45", () => {
    expect(refreshWindow(null)).toEqual(DEFAULT_REFRESH_WINDOW);
  });

  it("opens 5 minutes before the special open and closes 15 minutes after the special close", () => {
    expect(refreshWindow(specialHoursRow(SUMMER_WEDNESDAY))).toEqual(SPECIAL_REFRESH_WINDOW);
  });
});

describe("sessionStatus", () => {
  it("is pre_open before the open", () => {
    expect(sessionStatus(unixOf(SUMMER_WEDNESDAY_PRE_OPEN_UTC), null)).toBe("pre_open");
  });

  it("is open from the open until the close", () => {
    expect(sessionStatus(unixOf(SUMMER_WEDNESDAY_OPEN_UTC), null)).toBe("open");
    expect(sessionStatus(unixOf(SUMMER_WEDNESDAY_MIDDAY_UTC), null)).toBe("open");
  });

  it("is closed after the close", () => {
    expect(sessionStatus(unixOf(SUMMER_WEDNESDAY_AFTER_CLOSE_UTC), null)).toBe("closed");
  });

  it("uses the special hours of the calendar row", () => {
    const row = specialHoursRow(SUMMER_WEDNESDAY);

    expect(sessionStatus(unixOf(SUMMER_WEDNESDAY_MIDDAY_UTC), row)).toBe("open");
    expect(sessionStatus(unixOf(SUMMER_WEDNESDAY_SPECIAL_AFTER_CLOSE_UTC), row)).toBe("closed");
  });

  it("is closed exactly at the close", () => {
    expect(sessionStatus(unixOf(SUMMER_WEDNESDAY_CLOSE_UTC), null)).toBe("closed");
  });

  it("is closed on a Friday during session hours", () => {
    expect(sessionStatus(unixOf(FRIDAY_MIDDAY_UTC), null)).toBe("closed");
  });

  it("is pre_open before a special open of 10:30", () => {
    const row = { ...specialHoursRow(SUMMER_WEDNESDAY), open_time: "10:30" };

    expect(sessionStatus(unixOf(SPECIAL_PRE_OPEN_UTC), row)).toBe("pre_open");
  });

  it("compares times numerically for an open time without a leading zero", () => {
    const row = { ...specialHoursRow(SUMMER_WEDNESDAY), open_time: "9:30" };

    expect(sessionStatus(unixOf(SUMMER_WEDNESDAY_PRE_OPEN_UTC), row)).toBe("open");
  });

  it("is holiday on a holiday", () => {
    expect(
      sessionStatus(unixOf(SUMMER_WEDNESDAY_MIDDAY_UTC), holidayRow(SUMMER_WEDNESDAY)),
    ).toBe("holiday");
  });
});

describe("previousTradingDay", () => {
  const noHolidays: ReadonlySet<string> = new Set();

  it("returns the previous weekday for a mid-week date", () => {
    expect(previousTradingDay(SUMMER_WEDNESDAY, noHolidays)).toBe("2026-10-27");
  });

  it("skips Friday and Saturday", () => {
    expect(previousTradingDay(SUNDAY_DATE, noHolidays)).toBe(THURSDAY_DATE);
  });

  it("skips the dates in the holiday set", () => {
    expect(previousTradingDay(MONDAY_DATE, new Set([SUNDAY_DATE]))).toBe(THURSDAY_DATE);
  });
});

describe("nextUtcMidnight", () => {
  it("returns the next UTC midnight after a mid-day timestamp", () => {
    expect(nextUtcMidnight(unixOf("2026-10-26T10:55:00Z"))).toBe(unixOf("2026-10-27T00:00:00Z"));
  });

  it("moves a timestamp at exactly UTC midnight to the following midnight", () => {
    expect(nextUtcMidnight(unixOf("2026-10-27T00:00:00Z"))).toBe(unixOf("2026-10-28T00:00:00Z"));
  });
});
