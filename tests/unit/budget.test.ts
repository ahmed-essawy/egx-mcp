import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config";
import {
  ACCOUNTING_ROWS_PER_CALL,
  backfillAllowance,
  D1_DAILY_ROWS_WRITTEN,
  D1_WRITE_HEADROOM,
  JOBS_D1_ROWS_RESERVE,
  type BackfillAllowanceInput,
} from "../../src/domain/budget";
import { varsOfWrangler } from "../helpers/node-mcp";

const MAX_GLOBAL_DAILY_CALLS = 33_000;

const DEFAULTS: BackfillAllowanceInput = {
  configured: 36_000,
  globalDailyCalls: 15_000,
  rowsPerCall: 2,
  callsToday: 0,
  adjustCap: 10_000,
  adjustRowsToday: 0,
  personalCap: 5_000,
  personalRowsToday: 0,
  backfillRowsToday: 0,
};

function envWith(overrides: Record<string, string> = {}): Env {
  return { ...varsOfWrangler(), ...overrides } as unknown as Env;
}

function allowance(overrides: Partial<BackfillAllowanceInput>): number {
  return backfillAllowance({ ...DEFAULTS, ...overrides });
}

describe("backfillAllowance", () => {
  it("gives the configured rows at the defaults", () => {
    expect(allowance({})).toBe(36_000);
  });

  it("subtracts the rows already used today", () => {
    expect(allowance({ backfillRowsToday: 30_000 })).toBe(6_000);
  });

  it("keeps the rest of the day reserved for calls", () => {
    expect(allowance({ callsToday: 9_000 })).toBe(36_000);
  });

  it("is bounded by the configured rows when the cap is lowered", () => {
    expect(allowance({ globalDailyCalls: 5_000, callsToday: 9_000 })).toBe(36_000);
  });

  it("shrinks with 3 rows per call and a cap of 12,000 calls", () => {
    expect(allowance({ rowsPerCall: 3, globalDailyCalls: 12_000 })).toBe(30_000);
  });

  it("reserves the actual adjust rows once they pass the cap", () => {
    expect(allowance({ adjustRowsToday: 12_000 })).toBe(34_000);
  });

  it("reserves the actual personal rows once they pass the cap", () => {
    expect(allowance({ personalRowsToday: 6_000 })).toBe(35_000);
  });

  it("is never negative", () => {
    expect(allowance({ callsToday: 90_000, backfillRowsToday: 50_000 })).toBe(0);
  });

  it("splits the 100,000 daily rows exactly at the configured defaults", () => {
    const config = loadConfig(envWith());
    const reserves =
      ACCOUNTING_ROWS_PER_CALL * config.globalDailyCalls +
      config.adjustMaxRowsPerDay +
      config.personalDailyRows +
      JOBS_D1_ROWS_RESERVE +
      D1_WRITE_HEADROOM +
      config.backfillMaxRowsPerDay;
    expect(reserves).toBe(D1_DAILY_ROWS_WRITTEN);
  });
});

describe("loadConfig rows written budget", () => {
  it("accepts GLOBAL_DAILY_CALLS 33,000", () => {
    expect(loadConfig(envWith({ GLOBAL_DAILY_CALLS: String(MAX_GLOBAL_DAILY_CALLS) })).globalDailyCalls).toBe(
      MAX_GLOBAL_DAILY_CALLS,
    );
  });

  it("throws for GLOBAL_DAILY_CALLS 33,001", () => {
    expect(() => loadConfig(envWith({ GLOBAL_DAILY_CALLS: String(MAX_GLOBAL_DAILY_CALLS + 1) }))).toThrow(
      "invalid config: rows written budget",
    );
  });
});
