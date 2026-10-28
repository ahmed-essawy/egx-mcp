import type { PendingAdjustment, StatsReturns, SymbolStats } from "../store/kv";
import { anchorDate, periodReturn, shiftDays, type ReturnPeriod } from "./returns";

export type StatsBarInput = { sessionDate: string; adjHigh: number; adjLow: number; adjClose: number; volume: number };

export const STATS_WINDOW_DAYS = 400;
const VOLUME_AVERAGE_SESSIONS = 20;
const PERCENT = 100;
const PERIODS: readonly ReturnPeriod[] = ["1d", "1w", "1m", "3m", "ytd", "1y"];

export function statsWindowStart(asOf: string): string {
  return shiftDays(asOf, -STATS_WINDOW_DAYS);
}

function extreme(
  bars: StatsBarInput[],
  value: (bar: StatsBarInput) => number,
  isBetter: (candidate: number, current: number) => boolean,
): { value: number; date: string } {
  const first = bars[0]!;
  let best = { value: value(first), date: first.sessionDate };
  for (const bar of bars) {
    if (isBetter(value(bar), best.value)) best = { value: value(bar), date: bar.sessionDate };
  }
  return best;
}

function averageVolume(bars: StatsBarInput[]): number {
  const recent = bars.slice(-VOLUME_AVERAGE_SESSIONS);
  return recent.reduce((sum, bar) => sum + bar.volume, 0) / recent.length;
}

function returnFor(bars: StatsBarInput[], last: StatsBarInput, period: ReturnPeriod, asOf: string): number | null {
  const anchor = anchorDate(period, asOf);
  const base = bars.findLast((bar) => bar.sessionDate <= anchor);
  if (base === undefined || base.adjClose === 0) return null;
  return periodReturn(base.adjClose, last.adjClose) * PERCENT;
}

function returns(bars: StatsBarInput[], last: StatsBarInput, asOf: string): StatsReturns {
  const entries = PERIODS.map((period) => [period, returnFor(bars, last, period, asOf)]);
  return Object.fromEntries(entries) as StatsReturns;
}

export function buildSymbolStats(
  bars: StatsBarInput[],
  asOf: string,
  pendingAdj: PendingAdjustment[],
): SymbolStats | null {
  const last = bars[bars.length - 1];
  if (last === undefined) return null;
  const yearStart = anchorDate("1y", asOf);
  const yearBars = bars.filter((bar) => bar.sessionDate >= yearStart);
  if (yearBars.length === 0) return null;
  const high = extreme(yearBars, (bar) => bar.adjHigh, (candidate, current) => candidate > current);
  const low = extreme(yearBars, (bar) => bar.adjLow, (candidate, current) => candidate < current);
  return {
    h52: high.value,
    h52d: high.date,
    l52: low.value,
    l52d: low.date,
    avgVol20: averageVolume(bars),
    ret: returns(bars, last, asOf),
    pendingAdj,
  };
}
