import { describe, expect, it } from "vitest";
import { dividendYield, pb, pe } from "../../src/domain/ratios";

const PRICE = 80;
const EPS = 8;
const EQUITY = 5_000_000;
const SHARES = 100_000;
const DIVIDENDS_365 = 4;
const EGP = "EGP";
const USD = "USD";
function egp(price: number | null) {
  return { price, currency: EGP };
}

const MISMATCH_REASON = "figure currency USD differs from price currency EGP";

describe("pe", () => {
  it("divides price by trailing EPS and returns the inputs", () => {
    expect(pe(egp(PRICE), EPS, EGP)).toEqual({ value: 10, inputs: { price: PRICE, eps: EPS } });
  });

  it("is not computable when price is missing", () => {
    expect(pe(egp(null), EPS, EGP)).toEqual({ status: "not_computable", reason: "price is missing" });
  });

  it("is not computable when EPS is missing", () => {
    expect(pe(egp(PRICE), null, EGP)).toEqual({ status: "not_computable", reason: "EPS is missing" });
  });

  it("is not computable when EPS is zero", () => {
    expect(pe(egp(PRICE), 0, EGP)).toEqual({ status: "not_computable", reason: "EPS is not positive" });
  });

  it("is not computable when EPS is negative", () => {
    expect(pe(egp(PRICE), -2, EGP)).toEqual({ status: "not_computable", reason: "EPS is not positive" });
  });
});

describe("pe currency", () => {
  it("is not computable when the EPS currency differs from the price currency", () => {
    expect(pe(egp(PRICE), EPS, USD)).toEqual({ status: "not_computable", reason: MISMATCH_REASON });
  });
});

describe("pb", () => {
  it("divides price by book value per share and returns the inputs", () => {
    expect(pb(egp(PRICE), EQUITY, SHARES, EGP)).toEqual({
      value: 1.6,
      inputs: { price: PRICE, equity: EQUITY, shares: SHARES },
    });
  });

  it("is not computable when price is missing", () => {
    expect(pb(egp(null), EQUITY, SHARES, EGP)).toEqual({ status: "not_computable", reason: "price is missing" });
  });

  it("is not computable when equity is missing", () => {
    expect(pb(egp(PRICE), null, SHARES, EGP)).toEqual({ status: "not_computable", reason: "total equity is missing" });
  });

  it("is not computable when shares outstanding is missing", () => {
    expect(pb(egp(PRICE), EQUITY, null, EGP)).toEqual({ status: "not_computable", reason: "shares outstanding is missing" });
  });

  it("is not computable when shares outstanding is zero", () => {
    expect(pb(egp(PRICE), EQUITY, 0, EGP)).toEqual({
      status: "not_computable",
      reason: "shares outstanding is not positive",
    });
  });

  it("is not computable when equity is zero or negative", () => {
    const expected = { status: "not_computable", reason: "total equity is not positive" };
    expect(pb(egp(PRICE), 0, SHARES, EGP)).toEqual(expected);
    expect(pb(egp(PRICE), -1, SHARES, EGP)).toEqual(expected);
  });
});

describe("pb currency", () => {
  it("is not computable when the equity currency differs from the price currency", () => {
    expect(pb(egp(PRICE), EQUITY, SHARES, USD)).toEqual({ status: "not_computable", reason: MISMATCH_REASON });
  });
});

describe("dividendYield", () => {
  it("divides the trailing 365 day cash dividends by price and returns the inputs", () => {
    expect(dividendYield(PRICE, DIVIDENDS_365, 0)).toEqual({
      value: 0.05,
      inputs: { price: PRICE, dividends365: DIVIDENDS_365 },
    });
  });

  it("is zero when no dividends were paid", () => {
    expect(dividendYield(PRICE, 0, 0)).toEqual({ value: 0, inputs: { price: PRICE, dividends365: 0 } });
  });

  it("is not computable when price is missing", () => {
    expect(dividendYield(null, DIVIDENDS_365, 0)).toEqual({ status: "not_computable", reason: "price is missing" });
  });

  it("is not computable when price is zero", () => {
    expect(dividendYield(0, DIVIDENDS_365, 0)).toEqual({ status: "not_computable", reason: "price is not positive" });
  });

  it("is not computable when dividends are missing", () => {
    expect(dividendYield(PRICE, null, 0)).toEqual({ status: "not_computable", reason: "dividends are missing" });
  });
});

describe("ratios in a non EGP quote currency", () => {
  const usdPrice = { price: PRICE, currency: USD };

  it("computes P/E and P/B from figures in the quote currency", () => {
    expect(pe(usdPrice, EPS, USD)).toEqual({ value: 10, inputs: { price: PRICE, eps: EPS } });
    expect(pb(usdPrice, EQUITY, SHARES, USD)).toEqual({
      value: 1.6,
      inputs: { price: PRICE, equity: EQUITY, shares: SHARES },
    });
  });

  it("is not computable from a figure in another currency than the quote currency", () => {
    const reason = "figure currency EGP differs from price currency USD";
    expect(pe(usdPrice, EPS, EGP)).toEqual({ status: "not_computable", reason });
    expect(pb(usdPrice, EQUITY, SHARES, EGP)).toEqual({ status: "not_computable", reason });
  });
});

describe("dividendYield with unpriced dividends", () => {
  it("is not computable when a cash dividend in the window has no amount", () => {
    expect(dividendYield(PRICE, DIVIDENDS_365, 1)).toEqual({
      status: "not_computable",
      reason: "1 cash dividend(s) in the last 365 days have no amount yet",
    });
  });
});
