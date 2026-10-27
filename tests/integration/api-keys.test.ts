import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionCookie } from "../../src/auth/session";
import { decodeBase64Url } from "../helpers/base64url";
import { cookiePair } from "../helpers/cookies";
import { clearState, restoreBindings, setBindings } from "../helpers/bindings";
import { MS_PER_SECOND } from "../helpers/time";
import { callTool, postMcp } from "../helpers/mcp";
import { seedKey, seedSnapshot, seedUser, setNow } from "../helpers/seed";

const GIVEN_NOW = Date.UTC(2026, 9, 25, 12, 0, 0) / MS_PER_SECOND;
const ORIGIN = "https://egx.test";
const SESSION_SECRET = "test-session-secret";
const USER_EMAIL = "user@example.com";
const OTHER_EMAIL = "other@example.com";
const INDICES_TOOL = "get_indices";
const MAX_ACTIVE_KEYS = 3;
const KEY_CACHE_SECONDS = 60;
const TOUCH_INTERVAL_SECONDS = 3600;
const HALF_TOUCH_INTERVAL_SECONDS = TOUCH_INTERVAL_SECONDS / 2;
const KEY_PATTERN = /egx_[A-Za-z0-9_-]{43}/;
const KEY_PREFIX = "egx_";
const KEY_PREFIX_LENGTH = 8;
const KEY_LIMIT_MESSAGE = "You already have 3 active keys. Revoke one to create another.";

type Caller = { userId: string; cookie: string; csrf: string };
type KeyRow = { id: string; prefix: string; key_hash: string; revoked_at: number | null; last_used_at: number | null };

async function signIn(email: string): Promise<Caller> {
  const userId = await seedUser(email);
  const setCookie = await createSessionCookie(env, userId, GIVEN_NOW);
  const cookie = cookiePair(setCookie);
  const payload = cookie.slice(cookie.indexOf("=") + 1).split(".")[0] ?? "";
  const { csrf } = JSON.parse(decodeBase64Url(payload)) as { csrf: string };
  return { userId, cookie, csrf };
}

function postForm(path: string, caller: Caller, fields: Record<string, string> = {}): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { cookie: caller.cookie, origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrf: caller.csrf, ...fields }),
    redirect: "manual",
  });
}

function getDashboard(caller: Caller): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/dashboard`, { headers: { cookie: caller.cookie } });
}

function createKey(caller: Caller, name = "laptop"): Promise<Response> {
  return postForm("/dashboard/keys", caller, { name });
}

async function createdKeyOf(response: Response): Promise<string> {
  const match = (await response.text()).match(KEY_PATTERN);
  if (!match) throw new Error("The response does not show a full key");
  return match[0];
}

async function readKeyRows(userId: string): Promise<KeyRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT id, prefix, key_hash, revoked_at, last_used_at FROM api_keys WHERE user_id = ?1 ORDER BY created_at, id",
  )
    .bind(userId)
    .all<KeyRow>();
  return results;
}

async function readKeyRow(userId: string): Promise<KeyRow> {
  const [row] = await readKeyRows(userId);
  if (!row) throw new Error("The user has no key");
  return row;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function listTools(bearer?: string): Promise<Response> {
  return postMcp({ jsonrpc: "2.0", id: 1, method: "tools/list" }, bearer);
}

describe("api keys", () => {
  beforeEach(async () => {
    setNow(GIVEN_NOW);
    setBindings({ PUBLIC_ORIGIN: ORIGIN, SESSION_SECRET });
    await clearState();
    await seedSnapshot();
  });

  afterEach(() => {
    restoreBindings();
    vi.useRealTimers();
  });

  describe("creation", () => {
    it("shows the full key once and then only its prefix on the dashboard", async () => {
      const caller = await signIn(USER_EMAIL);

      const created = await createKey(caller);
      const key = await createdKeyOf(created);
      const dashboard = await (await getDashboard(caller)).text();

      expect(created.status).toBe(200);
      expect(key.startsWith(KEY_PREFIX)).toBe(true);
      expect(dashboard).not.toContain(key);
      expect(dashboard).toContain(key.slice(KEY_PREFIX.length, KEY_PREFIX.length + KEY_PREFIX_LENGTH));
    });

    it("refuses a 4th active key with the limit message", async () => {
      const caller = await signIn(USER_EMAIL);
      for (let created = 0; created < MAX_ACTIVE_KEYS; created += 1) {
        expect((await createKey(caller)).status).toBe(200);
      }

      const refused = await createKey(caller);

      expect(await refused.text()).toContain(KEY_LIMIT_MESSAGE);
      expect(await readKeyRows(caller.userId)).toHaveLength(MAX_ACTIVE_KEYS);
    });

    it("stores only the hash and the prefix, never the key", async () => {
      const caller = await signIn(USER_EMAIL);

      const key = await createdKeyOf(await createKey(caller));
      const row = await readKeyRow(caller.userId);

      expect(row.key_hash).toBe(await sha256Hex(key));
      expect(row.prefix).toBe(key.slice(KEY_PREFIX.length, KEY_PREFIX.length + KEY_PREFIX_LENGTH));
      expect(JSON.stringify(row)).not.toContain(key);
    });
  });

  describe("revocation", () => {
    it("refuses a revoked key on /mcp within 60 seconds", async () => {
      const caller = await signIn(USER_EMAIL);
      const key = await createdKeyOf(await createKey(caller));
      const row = await readKeyRow(caller.userId);
      expect((await callTool(INDICES_TOOL, { names: [] }, key)).isError).toBeFalsy();

      const revoked = await postForm(`/dashboard/keys/${row.id}/revoke`, caller);
      setNow(GIVEN_NOW + KEY_CACHE_SECONDS);
      const refused = await listTools(key);

      expect(revoked.status).toBeLessThan(400);
      expect(refused.status).toBe(401);
    });

    it("returns 404 when the key belongs to another user", async () => {
      const owner = await signIn(OTHER_EMAIL);
      await createKey(owner);
      const row = await readKeyRow(owner.userId);
      const intruder = await signIn(USER_EMAIL);

      const response = await postForm(`/dashboard/keys/${row.id}/revoke`, intruder);

      expect(response.status).toBe(404);
      expect((await readKeyRow(owner.userId)).revoked_at).toBeNull();
    });
  });

  describe("/mcp access", () => {
    it("returns 401 with WWW-Authenticate when no bearer is sent", async () => {
      const response = await listTools();

      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBeTruthy();
    });

    it("changes last_used_at at most once per hour", async () => {
      const userId = await seedUser(USER_EMAIL);
      const key = await seedKey(userId);

      await callTool(INDICES_TOOL, { names: [] }, key);
      const first = (await readKeyRow(userId)).last_used_at;
      setNow(GIVEN_NOW + HALF_TOUCH_INTERVAL_SECONDS);
      await callTool(INDICES_TOOL, { names: [] }, key);
      const withinHour = (await readKeyRow(userId)).last_used_at;
      setNow(GIVEN_NOW + TOUCH_INTERVAL_SECONDS + 1);
      await callTool(INDICES_TOOL, { names: [] }, key);
      const afterHour = (await readKeyRow(userId)).last_used_at;

      expect(first).toBe(GIVEN_NOW);
      expect(withinHour).toBe(GIVEN_NOW);
      expect(afterHour).toBe(GIVEN_NOW + TOUCH_INTERVAL_SECONDS + 1);
    });
  });
});
