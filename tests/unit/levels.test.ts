import { describe, expect, it } from "vitest";
import { evaluateLevels } from "../../src/domain/levels";
import type { PriceLevelRow } from "../../src/domain/levels";

const NOW = 1_793_000_000;
const EARLIER_CROSSING = 1_792_000_000;

const COMI_ISIN = "EGS60121C018";
const SUSPENDED_ISIN = "EGS38201C015";
const UNPRICED_ISIN = "EGS70321C012";

const LEVEL = 100;
const PRICE_ABOVE_LEVEL = 105;
const PRICE_BELOW_LEVEL = 95;

function levelRow(overrides: Partial<PriceLevelRow>): PriceLevelRow {
  return {
    id: 1,
    isin: COMI_ISIN,
    direction: "below",
    level: LEVEL,
    armed: 1,
    lastCrossedAt: null,
    ...overrides,
  };
}

function pricesOf(isin: string, price: number): ReadonlyMap<string, number> {
  return new Map([[isin, price]]);
}

describe("evaluateLevels with a below level", () => {
  it("crosses when the price is under the level and reports it once", () => {
    const result = evaluateLevels([levelRow({})], pricesOf(COMI_ISIN, PRICE_BELOW_LEVEL), NOW);

    expect(result.crossed).toEqual([
      { id: 1, isin: COMI_ISIN, direction: "below", level: LEVEL, lastCrossedAt: NOW },
    ]);
    expect(result.changes).toEqual([{ id: 1, isin: COMI_ISIN, direction: "below", level: LEVEL, armed: 0, lastCrossedAt: NOW }]);
  });

  it("crosses when the price equals the level", () => {
    const result = evaluateLevels([levelRow({})], pricesOf(COMI_ISIN, LEVEL), NOW);

    expect(result.crossed).toHaveLength(1);
  });

  it("does not cross while the price is above the level", () => {
    const result = evaluateLevels([levelRow({})], pricesOf(COMI_ISIN, PRICE_ABOVE_LEVEL), NOW);

    expect(result).toEqual({ crossed: [], changes: [] });
  });

  it("does not report a crossed level again while the price stays at or below it", () => {
    const crossed = levelRow({ armed: 0, lastCrossedAt: EARLIER_CROSSING });

    const result = evaluateLevels([crossed], pricesOf(COMI_ISIN, PRICE_BELOW_LEVEL), NOW);

    expect(result).toEqual({ crossed: [], changes: [] });
  });

  it("does not re-arm while the price equals the level", () => {
    const crossed = levelRow({ armed: 0, lastCrossedAt: EARLIER_CROSSING });

    const result = evaluateLevels([crossed], pricesOf(COMI_ISIN, LEVEL), NOW);

    expect(result).toEqual({ crossed: [], changes: [] });
  });

  it("re-arms without reporting when the price goes back above the level", () => {
    const crossed = levelRow({ armed: 0, lastCrossedAt: EARLIER_CROSSING });

    const result = evaluateLevels([crossed], pricesOf(COMI_ISIN, PRICE_ABOVE_LEVEL), NOW);

    expect(result.crossed).toEqual([]);
    expect(result.changes).toEqual([
      { id: 1, isin: COMI_ISIN, direction: "below", level: LEVEL, armed: 1, lastCrossedAt: EARLIER_CROSSING },
    ]);
  });

  it("crosses again after it was re-armed", () => {
    const rearmed = levelRow({ armed: 1, lastCrossedAt: EARLIER_CROSSING });

    const result = evaluateLevels([rearmed], pricesOf(COMI_ISIN, PRICE_BELOW_LEVEL), NOW);

    expect(result.crossed).toHaveLength(1);
    expect(result.changes).toEqual([{ id: 1, isin: COMI_ISIN, direction: "below", level: LEVEL, armed: 0, lastCrossedAt: NOW }]);
  });
});

describe("evaluateLevels with an above level", () => {
  const aboveLevel = levelRow({ direction: "above" });

  it("crosses when the price is over the level and reports it once", () => {
    const result = evaluateLevels([aboveLevel], pricesOf(COMI_ISIN, PRICE_ABOVE_LEVEL), NOW);

    expect(result.crossed).toEqual([
      { id: 1, isin: COMI_ISIN, direction: "above", level: LEVEL, lastCrossedAt: NOW },
    ]);
    expect(result.changes).toEqual([{ id: 1, isin: COMI_ISIN, direction: "above", level: LEVEL, armed: 0, lastCrossedAt: NOW }]);
  });

  it("crosses when the price equals the level", () => {
    const result = evaluateLevels([aboveLevel], pricesOf(COMI_ISIN, LEVEL), NOW);

    expect(result.crossed).toHaveLength(1);
  });

  it("does not cross while the price is under the level", () => {
    const result = evaluateLevels([aboveLevel], pricesOf(COMI_ISIN, PRICE_BELOW_LEVEL), NOW);

    expect(result).toEqual({ crossed: [], changes: [] });
  });

  it("does not report a crossed level again while the price stays at or above it", () => {
    const crossed = levelRow({ direction: "above", armed: 0, lastCrossedAt: EARLIER_CROSSING });

    const result = evaluateLevels([crossed], pricesOf(COMI_ISIN, PRICE_ABOVE_LEVEL), NOW);

    expect(result).toEqual({ crossed: [], changes: [] });
  });

  it("does not re-arm while the price equals the level", () => {
    const crossed = levelRow({ direction: "above", armed: 0, lastCrossedAt: EARLIER_CROSSING });

    const result = evaluateLevels([crossed], pricesOf(COMI_ISIN, LEVEL), NOW);

    expect(result).toEqual({ crossed: [], changes: [] });
  });

  it("re-arms without reporting when the price goes back under the level", () => {
    const crossed = levelRow({ direction: "above", armed: 0, lastCrossedAt: EARLIER_CROSSING });

    const result = evaluateLevels([crossed], pricesOf(COMI_ISIN, PRICE_BELOW_LEVEL), NOW);

    expect(result.crossed).toEqual([]);
    expect(result.changes).toEqual([{ id: 1, isin: COMI_ISIN, direction: "above", level: LEVEL, armed: 1, lastCrossedAt: EARLIER_CROSSING }]);
  });
});

describe("evaluateLevels across several levels", () => {
  it("evaluates a level on the last known price of an inactive symbol", () => {
    const suspended = levelRow({ id: 2, isin: SUSPENDED_ISIN, direction: "above" });

    const result = evaluateLevels([suspended], pricesOf(SUSPENDED_ISIN, PRICE_ABOVE_LEVEL), NOW);

    expect(result.crossed).toEqual([
      { id: 2, isin: SUSPENDED_ISIN, direction: "above", level: LEVEL, lastCrossedAt: NOW },
    ]);
  });

  it("leaves a level untouched when its symbol has no known price", () => {
    const unpriced = levelRow({ id: 3, isin: UNPRICED_ISIN });

    const result = evaluateLevels([unpriced], pricesOf(COMI_ISIN, PRICE_BELOW_LEVEL), NOW);

    expect(result).toEqual({ crossed: [], changes: [] });
  });

  it("reports only the levels that changed state", () => {
    const levels = [
      levelRow({ id: 1, direction: "below" }),
      levelRow({ id: 2, direction: "above" }),
      levelRow({ id: 3, direction: "above", armed: 0, lastCrossedAt: EARLIER_CROSSING }),
    ];

    const result = evaluateLevels(levels, pricesOf(COMI_ISIN, PRICE_BELOW_LEVEL), NOW);

    expect(result.crossed.map((item) => item.id)).toEqual([1]);
    expect(result.changes).toEqual([
      { id: 1, isin: COMI_ISIN, direction: "below", level: LEVEL, armed: 0, lastCrossedAt: NOW },
      { id: 3, isin: COMI_ISIN, direction: "above", level: LEVEL, armed: 1, lastCrossedAt: EARLIER_CROSSING },
    ]);
  });
});
