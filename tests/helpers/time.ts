export const MS_PER_SECOND = 1000;

const CAIRO_SUMMER_OFFSET = "+03:00";

export function cairoSummerEpoch(date: string, time: string): number {
  return Date.parse(`${date}T${time}:00${CAIRO_SUMMER_OFFSET}`) / MS_PER_SECOND;
}
