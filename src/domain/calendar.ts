export type CalendarRow = {
  date: string;
  kind: "holiday" | "special_hours";
  open_time: string | null;
  close_time: string | null;
};

export type CairoParts = { date: string; time: string; weekday: number };
export type TimeRange = { start: string; end: string };
export type SessionStatus = "pre_open" | "open" | "closed" | "holiday";

export const CAIRO_TIME_ZONE = "Africa/Cairo";
const MILLIS_PER_SECOND = 1000;
export const SECONDS_PER_DAY = 86400;
const ISO_DATE_LENGTH = 10;
const MINUTES_PER_HOUR = 60;
const MILLIS_PER_DAY = SECONDS_PER_DAY * MILLIS_PER_SECOND;

const FRIDAY = 5;
const SATURDAY = 6;
const DEFAULT_OPEN_TIME = "10:00";
const DEFAULT_CLOSE_TIME = "14:30";
const REFRESH_LEAD_MINUTES = 5;
const REFRESH_LAG_MINUTES = 15;
const END_OF_DAY_EARLIEST = "15:30";

const cairoFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: CAIRO_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZoneName: "shortOffset",
});

const OFFSET_PATTERN = /^GMT([+-])(\d{1,2})$/;

function utcDayOfWeek(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function toMinutes(time: string): number {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  return hours * MINUTES_PER_HOUR + minutes;
}

function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
  const minutes = totalMinutes % MINUTES_PER_HOUR;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function collectCairoParts(unixSeconds: number): Record<string, string> {
  const parts: Record<string, string> = {};
  for (const part of cairoFormatter.formatToParts(unixSeconds * MILLIS_PER_SECOND)) {
    parts[part.type] = part.value;
  }
  return parts;
}

function formatOffset(shortOffset: string): string {
  const match = OFFSET_PATTERN.exec(shortOffset);
  if (!match) throw new Error(`Unexpected Cairo offset: ${shortOffset}`);
  return `${match[1]}${(match[2] ?? "").padStart(2, "0")}:00`;
}

export function cairoParts(unixSeconds: number): CairoParts {
  const parts = collectCairoParts(unixSeconds);
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { date, time: `${parts.hour}:${parts.minute}`, weekday: utcDayOfWeek(date) };
}

export function toCairoIso(unixSeconds: number): string {
  const parts = collectCairoParts(unixSeconds);
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const time = `${parts.hour}:${parts.minute}:${parts.second}`;
  return `${date}T${time}${formatOffset(parts.timeZoneName ?? "")}`;
}

export function isTradingDay(date: string, row: CalendarRow | null): boolean {
  const weekday = utcDayOfWeek(date);
  if (weekday === FRIDAY || weekday === SATURDAY) return false;
  return row?.kind !== "holiday";
}

export function isTradingDate(date: string, holidays: ReadonlySet<string>): boolean {
  return isTradingDay(date, null) && !holidays.has(date);
}

export function sessionHours(row: CalendarRow | null): TimeRange {
  if (row?.kind === "special_hours" && row.open_time && row.close_time) {
    return { start: row.open_time, end: row.close_time };
  }
  return { start: DEFAULT_OPEN_TIME, end: DEFAULT_CLOSE_TIME };
}

export function refreshWindow(row: CalendarRow | null): TimeRange {
  const hours = sessionHours(row);
  return {
    start: formatMinutes(toMinutes(hours.start) - REFRESH_LEAD_MINUTES),
    end: formatMinutes(toMinutes(hours.end) + REFRESH_LAG_MINUTES),
  };
}

export function isEndOfDayDue(time: string, row: CalendarRow | null): boolean {
  const minutes = toMinutes(time);
  return minutes >= toMinutes(END_OF_DAY_EARLIEST) && minutes > toMinutes(refreshWindow(row).end);
}

export function hasSessionOpened(time: string, row: CalendarRow | null): boolean {
  return toMinutes(time) >= toMinutes(sessionHours(row).start);
}

export function sessionStatus(unixSeconds: number, row: CalendarRow | null): SessionStatus {
  if (row?.kind === "holiday") return "holiday";
  const { date, time } = cairoParts(unixSeconds);
  if (!isTradingDay(date, row)) return "closed";
  const hours = sessionHours(row);
  if (!hasSessionOpened(time, row)) return "pre_open";
  if (toMinutes(time) < toMinutes(hours.end)) return "open";
  return "closed";
}

export function previousTradingDay(date: string, holidays: ReadonlySet<string>): string {
  let candidate = date;
  do {
    candidate = new Date(Date.parse(`${candidate}T00:00:00Z`) - MILLIS_PER_DAY)
      .toISOString()
      .slice(0, 10);
  } while (!isTradingDate(candidate, holidays));
  return candidate;
}

export function precedingDays(date: string, count: number): string[] {
  return Array.from({ length: count }, (_value, index) =>
    new Date(Date.parse(`${date}T00:00:00Z`) - (index + 1) * MILLIS_PER_DAY).toISOString().slice(0, ISO_DATE_LENGTH),
  );
}

export function nextUtcMidnight(unixSeconds: number): number {
  return (Math.floor(unixSeconds / SECONDS_PER_DAY) + 1) * SECONDS_PER_DAY;
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / MILLIS_PER_SECOND);
}

export function utcDay(unixSeconds: number): string {
  return new Date(unixSeconds * MILLIS_PER_SECOND).toISOString().slice(0, ISO_DATE_LENGTH);
}
