import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import type { Config } from "../../src/config";
import { guardOauth, guardOauthEntry, oauthWriteCost } from "../../src/limits/oauth-guard";
import { createSqliteD1 } from "../helpers/sqlite-d1";

const ORIGIN = "https://egx.example";
const NOW = 1_792_000_000;
const DAY = "2026-10-14";
const SECONDS_TO_MIDNIGHT = 86_400 - (NOW % 86_400);
const CAP = 6;
const CALLER_LIMIT = 3;
const CALLER_IP = "203.0.113.7";
const RATE_LIMITED_MESSAGE = "Too many sign-in attempts from this address. Try again in a minute.";

function req(method: string, path: string, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${path}`, { method, headers });
}

function limiterPerKey(limit: number): { limit: (options: { key: string }) => Promise<{ success: boolean }> } {
  const seen = new Map<string, number>();
  return {
    limit: async ({ key }) => {
      const count = (seen.get(key) ?? 0) + 1;
      seen.set(key, count);
      return { success: count <= limit };
    },
  };
}

describe("oauth guard", () => {
  let env: Env;
  let sqlite: DatabaseSync;
  const cfg = { oauthDailyKvWrites: CAP } as Config;

  beforeEach(() => {
    const created = createSqliteD1();
    sqlite = created.sqlite;
    env = { DB: created.db } as Env;
  });

  function counter(): number | undefined {
    const row = sqlite.prepare("SELECT oauth_kv_writes AS n FROM usage_global WHERE day = ?1").get(DAY) as
      | { n: number }
      | undefined;
    return row?.n;
  }

  describe("oauthWriteCost", () => {
    it.each([
      ["POST", "/register", 1],
      ["GET", "/authorize", 1],
      ["POST", "/authorize", 1],
      ["GET", "/callback/google", 1],
      ["POST", "/token", 2],
      ["GET", "/", 0],
      ["POST", "/mcp", 0],
      ["GET", "/token", 0],
      ["GET", "/register", 0],
      ["GET", "/dashboard", 0],
    ])("charges %s %s as %i", (method, path, cost) => {
      expect(oauthWriteCost(req(method, path))).toBe(cost);
    });
  });

  describe("guardOauth", () => {
    it("returns null for a free route and touches no row", async () => {
      expect(await guardOauth(env, cfg, req("GET", "/"), NOW)).toBeNull();
      expect(counter()).toBeUndefined();
    });

    it("charges a full first sign-in as 6 writes", async () => {
      for (const [method, path] of [
        ["POST", "/register"],
        ["GET", "/authorize"],
        ["POST", "/authorize"],
        ["GET", "/callback/google"],
        ["POST", "/token"],
      ]) {
        expect(await guardOauth(env, cfg, req(method!, path!), NOW)).toBeNull();
      }

      expect(counter()).toBe(CAP);
    });

    async function fillToCap(): Promise<void> {
      for (let i = 0; i < CAP; i += 1) await guardOauth(env, cfg, req("GET", "/authorize"), NOW);
    }

    it.each([
      ["GET", "/authorize"],
      ["POST", "/authorize"],
      ["GET", "/callback/google"],
    ])("refuses %s %s at the cap with an HTML 503 and Retry-After, leaving the counter unchanged", async (method, path) => {
      await fillToCap();

      const response = await guardOauth(env, cfg, req(method, path), NOW);

      expect(response?.status).toBe(503);
      expect(response?.headers.get("retry-after")).toBe(String(SECONDS_TO_MIDNIGHT));
      expect(response?.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(await response?.text()).toContain("Sign-in is at capacity for today. Try again after 00:00 UTC.");
      expect(counter()).toBe(CAP);
    });

    it.each([
      ["POST", "/token"],
      ["POST", "/register"],
    ])("refuses %s %s at the cap with a JSON 503 and Retry-After", async (method, path) => {
      await fillToCap();

      const response = await guardOauth(env, cfg, req(method, path), NOW);

      expect(response?.status).toBe(503);
      expect(response?.headers.get("retry-after")).toBe(String(SECONDS_TO_MIDNIGHT));
      expect(response?.headers.get("content-type")).toBe("application/json");
      expect(await response?.json()).toEqual({
        error: "temporarily_unavailable",
        error_description: "Sign-in is at capacity for today. Try again after 00:00 UTC.",
      });
      expect(counter()).toBe(CAP);
    });

    it("refuses a cost that would pass the cap and admits a smaller one", async () => {
      for (let i = 0; i < 5; i += 1) await guardOauth(env, cfg, req("GET", "/authorize"), NOW);

      expect((await guardOauth(env, cfg, req("POST", "/token"), NOW))?.status).toBe(503);
      expect(counter()).toBe(5);
      expect(await guardOauth(env, cfg, req("POST", "/register"), NOW)).toBeNull();
      expect(counter()).toBe(CAP);
    });

    it("refuses a cost above the cap on a fresh day", async () => {
      const response = await guardOauth(env, { oauthDailyKvWrites: 1 } as Config, req("POST", "/token"), NOW);

      expect(response?.status).toBe(503);
      expect(counter()).toBeUndefined();
    });

    it("starts a new count on the next day", async () => {
      for (let i = 0; i < CAP; i += 1) await guardOauth(env, cfg, req("GET", "/authorize"), NOW);

      expect(await guardOauth(env, cfg, req("GET", "/authorize"), NOW + 86_400)).toBeNull();
    });
  });

  describe("guardOauthEntry", () => {
    beforeEach(() => {
      env = { ...env, RATE_LIMITER: limiterPerKey(CALLER_LIMIT) } as Env;
    });

    it("charges POST /token 2 and POST /register 1 up front", async () => {
      expect(await guardOauthEntry(env, cfg, req("POST", "/token"), NOW)).toBeNull();
      expect(await guardOauthEntry(env, cfg, req("POST", "/register", { "cf-connecting-ip": "198.51.100.1" }), NOW)).toBeNull();

      expect(counter()).toBe(3);
    });

    it.each([
      ["GET", "/authorize"],
      ["POST", "/authorize"],
      ["GET", "/callback/google"],
    ])("leaves the charge of %s %s to the handler", async (method, path) => {
      expect(await guardOauthEntry(env, cfg, req(method, path), NOW)).toBeNull();

      expect(counter()).toBeUndefined();
    });

    it("does not touch the limiter or the counter for an unguarded route", async () => {
      expect(await guardOauthEntry(env, cfg, req("GET", "/"), NOW)).toBeNull();
      expect(await guardOauthEntry(env, cfg, req("POST", "/mcp"), NOW)).toBeNull();

      expect(counter()).toBeUndefined();
    });

    it("refuses a flood from one IP with an HTML 429 without charging", async () => {
      for (let i = 0; i < CALLER_LIMIT; i += 1) {
        expect(await guardOauthEntry(env, cfg, req("GET", "/authorize", { "cf-connecting-ip": CALLER_IP }), NOW)).toBeNull();
      }

      const response = await guardOauthEntry(env, cfg, req("GET", "/authorize", { "cf-connecting-ip": CALLER_IP }), NOW);

      expect(response?.status).toBe(429);
      expect(response?.headers.get("retry-after")).toBe("60");
      expect(response?.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(await response?.text()).toContain(RATE_LIMITED_MESSAGE);
      expect(counter()).toBeUndefined();
    });

    it.each([
      ["POST", "/token"],
      ["POST", "/register"],
    ])("refuses a flood of %s %s from one IP with a JSON 429 without charging", async (method, path) => {
      const headers = { "cf-connecting-ip": CALLER_IP };
      for (let i = 0; i < CALLER_LIMIT; i += 1) await guardOauthEntry(env, cfg, req(method, path, headers), NOW);
      const chargedBefore = counter();

      const response = await guardOauthEntry(env, cfg, req(method, path, headers), NOW);

      expect(response?.status).toBe(429);
      expect(response?.headers.get("content-type")).toBe("application/json");
      expect(await response?.json()).toEqual({ error: "temporarily_unavailable", error_description: RATE_LIMITED_MESSAGE });
      expect(counter()).toBe(chargedBefore);
    });

    it("keeps another IP unaffected by a flooding one", async () => {
      for (let i = 0; i <= CALLER_LIMIT; i += 1) {
        await guardOauthEntry(env, cfg, req("GET", "/authorize", { "cf-connecting-ip": CALLER_IP }), NOW);
      }

      expect(await guardOauthEntry(env, cfg, req("GET", "/authorize", { "cf-connecting-ip": "198.51.100.9" }), NOW)).toBeNull();
    });

    it("shares one bucket among requests without an IP header", async () => {
      for (let i = 0; i < CALLER_LIMIT; i += 1) await guardOauthEntry(env, cfg, req("GET", "/authorize"), NOW);

      expect((await guardOauthEntry(env, cfg, req("GET", "/authorize"), NOW))?.status).toBe(429);
    });

    it("keys the limiter by the IP with the oauth prefix", async () => {
      const keys: string[] = [];
      env = { ...env, RATE_LIMITER: { limit: async ({ key }: { key: string }) => (keys.push(key), { success: true }) } } as Env;

      await guardOauthEntry(env, cfg, req("GET", "/authorize", { "cf-connecting-ip": CALLER_IP }), NOW);
      await guardOauthEntry(env, cfg, req("GET", "/authorize"), NOW);

      expect(keys).toEqual([`oauth:${CALLER_IP}`, "oauth:unknown"]);
    });

    it("fails closed at the cap for an up-front route after the limiter passes", async () => {
      for (let i = 0; i < CAP; i += 1) await guardOauth(env, cfg, req("GET", "/authorize"), NOW);

      expect((await guardOauthEntry(env, cfg, req("POST", "/register"), NOW))?.status).toBe(503);
    });
  });
});
