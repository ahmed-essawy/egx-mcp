import { describe, expect, it } from "vitest";
import { anchorDate, median, periodReturn, realReturn, shiftMonths } from "../../src/domain/returns";

const TODAY = "2026-10-25";
const PRECISION = 10;

describe("periodReturn", () => {
  it("returns the fractional gain from first to last", () => {
    expect(periodReturn(100, 110)).toBeCloseTo(0.1, PRECISION);
  });

  it("returns a negative fraction for a loss", () => {
    expect(periodReturn(200, 150)).toBeCloseTo(-0.25, PRECISION);
  });

  it("returns zero when the price is unchanged", () => {
    expect(periodReturn(50, 50)).toBe(0);
  });
});

describe("anchorDate", () => {
  it("anchors one day back", () => {
    expect(anchorDate("1d", TODAY)).toBe("2026-10-24");
  });

  it("anchors one week back", () => {
    expect(anchorDate("1w", TODAY)).toBe("2026-10-18");
  });

  it("anchors one month back", () => {
    expect(anchorDate("1m", TODAY)).toBe("2026-09-25");
  });

  it("anchors three months back", () => {
    expect(anchorDate("3m", TODAY)).toBe("2026-07-25");
  });

  it("anchors one year back", () => {
    expect(anchorDate("1y", TODAY)).toBe("2025-10-25");
  });

  it("anchors year to date at the last day of the previous year", () => {
    expect(anchorDate("ytd", TODAY)).toBe("2025-12-31");
  });

  it("crosses a year boundary going back three months", () => {
    expect(anchorDate("3m", "2026-02-10")).toBe("2025-11-10");
  });

  it("crosses a year boundary going back one week", () => {
    expect(anchorDate("1w", "2026-01-03")).toBe("2025-12-27");
  });
});

describe("shiftMonths", () => {
  it("clamps to the last day of a shorter month going forward", () => {
    expect(shiftMonths("2020-02-29", 60)).toBe("2025-02-28");
  });

  it("clamps to the last day of a shorter month going back", () => {
    expect(shiftMonths("2026-03-31", -1)).toBe("2026-02-28");
  });
});

describe("realReturn", () => {
  it("deflates the nominal return by cumulative inflation", () => {
    const nominal = 0.2;
    const cpiStart = 100;
    const cpiEnd = 110;
    const expected = (1 + nominal) / (cpiEnd / cpiStart) - 1;

    expect(realReturn(nominal, cpiStart, cpiEnd)).toBeCloseTo(expected, PRECISION);
  });

  it("equals the nominal return when prices are flat", () => {
    expect(realReturn(0.05, 120, 120)).toBeCloseTo(0.05, PRECISION);
  });

  it("is negative when inflation exceeds the nominal return", () => {
    expect(realReturn(0.05, 100, 120)).toBeLessThan(0);
  });
});

describe("median", () => {
  it("returns the middle value of an odd list", () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it("returns the mean of the two middle values of an even list", () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("returns the only value of a single item list", () => {
    expect(median([7])).toBe(7);
  });

  it("does not reorder the input", () => {
    const values = [3, 1, 2];
    median(values);

    expect(values).toEqual([3, 1, 2]);
  });
});
