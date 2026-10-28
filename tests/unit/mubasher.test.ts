import { afterEach, describe, expect, it, vi } from "vitest";
import { mubasherFunds, parseArabicDate } from "../../src/providers/mubasher";
import mubasherFundsPage from "../fixtures/mubasher-funds-p1.json";

const MONTH_CASES: ReadonlyArray<readonly [string, string]> = [
  ["5 يناير 2026", "2026-01-05"],
  ["14 فبراير 2026", "2026-02-14"],
  ["1 مارس 2026", "2026-03-01"],
  ["30 أبريل 2026", "2026-04-30"],
  ["9 مايو 2026", "2026-05-09"],
  ["12 يونيو 2026", "2026-06-12"],
  ["31 يوليو 2026", "2026-07-31"],
  ["2 أغسطس 2026", "2026-08-02"],
  ["18 سبتمبر 2026", "2026-09-18"],
  ["21 أكتوبر 2026", "2026-10-21"],
  ["3 نوفمبر 2026", "2026-11-03"],
  ["25 ديسمبر 2026", "2026-12-25"],
];

const FIRST_FUND_ID = 6401;
const SECOND_FUND_ID = 6146;
const VALID_NAV = 1.27;

function stubFundsPage(prices: Record<number, number>): void {
  const rows = mubasherFundsPage.rows.map((row) => ({ ...row, price: prices[row.fundId] ?? row.price }));
  const body = { rows, numberOfPages: 1 };
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json(body)));
}

describe("parseArabicDate", () => {
  it.each(MONTH_CASES)("parses %s", (text, expected) => {
    expect(parseArabicDate(text)).toBe(expected);
  });

  it("returns null for an unknown month", () => {
    expect(parseArabicDate("21 octobre 2026")).toBeNull();
  });

  it("returns null for an impossible day", () => {
    expect(parseArabicDate("31 فبراير 2026")).toBeNull();
  });

  it("returns null for text that is not a date", () => {
    expect(parseArabicDate("")).toBeNull();
    expect(parseArabicDate("أكتوبر 2026")).toBeNull();
  });
});

describe("mubasherFunds.fetchFunds", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("skips rows whose NAV is zero or negative and keeps the rest", async () => {
    stubFundsPage({ [FIRST_FUND_ID]: VALID_NAV, [SECOND_FUND_ID]: 0 });

    const { funds } = await mubasherFunds.fetchFunds();
    const ids = funds.map((fund) => fund.sourceId);

    expect(ids).toContain(`mubasher:${FIRST_FUND_ID}`);
    expect(ids).not.toContain(`mubasher:${SECOND_FUND_ID}`);
    expect(funds).toHaveLength(mubasherFundsPage.rows.length - 1);
  });

  it("skips rows with a negative NAV", async () => {
    stubFundsPage({ [SECOND_FUND_ID]: -1 });

    const { funds } = await mubasherFunds.fetchFunds();

    expect(funds.map((fund) => fund.sourceId)).not.toContain(`mubasher:${SECOND_FUND_ID}`);
  });
});
