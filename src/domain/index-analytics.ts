import { percentChange, shiftDays } from "./returns";

export type Close = { date: string; close: number; source: string };
export type Interval = "daily" | "weekly" | "monthly";
export type DatedClose = { date: string; close: number };
export type IndexMetrics = {
  latest: DatedClose;
  previousClose: number | null;
  dailyChange: number | null;
  dailyChangePct: number | null;
  periodHigh: DatedClose | null;
  periodLow: DatedClose | null;
  periodReturnPct: number | null;
  sma20: number | null;
  sma50: number | null;
  annualizedVolatilityPct: number | null;
  drawdownFromHighPct: number | null;
  return5SessionsPct: number | null;
  observations: number;
};

export const NULLABLE_METRICS: readonly (keyof IndexMetrics)[] = [
  "previousClose",
  "dailyChange",
  "dailyChangePct",
  "periodHigh",
  "periodLow",
  "periodReturnPct",
  "sma20",
  "sma50",
  "annualizedVolatilityPct",
  "drawdownFromHighPct",
  "return5SessionsPct",
];

const THURSDAY = 4;
const DAYS_PER_WEEK = 7;
const MONTH_KEY_LENGTH = 7;
const SMA_SHORT = 20;
const SMA_LONG = 50;
const TRADING_DAYS_PER_YEAR = 252;
const SESSIONS_BACK = 5;
const PERCENT = 100;
const MIN_VOLATILITY_CLOSES = 3;
const MIN_PERIOD_CLOSES = 2;
const MIN_COMPARED_INDICES = 2;

function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

function changePct(current: number, base: number): number | null {
  return finiteOrNull(percentChange(base, current));
}

export function weekEnding(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return shiftDays(date, (THURSDAY - dow + DAYS_PER_WEEK) % DAYS_PER_WEEK);
}

function bucketKey(date: string, interval: Interval): string {
  return interval === "weekly" ? weekEnding(date) : date.slice(0, MONTH_KEY_LENGTH);
}

export function downsample(closes: Close[], interval: Interval): Close[] {
  if (interval === "daily") return closes;
  const result: Close[] = [];
  let currentKey = "";
  for (const close of closes) {
    const key = bucketKey(close.date, interval);
    if (key === currentKey) result[result.length - 1] = close;
    else result.push(close);
    currentKey = key;
  }
  return result;
}

export function lastRows<T>(items: T[], maxRows: number): { rows: T[]; truncated: boolean } {
  const truncated = items.length > maxRows;
  return { rows: truncated ? items.slice(items.length - maxRows) : items, truncated };
}

function toDated(close: Close): DatedClose {
  return { date: close.date, close: close.close };
}

function extreme(period: Close[], beats: (candidate: number, best: number) => boolean): DatedClose | null {
  let best: Close | null = null;
  for (const close of period) {
    if (best === null || beats(close.close, best.close)) best = close;
  }
  return best ? toDated(best) : null;
}

function movingAverage(series: Close[], window: number): number | null {
  if (series.length < window) return null;
  const sum = series.slice(series.length - window).reduce((total, close) => total + close.close, 0);
  return finiteOrNull(sum / window);
}

function annualizedVolatility(period: Close[]): number | null {
  if (period.length < MIN_VOLATILITY_CLOSES) return null;
  const returns = period.slice(1).map((close, index) => close.close / (period[index] as Close).close - 1);
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  return finiteOrNull(Math.sqrt(variance) * Math.sqrt(TRADING_DAYS_PER_YEAR) * PERCENT);
}

export function summarize(series: Close[], periodFrom: string): IndexMetrics {
  const latest = series[series.length - 1] as Close;
  const previous = series[series.length - 2];
  const period = series.filter((close) => close.date >= periodFrom);
  const first = period.length >= MIN_PERIOD_CLOSES ? period[0] : undefined;
  const high = first ? extreme(period, (candidate, best) => candidate > best) : null;
  const low = first ? extreme(period, (candidate, best) => candidate < best) : null;
  const sessionsBack = series[series.length - 1 - SESSIONS_BACK];
  return {
    latest: toDated(latest),
    previousClose: previous ? previous.close : null,
    dailyChange: previous ? finiteOrNull(latest.close - previous.close) : null,
    dailyChangePct: previous ? changePct(latest.close, previous.close) : null,
    periodHigh: high,
    periodLow: low,
    periodReturnPct: first ? changePct(latest.close, first.close) : null,
    sma20: movingAverage(series, SMA_SHORT),
    sma50: movingAverage(series, SMA_LONG),
    annualizedVolatilityPct: annualizedVolatility(period),
    drawdownFromHighPct: high ? changePct(latest.close, high.close) : null,
    return5SessionsPct: sessionsBack ? changePct(latest.close, sessionsBack.close) : null,
    observations: period.length,
  };
}

export function nullMetrics(metrics: IndexMetrics): string[] {
  return NULLABLE_METRICS.filter((key) => metrics[key] === null);
}

export function highestReturn(
  items: { code: string; periodReturnPct: number | null }[],
): { code: string; periodReturnPct: number } | null {
  let best: { code: string; periodReturnPct: number } | null = null;
  let counted = 0;
  for (const item of items) {
    if (item.periodReturnPct === null) continue;
    counted += 1;
    if (best === null || item.periodReturnPct > best.periodReturnPct) {
      best = { code: item.code, periodReturnPct: item.periodReturnPct };
    }
  }
  return counted >= MIN_COMPARED_INDICES ? best : null;
}
