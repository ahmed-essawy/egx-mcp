import { describe, expect, it } from "vitest";
import { roundIndex, roundPercent, roundPrice, roundTurnover } from "../../src/mcp/rounding";

const NOISY_CHANGE = -0.8999999999999915;
const NOISY_PERCENT = -0.7332113021428013;
const NOISY_VALUE = 293871.17346267996;
const NOISY_INDEX = 50010.200000000004;

describe("rounding", () => {
  it("rounds a price or change to four decimals", () => {
    expect(roundPrice(NOISY_CHANGE)).toBe(-0.9);
    expect(roundPrice(0.037)).toBe(0.037);
    expect(roundPrice(122.03)).toBe(122.03);
  });

  it("rounds a percent to two decimals", () => {
    expect(roundPercent(NOISY_PERCENT)).toBe(-0.73);
  });

  it("rounds a traded value to two decimals", () => {
    expect(roundTurnover(NOISY_VALUE)).toBe(293871.17);
  });

  it("rounds an index value to two decimals", () => {
    expect(roundIndex(NOISY_INDEX)).toBe(50010.2);
  });

  it("keeps null as null", () => {
    expect(roundPrice(null)).toBeNull();
    expect(roundPercent(null)).toBeNull();
    expect(roundTurnover(null)).toBeNull();
  });
});
