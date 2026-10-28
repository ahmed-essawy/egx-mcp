import { describe, expect, it } from "vitest";
import {
  actionFactor,
  applyRefusal,
  backfillRowValues,
  deriveRaw,
  parseMubasherCsvLine,
  revertRefusal,
  validateRatio,
  type ApplyCandidate,
} from "../../src/domain/adjust";

const MAX_ROWS_PER_DAY = 10000;

function candidate(overrides: Partial<ApplyCandidate> = {}): ApplyCandidate {
  return {
    id: 1,
    isin: "EGS000000001",
    ticker: "COMI",
    kind: "bonus",
    ratio: 0.25,
    exDate: "2026-10-20",
    status: "recorded",
    basisDate: null,
    backfillState: null,
    rowCount: 600,
    latestSession: "2026-10-22",
    adjustRowsToday: 0,
    ...overrides,
  };
}

describe("actionFactor", () => {
  it("is 1 / (1 + ratio) for a bonus", () => {
    expect(actionFactor("bonus", 0.25)).toBeCloseTo(1 / 1.25, 12);
  });

  it("is 1 / ratio for a split", () => {
    expect(actionFactor("split", 2)).toBe(0.5);
  });

  it("is 1 / ratio for a reverse split", () => {
    expect(actionFactor("reverse_split", 0.1)).toBeCloseTo(10, 12);
  });

  it("throws for a kind that never adjusts prices", () => {
    expect(() => actionFactor("cash_dividend", 1)).toThrow();
    expect(() => actionFactor("rights", 1)).toThrow();
  });

  it("throws for a ratio that is not positive", () => {
    expect(() => actionFactor("bonus", 0)).toThrow();
    expect(() => actionFactor("split", -2)).toThrow();
  });
});

describe("parseMubasherCsvLine", () => {
  it("reads a line and clamps open to the day's range", () => {
    expect(parseMubasherCsvLine("2026-10-22/00:00:00,129.0,128.68,125.15,125.15,5110068")).toEqual({
      date: "2026-10-22",
      open: 128.68,
      high: 128.68,
      low: 125.15,
      close: 125.15,
      volume: 5110068,
    });
  });

  it("returns null for a line that is not a bar", () => {
    expect(parseMubasherCsvLine("")).toBeNull();
    expect(parseMubasherCsvLine("Date,Open,High,Low,Close,Volume")).toBeNull();
  });

  it("returns null when a column is empty", () => {
    expect(parseMubasherCsvLine("2020-01-05/00:00:00,10,11,9,,1000")).toBeNull();
  });
});

describe("deriveRaw", () => {
  it("divides the prices by the cumulative factor and marks the bar derived", () => {
    const adjBar = { date: "2025-01-05", open: 40, high: 44, low: 38, close: 42, volume: 1000 };

    const raw = deriveRaw(adjBar, 0.8);

    expect(raw.open).toBeCloseTo(50, 10);
    expect(raw.high).toBeCloseTo(55, 10);
    expect(raw.low).toBeCloseTo(47.5, 10);
    expect(raw.close).toBeCloseTo(52.5, 10);
    expect(raw.volume).toBe(1000);
    expect(raw.rawDerived).toBe(true);
  });

  it("makes the adjusted close continuous across a bonus ex date", () => {
    const factor = actionFactor("bonus", 0.25);
    const tradedBeforeExDate = 100;
    const tradedOnExDate = 80;

    const adjustedBefore = tradedBeforeExDate * factor;

    expect(adjustedBefore).toBeCloseTo(tradedOnExDate, 10);
    expect(deriveRaw({ date: "2026-10-19", open: adjustedBefore, high: adjustedBefore, low: adjustedBefore, close: adjustedBefore, volume: 1 }, factor).close).toBeCloseTo(
      tradedBeforeExDate,
      10,
    );
  });
});

describe("validateRatio", () => {
  it("returns a message for a ratio outside the kind's range", () => {
    expect(validateRatio("reverse_split", 10)).toBe("ratio for reverse_split must be 0 < ratio < 1");
    expect(validateRatio("split", 0.5)).toBe("ratio for split must be ratio > 1");
    expect(validateRatio("bonus", 10.5)).toBe("ratio for bonus must be 0 < ratio <= 10");
  });

  it("returns null for a ratio inside the kind's range", () => {
    expect(validateRatio("bonus", 10)).toBeNull();
    expect(validateRatio("split", 2)).toBeNull();
    expect(validateRatio("reverse_split", 0.1)).toBeNull();
  });
});

describe("applyRefusal", () => {
  it("accepts a recorded action whose ex date is stored and whose cap has room", () => {
    expect(applyRefusal(candidate(), MAX_ROWS_PER_DAY)).toBeNull();
  });

  it("refuses an action that is not recorded", () => {
    expect(applyRefusal(candidate({ status: "needs_ratio", ratio: null }), MAX_ROWS_PER_DAY)).toBe("not_recorded");
    expect(applyRefusal(candidate({ status: "applied" }), MAX_ROWS_PER_DAY)).toBe("not_recorded");
  });

  it("refuses when the latest stored session is null or before the ex date", () => {
    expect(applyRefusal(candidate({ latestSession: null }), MAX_ROWS_PER_DAY)).toBe("ex_date_not_reached");
    expect(applyRefusal(candidate({ latestSession: "2026-10-19" }), MAX_ROWS_PER_DAY)).toBe("ex_date_not_reached");
  });

  it("accepts a latest stored session equal to the ex date", () => {
    expect(applyRefusal(candidate({ latestSession: "2026-10-20" }), MAX_ROWS_PER_DAY)).toBeNull();
  });

  it("refuses while the symbol's backfill is loading", () => {
    expect(applyRefusal(candidate({ backfillState: "loading" }), MAX_ROWS_PER_DAY)).toBe("backfill_loading");
  });

  it("refuses when the batch would pass the daily cap", () => {
    expect(applyRefusal(candidate({ rowCount: 600, adjustRowsToday: 9393 }), MAX_ROWS_PER_DAY)).toBe("daily_cap");
    expect(applyRefusal(candidate({ rowCount: 600, adjustRowsToday: 9392 }), MAX_ROWS_PER_DAY)).toBeNull();
  });

  it("reports guards in order", () => {
    const everythingWrong = candidate({
      status: "needs_ratio",
      latestSession: null,
      backfillState: "loading",
      adjustRowsToday: MAX_ROWS_PER_DAY,
    });

    expect(applyRefusal(everythingWrong, MAX_ROWS_PER_DAY)).toBe("not_recorded");
    expect(applyRefusal({ ...everythingWrong, status: "recorded" }, MAX_ROWS_PER_DAY)).toBe("ex_date_not_reached");
    expect(applyRefusal({ ...everythingWrong, status: "recorded", latestSession: "2026-10-22" }, MAX_ROWS_PER_DAY)).toBe(
      "backfill_loading",
    );
    expect(
      applyRefusal(
        { ...everythingWrong, status: "recorded", latestSession: "2026-10-22", backfillState: "done" },
        MAX_ROWS_PER_DAY,
      ),
    ).toBe("daily_cap");
  });
});

describe("revertRefusal", () => {
  it("accepts an applied action", () => {
    expect(revertRefusal(candidate({ status: "applied" }), MAX_ROWS_PER_DAY)).toBeNull();
  });

  it("refuses an action that is not applied", () => {
    expect(revertRefusal(candidate({ status: "recorded" }), MAX_ROWS_PER_DAY)).toBe("not_applied");
  });

  it("refuses while the symbol's backfill is loading", () => {
    expect(revertRefusal(candidate({ status: "applied", backfillState: "loading" }), MAX_ROWS_PER_DAY)).toBe(
      "backfill_loading",
    );
  });

  it("refuses when the batch would pass the daily cap", () => {
    expect(revertRefusal(candidate({ status: "applied", adjustRowsToday: 9393 }), MAX_ROWS_PER_DAY)).toBe("daily_cap");
  });

  it("does not require the ex date to be stored", () => {
    expect(revertRefusal(candidate({ status: "applied", latestSession: null }), MAX_ROWS_PER_DAY)).toBeNull();
  });
});

describe("backfillRowValues", () => {
  const basisDate = "2026-10-22";
  const csvBar = { date: "2025-01-05", open: 10, high: 12, low: 9, close: 11, volume: 500 };
  const bonusA = { kind: "bonus" as const, ratio: 0.25, exDate: "2025-06-01", status: "applied" as const };
  const splitC = { kind: "split" as const, ratio: 2, exDate: "2026-10-24", status: "applied" as const };

  it("applies actions after the basis to adj, actions up to the basis to raw, and all later actions to the factor", () => {
    const row = backfillRowValues(csvBar, [bonusA, splitC], basisDate);

    expect(row.adjOpen).toBeCloseTo(csvBar.open * 0.5, 10);
    expect(row.adjHigh).toBeCloseTo(csvBar.high * 0.5, 10);
    expect(row.adjLow).toBeCloseTo(csvBar.low * 0.5, 10);
    expect(row.adjClose).toBeCloseTo(csvBar.close * 0.5, 10);
    expect(row.open).toBeCloseTo(csvBar.open / 0.8, 10);
    expect(row.high).toBeCloseTo(csvBar.high / 0.8, 10);
    expect(row.low).toBeCloseTo(csvBar.low / 0.8, 10);
    expect(row.close).toBeCloseTo(csvBar.close / 0.8, 10);
    expect(row.adjFactor).toBeCloseTo(0.4, 10);
    expect(row.rawDerived).toBe(true);
  });

  it("leaves raw equal to the CSV for a row dated after the action's ex date", () => {
    const row = backfillRowValues({ ...csvBar, date: "2025-07-01" }, [bonusA, splitC], basisDate);

    expect(row.close).toBeCloseTo(csvBar.close, 10);
    expect(row.adjClose).toBeCloseTo(csvBar.close * 0.5, 10);
    expect(row.adjFactor).toBeCloseTo(0.5, 10);
  });

  it("returns the CSV unchanged when no action applies", () => {
    const row = backfillRowValues(csvBar, [], basisDate);

    expect(row.close).toBe(csvBar.close);
    expect(row.adjClose).toBe(csvBar.close);
    expect(row.adjFactor).toBe(1);
  });

  it("throws for an action that is not applied", () => {
    const recorded = { ...bonusA, status: "recorded" };
    const needsRatio = { ...bonusA, status: "needs_ratio" };

    expect(() => backfillRowValues(csvBar, [recorded] as never, basisDate)).toThrow("only applied actions");
    expect(() => backfillRowValues(csvBar, [needsRatio] as never, basisDate)).toThrow("only applied actions");
  });
});
