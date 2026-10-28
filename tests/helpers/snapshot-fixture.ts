import type { Snapshot } from "../../src/store/kv";

export const DEFAULT_SESSION_DATE = "2026-10-25";
export const DEFAULT_GENERATED_AT = 1_793_000_000;

export function defaultSnapshot(): Snapshot {
  return {
    v: 1,
    generatedAt: DEFAULT_GENERATED_AT,
    session: {
      date: DEFAULT_SESSION_DATE,
      status: "open",
      tz: "Africa/Cairo",
      opensAt: "10:00",
      closesAt: "14:30",
      noTradesToday: false,
    },
    delay: { label: "delayed", minutes: 15 },
    sources: { stocks: "tradingview", primaryFailed: false },
    quotes: {},
    indices: {},
    fx: {},
    metals: {},
    breadth: { advancers: 0, decliners: 0, unchanged: 0 },
    totals: { volume: 0, value: 0 },
    top: { gainers: [], losers: [], byVolume: [], byValue: [] },
  };
}
