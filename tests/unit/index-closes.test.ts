import { describe, expect, it } from "vitest";
import { indexClosesOf } from "../../src/domain/index-closes";
import type { IndexEntry, Snapshot } from "../../src/store/kv";

const DATE = "2026-10-25";
const OTHER_DATE = "2026-10-22";
const TRADE_TIME_ON_DATE = Date.UTC(2026, 9, 25, 11, 30, 0) / 1000;
const TRADE_TIME_BEFORE = Date.UTC(2026, 9, 22, 11, 30, 0) / 1000;
const TRADE_TIME_LATE_UTC = Date.UTC(2026, 9, 24, 22, 30, 0) / 1000;

type Input = Pick<Snapshot, "indices" | "session">;

function entry(value: number, changePct: number | null, tradeTime: number, source: string): IndexEntry {
  return { v: value, chp: changePct, tt: tradeTime, src: source };
}

function input(indices: Record<string, IndexEntry>, sessionDate = DATE): Input {
  return {
    indices,
    session: {
      date: sessionDate,
      status: "closed",
      tz: "Africa/Cairo",
      opensAt: "10:00",
      closesAt: "14:30",
      noTradesToday: false,
    },
  };
}

describe("indexClosesOf", () => {
  it("returns nothing when the session date differs from the date", () => {
    const snapshot = input({ EGX30: entry(1, 0.5, TRADE_TIME_ON_DATE, "tradingview") }, OTHER_DATE);

    expect(indexClosesOf(snapshot, DATE)).toEqual([]);
  });

  it("keeps only entries traded on the date in Cairo time", () => {
    const snapshot = input({
      EGX30: entry(1, 0.5, TRADE_TIME_ON_DATE, "tradingview"),
      EGX70EWI: entry(2, 0.1, TRADE_TIME_BEFORE, "tradingview"),
      EGX100EWI: entry(3, 0.2, TRADE_TIME_LATE_UTC, "tradingview"),
    });

    expect(indexClosesOf(snapshot, DATE).map((value) => value.indexCode)).toEqual(["EGX30", "EGX100EWI"]);
  });

  it("orders by the index code order and maps the entry fields", () => {
    const snapshot = input({
      EGX70EWI: entry(2, null, TRADE_TIME_ON_DATE, "tradingview"),
      EGX30: entry(1, 0.5, TRADE_TIME_ON_DATE, "mubasher"),
    });

    expect(indexClosesOf(snapshot, DATE)).toEqual([
      { indexCode: "EGX30", sessionDate: DATE, close: 1, changePct: 0.5, source: "mubasher" },
      { indexCode: "EGX70EWI", sessionDate: DATE, close: 2, changePct: null, source: "tradingview" },
    ]);
  });
});
