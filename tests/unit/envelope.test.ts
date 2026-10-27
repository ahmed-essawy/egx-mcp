import { describe, expect, it } from "vitest";
import { fail, ok, toCairoIso, type Meta } from "../../src/mcp/envelope";

const EXPECTED_NOTICE = "Delayed, unofficial data for information only. Not investment advice.";
const RETRY_AT = "2026-10-25T11:30:00+03:00";

const META: Meta = {
  label: "delayed",
  dataTime: "2026-10-25T11:30:00+03:00",
  source: "tradingview",
  stale: false,
  staleReason: null,
  session: { date: "2026-10-25", status: "open" },
  notAvailable: [],
};

function parseSingleText(content: readonly { type: string; text?: string }[]): unknown {
  expect(content).toHaveLength(1);
  expect(content[0]?.type).toBe("text");
  return JSON.parse(content[0]?.text ?? "");
}

describe("ok", () => {
  it("always includes the exact notice", () => {
    const result = ok({ quotes: [] }, META);

    expect(result.structuredContent).toMatchObject({ notice: EXPECTED_NOTICE });
  });

  it("carries data and meta unchanged", () => {
    const data = { quotes: [{ ticker: "COMI" }] };

    const result = ok(data, META);

    expect(result.structuredContent).toMatchObject({ data, meta: META });
  });

  it("is not an error result", () => {
    expect(ok({}, META).isError).toBeFalsy();
  });

  it("carries the same JSON in structuredContent and the single text item", () => {
    const result = ok({ quotes: [{ ticker: "COMI" }] }, META);

    expect(parseSingleText(result.content)).toEqual(result.structuredContent);
  });
});

describe("fail", () => {
  it("produces an error result with code, message and retryAt", () => {
    const result = fail("rate_limited", "Too many requests", RETRY_AT);

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      error: { code: "rate_limited", message: "Too many requests", retryAt: RETRY_AT },
    });
  });

  it("carries the same JSON in structuredContent and the single text item", () => {
    const result = fail("rate_limited", "Too many requests", RETRY_AT);

    expect(parseSingleText(result.content)).toEqual(result.structuredContent);
  });
});

describe("fail defaults and extra fields", () => {
  it("sets retryAt to null when omitted", () => {
    const result = fail("not_found", "No such symbol");

    expect(result.structuredContent).toEqual({
      error: { code: "not_found", message: "No such symbol", retryAt: null },
    });
  });

  it("never lets extra replace code, message or retryAt", () => {
    const result = fail("not_found", "No such symbol", RETRY_AT, {
      code: "forbidden",
      message: "other",
      retryAt: "x",
      hint: "try search",
    });

    expect(result.structuredContent).toEqual({
      error: { code: "not_found", message: "No such symbol", retryAt: RETRY_AT, hint: "try search" },
    });
  });
});

describe("toCairoIso", () => {
  it("uses +03:00 during summer time", () => {
    expect(toCairoIso(1793001300)).toBe("2026-10-26T10:55:00+03:00");
    expect(toCairoIso(1776988800)).toBe("2026-04-24T03:00:00+03:00");
  });

  it("uses +02:00 after summer time ends", () => {
    expect(toCairoIso(1793520000)).toBe("2026-11-01T10:00:00+02:00");
  });
});
