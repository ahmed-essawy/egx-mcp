export type ReturnPeriod = "1d" | "1w" | "1m" | "3m" | "1y" | "ytd";

const DAYS_PER_WEEK = 7;
const MONTHS_PER_YEAR = 12;
const LAST_MONTH_INDEX = 11;
const LAST_DAY_OF_YEAR = 31;
const ISO_DATE_LENGTH = 10;
const MIDDLE_DIVISOR = 2;

const MONTHS_BACK: Readonly<Record<"1m" | "3m" | "1y", number>> = {
  "1m": 1,
  "3m": 3,
  "1y": MONTHS_PER_YEAR,
};

function toIso(date: Date): string {
  return date.toISOString().slice(0, ISO_DATE_LENGTH);
}

export function shiftDays(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return toIso(shifted);
}

export function shiftMonths(date: string, months: number): string {
  const source = new Date(`${date}T00:00:00Z`);
  const totalMonths = source.getUTCFullYear() * MONTHS_PER_YEAR + source.getUTCMonth() + months;
  const year = Math.floor(totalMonths / MONTHS_PER_YEAR);
  const month = totalMonths % MONTHS_PER_YEAR;
  const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return toIso(new Date(Date.UTC(year, month, Math.min(source.getUTCDate(), lastDayOfMonth))));
}

export function periodReturn(first: number, last: number): number {
  return last / first - 1;
}

export function anchorDate(period: ReturnPeriod, today: string): string {
  switch (period) {
    case "1d":
      return shiftDays(today, -1);
    case "1w":
      return shiftDays(today, -DAYS_PER_WEEK);
    case "ytd":
      return toIso(
        new Date(Date.UTC(Number(today.slice(0, 4)) - 1, LAST_MONTH_INDEX, LAST_DAY_OF_YEAR)),
      );
    default:
      return shiftMonths(today, -MONTHS_BACK[period]);
  }
}

export function realReturn(nominal: number, cpiStart: number, cpiEnd: number): number {
  return (1 + nominal) / (cpiEnd / cpiStart) - 1;
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const lowerMiddle = Math.ceil(sorted.length / MIDDLE_DIVISOR) - 1;
  const upperMiddle = Math.floor(sorted.length / MIDDLE_DIVISOR);
  const middleValues = sorted.slice(lowerMiddle, upperMiddle + 1);
  return middleValues.reduce((sum, value) => sum + value, 0) / middleValues.length;
}
