import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { createSessionCookie } from "../../src/auth/session";
import { toBase64Url } from "../../src/domain/crypto";
import { defaultHandler } from "../../src/http/routes";
import { cookiePair } from "../helpers/cookies";
import { decodeBase64Url } from "../helpers/base64url";
import { MS_PER_SECOND } from "../helpers/time";

const ORIGIN = "https://egx.example.com";
const SESSION_SECRET = "test-session-secret";
const CLIENT_ID = "client-id";
const STATE = "state-1";
const VERIFIER = "verifier-1";
const LOGIN_COOKIE = `__Host-egx_login=${STATE}.${VERIFIER}`;
const PERSONAL_DAILY_ROWS = 5000;
const NEW_USER_WORST_CASE_ROWS = 4;
const TOKEN_LIFETIME_SECONDS = 3600;
const USER_ID = "user-1";
const UPSERT_ROWS_WRITTEN = 3;
const LOGIN_COOKIE_SECONDS = 600;
const USER_ROW = {
  id: USER_ID,
  google_sub: "sub-1",
  email: "user@example.com",
  display_name: null,
  created_at: 1,
  deleted_at: null,
};
const KEY_CREATE_WORST_CASE_ROWS = 5;
const KEY_REVOKE_WORST_CASE_ROWS = 3;
const KEY_NAME_MAX_LENGTH = 40;
const KEY_LIMIT_MESSAGE = "You already have 3 active keys. Revoke one to create another.";
const CAPACITY_MESSAGE = "The free service is at capacity until 00:00 UTC.";
const ACCOUNT_BOUND_ROWS = 12;
const DELETE_PATH = "/dashboard/account/delete";
const CONFIRM_MESSAGE = "Type your email address exactly to confirm deleting your account.";

type Row = Record<string, unknown> | null;

type FakeDbOptions = {
  upsertDeletedAt?: number | null;
  changes?: number;
  run?: Mock<(sql: string) => void>;
  batch?: Mock<(count: number) => void>;
};

function fakeDb(rowFor: (sql: string) => Row, options: FakeDbOptions = {}): D1Database {
  const { upsertDeletedAt = null, changes = 1, run = vi.fn<(sql: string) => void>(), batch = vi.fn<(count: number) => void>() } = options;
  return {
    batch: async (statements: unknown[]) => {
      batch(statements.length);
      return statements.map(() => ({ meta: { rows_written: 1 } }));
    },
    prepare: (sql: string) => ({
      bind: () => ({
        first: async () => rowFor(sql),
        all: async () => {
          if (sql.includes("INSERT INTO users")) {
            return { results: [{ id: USER_ID, deleted_at: upsertDeletedAt }], meta: { rows_written: UPSERT_ROWS_WRITTEN } };
          }
          if (sql.includes("FROM usage_global")) return { results: [rowFor(sql)], meta: { rows_read: 1 } };
          return { results: [], meta: { rows_written: 0 } };
        },
        run: async () => {
          run(sql);
          return { meta: { rows_written: 1, changes } };
        },
      }),
    }),
  } as unknown as D1Database;
}

function accountRows(personalRows: number): (sql: string) => Row {
  return (sql) => {
    if (sql.includes("AS bound")) return { bound: ACCOUNT_BOUND_ROWS };
    return sql.includes("FROM users") ? USER_ROW : { personal_rows: personalRows };
  };
}

function fakeOauth(pages: { items: { id: string }[]; cursor?: string }[]) {
  const listUserGrants = vi.fn(async (_userId: string, options?: { cursor?: string }) => pages[options?.cursor === undefined ? 0 : 1]!);
  const revokeGrant = vi.fn(async (_grantId: string, _userId: string) => undefined);
  return { listUserGrants, revokeGrant };
}

function userAndUsage(personalRows: number): (sql: string) => Row {
  return (sql) => (sql.includes("FROM users") ? USER_ROW : { personal_rows: personalRows });
}

async function postKeyForm(path: string, env: Env, fields: Record<string, string>): Promise<Response> {
  const { cookie, csrf } = await signedIn(env);
  return call(post(path, { cookie, origin: ORIGIN }, { csrf, ...fields }), env);
}

function envWith(overrides: Record<string, unknown> = {}): Env {
  return {
    GLOBAL_DAILY_CALLS: "15000",
    GLOBAL_DAILY_ROWS_READ: "3500000",
    OAUTH_DAILY_KV_WRITES: "600",
    USER_DAILY_CALLS: "100",
    OWNER_EMAILS: "",
    UNLIMITED_EMAILS: "",
    STOCK_PROVIDERS: "egx,tradingview",
    SNAPSHOT_EVERY_MINUTES: "1",
    BACKFILL_MAX_ROWS_PER_DAY: "36000",
    ADJUST_MAX_ROWS_PER_DAY: "10000",
    ADJUST_MAX_ACTIONS_PER_RUN: "2",
    PERSONAL_DAILY_ROWS: String(PERSONAL_DAILY_ROWS),
    PUBLIC_ORIGIN: ORIGIN,
    SESSION_SECRET,
    GOOGLE_CLIENT_ID: CLIENT_ID,
    GOOGLE_CLIENT_SECRET: "client-secret",
    ...overrides,
  } as unknown as Env;
}

function call(request: Request, env: Env): Promise<Response> {
  return defaultHandler.fetch!(request as never, env, {} as ExecutionContext) as Promise<Response>;
}

function callback(cookie: string | null, state = STATE): Request {
  const headers: Record<string, string> = cookie === null ? {} : { cookie };
  return new Request(`${ORIGIN}/dashboard/callback?code=code-1&state=${state}`, { headers });
}

function expectLoginCookieCleared(response: Response): void {
  expect(response.headers.get("set-cookie")).toContain("__Host-egx_login=; ");
  expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
}

function idToken(): string {
  const claims = {
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    exp: Date.now() / MS_PER_SECOND + TOKEN_LIFETIME_SECONDS,
    sub: "sub-1",
    email: "user@example.com",
    email_verified: true,
  };
  return `header.${toBase64Url(new TextEncoder().encode(JSON.stringify(claims)))}.signature`;
}

async function signedIn(env: Env): Promise<{ cookie: string; csrf: string }> {
  const cookie = cookiePair(await createSessionCookie(env, USER_ID, Date.now() / MS_PER_SECOND));
  const payload = cookie.slice(cookie.indexOf("=") + 1).split(".")[0] ?? "";
  const { csrf } = JSON.parse(decodeBase64Url(payload)) as { csrf: string };
  return { cookie, csrf };
}

function post(path: string, headers: Record<string, string>, fields: Record<string, string>): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(fields),
  });
}

describe("dashboard routes without a database", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("posts", () => {
    it("refuses a post whose Origin is null", async () => {
      const env = envWith({ DB: fakeDb(() => USER_ROW) });
      const { cookie, csrf } = await signedIn(env);

      const response = await call(post("/dashboard/logout", { cookie, origin: "null" }, { csrf }), env);

      expect(response.status).toBe(403);
    });

    it.each([
      ["empty", ""],
      ["invalid", "not a url"],
      ["schemeless", "localhost:8787"],
    ])("answers 500 when PUBLIC_ORIGIN is %s", async (_label, value) => {
      const env = envWith({ PUBLIC_ORIGIN: value });
      const { cookie, csrf } = await signedIn(env);

      const response = await call(post("/dashboard/logout", { cookie, origin: ORIGIN }, { csrf }), env);

      expect(response.status).toBe(500);
    });

    it("sends a signed session whose user is soft deleted to the login page and clears the cookie", async () => {
      const env = envWith({ DB: fakeDb(() => ({ ...USER_ROW, deleted_at: 1 })) });
      const { cookie, csrf } = await signedIn(env);

      const response = await call(post("/dashboard/logout", { cookie, origin: ORIGIN }, { csrf }), env);

      expect(response.status).toBe(303);
      expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    });

    it("sends a signed session whose user no longer exists to the login page and clears the cookie", async () => {
      const env = envWith({ DB: fakeDb(() => null) });
      const { cookie, csrf } = await signedIn(env);

      const response = await call(post("/dashboard/logout", { cookie, origin: ORIGIN }, { csrf }), env);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/dashboard/login");
      expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    });
  });

  describe("keys", () => {
    it.each([
      ["an empty name", ""],
      ["a name over the limit", "x".repeat(KEY_NAME_MAX_LENGTH + 1)],
    ])("answers 400 and writes nothing for %s", async (_label, name) => {
      const run = vi.fn<(sql: string) => void>();
      const env = envWith({ DB: fakeDb(userAndUsage(0), { run }) });

      const response = await postKeyForm("/dashboard/keys", env, { name });

      expect(response.status).toBe(400);
      expect(run).not.toHaveBeenCalled();
    });

    it("answers 409 with the limit message when the database refuses the key", async () => {
      const env = envWith({ DB: fakeDb(userAndUsage(0), { changes: 0 }) });

      const response = await postKeyForm("/dashboard/keys", env, { name: "laptop" });

      expect(response.status).toBe(409);
      expect(await response.text()).toContain(KEY_LIMIT_MESSAGE);
    });

    it.each([
      ["key creation", "/dashboard/keys", KEY_CREATE_WORST_CASE_ROWS, { name: "laptop" }],
      ["key revocation", "/dashboard/keys/key-1/revoke", KEY_REVOKE_WORST_CASE_ROWS, {}],
    ])("answers 503 with the capacity message and writes nothing for %s at capacity", async (_label, path, worst, fields) => {
      const run = vi.fn<(sql: string) => void>();
      const env = envWith({ DB: fakeDb(userAndUsage(PERSONAL_DAILY_ROWS - worst + 1), { run }) });

      const response = await postKeyForm(path, env, fields);

      expect(response.status).toBe(503);
      expect(await response.text()).toContain(CAPACITY_MESSAGE);
      expect(run).not.toHaveBeenCalled();
    });
  });

  describe("account deletion", () => {
    it("answers 400 and deletes and revokes nothing when the confirm field is not the email", async () => {
      const batch = vi.fn<(count: number) => void>();
      const oauth = fakeOauth([{ items: [{ id: "grant-1" }] }]);
      const env = envWith({ DB: fakeDb(accountRows(0), { batch }), OAUTH_PROVIDER: oauth });

      const response = await postKeyForm(DELETE_PATH, env, { confirm: "other@example.com" });

      expect(response.status).toBe(400);
      expect(await response.text()).toContain(CONFIRM_MESSAGE);
      expect(batch).not.toHaveBeenCalled();
      expect(oauth.listUserGrants).not.toHaveBeenCalled();
    });

    it("answers 503 with the capacity message and deletes and revokes nothing at capacity", async () => {
      const batch = vi.fn<(count: number) => void>();
      const oauth = fakeOauth([{ items: [{ id: "grant-1" }] }]);
      const env = envWith({ DB: fakeDb(accountRows(PERSONAL_DAILY_ROWS - ACCOUNT_BOUND_ROWS + 1), { batch }), OAUTH_PROVIDER: oauth });

      const response = await postKeyForm(DELETE_PATH, env, { confirm: USER_ROW.email });

      expect(response.status).toBe(503);
      expect(await response.text()).toContain(CAPACITY_MESSAGE);
      expect(batch).not.toHaveBeenCalled();
      expect(oauth.listUserGrants).not.toHaveBeenCalled();
    });

    it("revokes every grant across pages, deletes the account and clears the session", async () => {
      const batch = vi.fn<(count: number) => void>();
      const oauth = fakeOauth([{ items: [{ id: "grant-1" }, { id: "grant-2" }], cursor: "next" }, { items: [{ id: "grant-3" }] }]);
      const env = envWith({ DB: fakeDb(accountRows(0), { batch }), OAUTH_PROVIDER: oauth });

      const response = await postKeyForm(DELETE_PATH, env, { confirm: ` ${USER_ROW.email} ` });

      expect(response.status).toBe(200);
      expect(await response.text()).toContain("Account deleted");
      expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
      expect(batch).toHaveBeenCalledOnce();
      expect(oauth.revokeGrant.mock.calls).toEqual([
        ["grant-1", USER_ID],
        ["grant-2", USER_ID],
        ["grant-3", USER_ID],
      ]);
    });
  });

  describe("login", () => {
    it("stores state and verifier in a 10 minute cookie and redirects to Google with the same state", async () => {
      const response = await call(new Request(`${ORIGIN}/dashboard/login`), envWith());

      const cookie = response.headers.get("set-cookie") ?? "";
      const value = cookie.split(";")[0]?.slice("__Host-egx_login=".length) ?? "";
      const location = new URL(response.headers.get("location") ?? "");
      expect(response.status).toBe(302);
      expect(cookie).toContain("Path=/; Secure; HttpOnly; SameSite=Lax");
      expect(cookie).toContain(`Max-Age=${LOGIN_COOKIE_SECONDS}`);
      expect(value.split(".")[0]).toBe(location.searchParams.get("state"));
      expect(location.host).toBe("accounts.google.com");
      expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    });

    it("answers 500 when SESSION_SECRET is empty", async () => {
      const response = await call(new Request(`${ORIGIN}/dashboard/login`), envWith({ SESSION_SECRET: "" }));

      expect(response.status).toBe(500);
    });
  });

  describe("callback", () => {
    it("signs the user in, sets the session cookie and clears the login cookie", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ id_token: idToken() })));
      const env = envWith({ DB: fakeDb(() => null) });

      const response = await call(callback(LOGIN_COOKIE), env);

      const cookies = response.headers.getSetCookie();
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/dashboard");
      expect(cookies.some((cookie) => cookie.startsWith("__Host-egx_session=") && cookie.includes("HttpOnly"))).toBe(true);
      expect(cookies.some((cookie) => cookie.startsWith("__Host-egx_login=; "))).toBe(true);
    });

    it("refuses a soft-deleted account with 403, no session and a cleared login cookie", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ id_token: idToken() })));
      const env = envWith({ DB: fakeDb(() => null, { upsertDeletedAt: 1 }) });

      const response = await call(callback(LOGIN_COOKIE), env);

      expect(response.status).toBe(403);
      expectLoginCookieCleared(response);
      expect(response.headers.getSetCookie().some((cookie) => cookie.startsWith("__Host-egx_session="))).toBe(false);
    });

    it("answers 500 and clears the login cookie before any request when SESSION_SECRET is empty", async () => {
      const fetchStub = vi.fn();
      vi.stubGlobal("fetch", fetchStub);

      const response = await call(callback(LOGIN_COOKIE), envWith({ SESSION_SECRET: "" }));

      expect(response.status).toBe(500);
      expectLoginCookieCleared(response);
      expect(fetchStub).not.toHaveBeenCalled();
    });

    it.each([
      ["a missing login cookie", callback(null)],
      ["a state mismatch", callback(LOGIN_COOKIE, "other-state")],
    ])("answers 400 and clears the login cookie on %s", async (_label, request) => {
      const response = await call(request, envWith());

      expect(response.status).toBe(400);
      expectLoginCookieCleared(response);
    });

    it("answers 502 and clears the login cookie when the code exchange fails", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network")));

      const response = await call(callback(LOGIN_COOKIE), envWith());

      expect(response.status).toBe(502);
      expectLoginCookieCleared(response);
    });

    it("answers 503 with the capacity message and clears the login cookie at capacity", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ id_token: idToken() })));
      const personalRows = PERSONAL_DAILY_ROWS - NEW_USER_WORST_CASE_ROWS + 1;
      const env = envWith({ DB: fakeDb(() => ({ personal_rows: personalRows })) });

      const response = await call(callback(LOGIN_COOKIE), env);

      expect(response.status).toBe(503);
      expect(await response.text()).toContain(CAPACITY_MESSAGE);
      expectLoginCookieCleared(response);
    });
  });

  describe("html headers", () => {
    it("sends Referrer-Policy same-origin and Cache-Control no-store on HTML", async () => {
      const response = await call(new Request(`${ORIGIN}/`), envWith());

      expect(response.headers.get("referrer-policy")).toBe("same-origin");
      expect(response.headers.get("cache-control")).toBe("no-store");
    });
  });

  describe("error boundary", () => {
    it("answers 500 with the contract headers and no error text when a handler throws", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const env = envWith({ DB: { prepare: () => { throw new Error("secret detail"); } } });
      const { cookie, csrf } = await signedIn(env);

      const response = await call(post("/dashboard/logout", { cookie, origin: ORIGIN }, { csrf }), env);

      expect(response.status).toBe(500);
      expect(response.headers.get("content-security-policy")).toBe("default-src 'self'; frame-ancestors 'none'");
      expect(await response.text()).not.toContain("secret detail");
    });
  });
});
