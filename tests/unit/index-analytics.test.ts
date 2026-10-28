import { describe, expect, it } from "vitest";
import {
  downsample,
  highestReturn,
  lastRows,
  nullMetrics,
  summarize,
  weekEnding,
  type Close,
} from "../../src/domain/index-analytics";

const SOURCE = "mubasher";
const NULLABLE_METRIC_COUNT = 11;
const TRADING_DAYS_PER_YEAR = 252;
const PERCENT = 100;
const RELATIVE_TOLERANCE = 1e-9;

function closes(entries: [string, number][]): Close[] {
  return entries.map(([date, close]) => ({ date, close, source: SOURCE }));
}

describe("weekEnding", () => {
  it("maps a date to the Thursday that ends its week", () => {
    expect(weekEnding("2026-10-25")).toBe("2026-10-29");
    expect(weekEnding("2026-10-29")).toBe("2026-10-29");
    expect(weekEnding("2026-10-31")).toBe("2026-11-05");
  });
});

describe("downsample", () => {
  it("keeps the last close of each week", () => {
    const input = closes([
      ["2026-10-18", 1],
      ["2026-10-19", 2],
      ["2026-10-20", 3],
      ["2026-10-21", 4],
      ["2026-10-22", 5],
      ["2026-10-25", 6],
      ["2026-10-26", 7],
    ]);

    expect(downsample(input, "weekly").map((row) => row.date)).toEqual(["2026-10-22", "2026-10-26"]);
  });

  it("keeps the last close of each month", () => {
    const input = closes([
      ["2026-09-29", 1],
      ["2026-09-30", 2],
      ["2026-10-01", 3],
    ]);

    expect(downsample(input, "monthly").map((row) => row.date)).toEqual(["2026-09-30", "2026-10-01"]);
  });

  it("returns the input for daily", () => {
    const input = closes([["2026-10-18", 1]]);

    expect(downsample(input, "daily")).toBe(input);
  });
});

describe("lastRows", () => {
  it("keeps the newest rows and flags truncation", () => {
    expect(lastRows([1, 2, 3], 2)).toEqual({ rows: [2, 3], truncated: true });
    expect(lastRows([1], 2)).toEqual({ rows: [1], truncated: false });
  });
});

describe("summarize", () => {
  const series = closes([
    ["2026-10-18", 100],
    ["2026-10-19", 102],
    ["2026-10-20", 101],
    ["2026-10-21", 105],
    ["2026-10-22", 110],
    ["2026-10-25", 108],
  ]);

  it("returns a null daily change percent when the previous close is zero", () => {
    const metrics = summarize(closes([["2026-10-18", 0], ["2026-10-19", 100]]), "2026-10-18");

    expect(metrics.dailyChangePct).toBeNull();
  });

  it("computes the metrics for the period", () => {
    const metrics = summarize(series, "2026-10-19");

    expect(metrics.latest).toEqual({ date: "2026-10-25", close: 108 });
    expect(metrics.previousClose).toBe(110);
    expect(metrics.dailyChange).toBe(-2);
    expect(metrics.dailyChangePct).toBe((108 / 110 - 1) * PERCENT);
    expect(metrics.periodHigh).toEqual({ date: "2026-10-22", close: 110 });
    expect(metrics.periodLow).toEqual({ date: "2026-10-20", close: 101 });
    expect(metrics.periodReturnPct).toBe((108 / 102 - 1) * PERCENT);
    expect(metrics.drawdownFromHighPct).toBe((108 / 110 - 1) * PERCENT);
    expect(metrics.return5SessionsPct).toBeCloseTo(8, 9);
    expect(metrics.observations).toBe(5);
    expect(metrics.sma20).toBeNull();
    expect(metrics.sma50).toBeNull();
  });

  it("computes the annualized sample volatility", () => {
    const returns = [101 / 102 - 1, 105 / 101 - 1, 110 / 105 - 1, 108 / 110 - 1];
    const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const variance =
      returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
    const expected = Math.sqrt(variance) * Math.sqrt(TRADING_DAYS_PER_YEAR) * PERCENT;

    const actual = summarize(series, "2026-10-19").annualizedVolatilityPct;

    expect(Math.abs((actual as number) - expected) / expected).toBeLessThan(RELATIVE_TOLERANCE);
  });

  it("computes the moving averages", () => {
    const fifty = Array.from({ length: 50 }, (_, index): [string, number] => {
      const day = new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10);
      return [day, index + 1];
    });

    const metrics = summarize(closes(fifty), "2026-01-01");

    expect(metrics.sma20).toBe(40.5);
    expect(metrics.sma50).toBe(25.5);
  });

  it("returns null period metrics when the period holds a single close", () => {
    const metrics = summarize(series, "2026-10-25");

    expect(metrics.observations).toBe(1);
    expect(metrics.periodReturnPct).toBeNull();
    expect(metrics.periodHigh).toBeNull();
    expect(metrics.periodLow).toBeNull();
    expect(metrics.drawdownFromHighPct).toBeNull();
    expect(metrics.dailyChangePct).not.toBeNull();
  });

  it("returns null metrics when the period is empty", () => {
    const metrics = summarize(closes([["2026-10-18", 100]]), "2026-10-19");

    expect(nullMetrics(metrics)).toHaveLength(NULLABLE_METRIC_COUNT);
  });
});

describe("highestReturn", () => {
  it("picks the maximum with ties going to the earlier item", () => {
    const items = [
      { code: "EGX30", periodReturnPct: 5 },
      { code: "EGX70EWI", periodReturnPct: 7 },
      { code: "EGX100EWI", periodReturnPct: 7 },
    ];

    expect(highestReturn(items)).toEqual({ code: "EGX70EWI", periodReturnPct: 7 });
  });

  it("is null with fewer than two returns", () => {
    expect(
      highestReturn([
        { code: "EGX30", periodReturnPct: 5 },
        { code: "EGX70EWI", periodReturnPct: null },
      ]),
    ).toBeNull();
  });
});
