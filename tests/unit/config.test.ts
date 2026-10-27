import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { loadConfig, parseOrigin } from "../../src/config";

function envWith(overrides: Partial<Record<keyof Env, string>> = {}): Env {
  return { ...env, ...overrides } as unknown as Env;
}

describe("loadConfig", () => {
  it("parses the defaults from wrangler.jsonc", () => {
    const config = loadConfig(envWith());

    expect(config).toEqual({
      globalDailyCalls: 15000,
      globalDailyRowsRead: 3500000,
      oauthDailyKvWrites: 600,
      userDailyCalls: 100,
      ownerEmails: new Set(),
      unlimitedEmails: new Set(),
      stockProviders: ["egx", "tradingview"],
      snapshotEveryMinutes: 1,
      backfillMaxRowsPerDay: 36000,
      adjustMaxRowsPerDay: 10000,
      adjustMaxActionsPerRun: 2,
      personalDailyRows: 5000,
      publicOrigin: "",
    });
  });

  it("lowercases and trims comma-separated email lists", () => {
    const config = loadConfig(
      envWith({ OWNER_EMAILS: "A@x.com, b@y.com ", UNLIMITED_EMAILS: " C@z.com" }),
    );

    expect(config.ownerEmails).toEqual(new Set(["a@x.com", "b@y.com"]));
    expect(config.unlimitedEmails).toEqual(new Set(["c@z.com"]));
  });

  it("accepts a snapshot interval of 2 minutes", () => {
    expect(loadConfig(envWith({ SNAPSHOT_EVERY_MINUTES: "2" })).snapshotEveryMinutes).toBe(2);
  });

  it("rejects a snapshot interval other than 1 or 2", () => {
    expect(() => loadConfig(envWith({ SNAPSHOT_EVERY_MINUTES: "3" }))).toThrow(
      "invalid config: SNAPSHOT_EVERY_MINUTES",
    );
  });

  it("rejects an unknown stock provider id", () => {
    expect(() => loadConfig(envWith({ STOCK_PROVIDERS: "egx,bloomberg" }))).toThrow(
      "invalid config: STOCK_PROVIDERS",
    );
  });

  it.each(["", "egx,egx"])("rejects STOCK_PROVIDERS=%j when empty or duplicated", (providers) => {
    expect(() => loadConfig(envWith({ STOCK_PROVIDERS: providers }))).toThrow(
      "invalid config: STOCK_PROVIDERS",
    );
  });

  it("rejects a non-integer GLOBAL_DAILY_CALLS", () => {
    expect(() => loadConfig(envWith({ GLOBAL_DAILY_CALLS: "15,000" }))).toThrow(
      "invalid config: GLOBAL_DAILY_CALLS",
    );
  });

  it("rejects a negative PERSONAL_DAILY_ROWS", () => {
    expect(() => loadConfig(envWith({ PERSONAL_DAILY_ROWS: "-1" }))).toThrow(
      "invalid config: PERSONAL_DAILY_ROWS",
    );
  });

  it("accepts the largest call cap that fits the rows written budget", () => {
    expect(loadConfig(envWith({ GLOBAL_DAILY_CALLS: "33000" })).globalDailyCalls).toBe(33000);
  });

  it.each(["33001", "35000"])("rejects GLOBAL_DAILY_CALLS=%s over the rows written budget", (calls) => {
    expect(() => loadConfig(envWith({ GLOBAL_DAILY_CALLS: calls }))).toThrow(
      "invalid config: rows written budget",
    );
  });

  it("rejects ADJUST_MAX_ROWS_PER_DAY below 1500", () => {
    expect(() => loadConfig(envWith({ ADJUST_MAX_ROWS_PER_DAY: "1499" }))).toThrow(
      "invalid config: ADJUST_MAX_ROWS_PER_DAY",
    );
  });

  it("accepts ADJUST_MAX_ROWS_PER_DAY of 1500", () => {
    expect(loadConfig(envWith({ ADJUST_MAX_ROWS_PER_DAY: "1500" })).adjustMaxRowsPerDay).toBe(1500);
  });

  it.each(["0", "3"])("rejects ADJUST_MAX_ACTIONS_PER_RUN=%s outside 1..2", (actions) => {
    expect(() => loadConfig(envWith({ ADJUST_MAX_ACTIONS_PER_RUN: actions }))).toThrow(
      "invalid config: ADJUST_MAX_ACTIONS_PER_RUN",
    );
  });

  it("memoizes the result per env object", () => {
    const sameEnv = envWith();

    expect(loadConfig(sameEnv)).toBe(loadConfig(sameEnv));
  });
});

describe("parseOrigin", () => {
  it.each([
    ["https://egx.example.com", "https://egx.example.com"],
    ["https://egx.example.com/path?x=1", "https://egx.example.com"],
    ["http://localhost:8787", "http://localhost:8787"],
  ])("returns the origin of %s", (value, expected) => {
    expect(parseOrigin(value)).toBe(expected);
  });

  it.each([[""], ["not a url"], ["localhost:8787"], ["ftp://egx.example.com"]])("rejects %j", (value) => {
    expect(parseOrigin(value)).toBeNull();
  });
});
