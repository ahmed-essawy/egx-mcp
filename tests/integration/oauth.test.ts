import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toBase64Url } from "../../src/domain/crypto";
import { encodeBase64Url } from "../helpers/base64url";
import { clearState, restoreBindings, setBindings } from "../helpers/bindings";
import { cookieHeader } from "../helpers/cookies";
import { callTool, errorCodeOf, payloadOf, postMcp } from "../helpers/mcp";
import { dashboardSession, type DashboardSession } from "../helpers/session";
import { seedKey, seedSnapshot, seedSymbols, seedUser, setNow, stockSymbol } from "../helpers/seed";
import { MS_PER_SECOND } from "../helpers/time";

const GIVEN_NOW = Date.UTC(2026, 9, 25, 12, 0, 0) / MS_PER_SECOND;
const GIVEN_DAY = "2026-10-25";
const SECONDS_TO_MIDNIGHT = 43_200;
const ONE_HOUR_SECONDS = 3600;
const ORIGIN = "https://egx.test";
const SESSION_SECRET = "test-session-secret";
const USER_EMAIL = "user@example.com";
const OTHER_EMAIL = "other@example.com";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_ISSUER = "https://accounts.google.com";
const GOOGLE_CODE = "google-code";
const CLIENT_NAME = "Test Assistant";
const CLIENT_REDIRECT_URI = "https://client.example/callback";
const CLIENT_REDIRECT_HOST = "client.example";
const UNVERIFIED_CLIENT_TEXT = "This app registered itself; its name is not verified.";
const CLIENT_STATE = "client-state";
const READ_SCOPE = "mcp:read";
const WRITE_SCOPE = "mcp:write";
const BOTH_SCOPES = `${READ_SCOPE} ${WRITE_SCOPE}`;
const ACCESS_TOKEN_SECONDS = 86_400;
const FIRST_SIGN_IN_KV_WRITES = 6;
const ALMOST_FULL_KV_WRITES = FIRST_SIGN_IN_KV_WRITES - 1;
const PERSONAL_ROWS_CAP = 10;
const CAPACITY_MESSAGE = "The free service is at capacity until 00:00 UTC.";
const GUARD_MESSAGE = "Sign-in is at capacity for today. Try again after 00:00 UTC.";
const DELAY_STATEMENT = "Data is delayed, unofficial and informational only";
const COMI_ISIN = "EGS60121C018";
const COMI_TICKER = "COMI";
const SEARCH_TOOL = "search";
const PORTFOLIO_TOOL = "portfolio_get";
const CHANGES_TOOL = "what_changed_since";
const UPSERT_TOOL = "portfolio_upsert_holding";
const REMOVE_HOLDING_TOOL = "portfolio_remove_holding";
const LEVEL_SET_TOOL = "price_level_set";
const LEVEL_REMOVE_TOOL = "price_level_remove";
const HOLDING_ARGS = { symbol: COMI_TICKER, quantity: 10, costPerShare: 80, acquiredOn: "2026-01-15" };
const LEVEL_ARGS = { symbol: COMI_TICKER, direction: "above", level: 110 };
const WRITE_TOOLS: [string, Record<string, unknown>][] = [
  [UPSERT_TOOL, HOLDING_ARGS],
  [REMOVE_HOLDING_TOOL, { id: 1 }],
  [LEVEL_SET_TOOL, LEVEL_ARGS],
  [LEVEL_REMOVE_TOOL, { id: 1 }],
];
const HANDLE_PATTERN = /<input[^>]*name="handle"[^>]*value="([^"]+)"/;

type IdTokenClaims = Record<string, unknown>;
type Consent = { response: Response; html: string; handle: string };
type Tokens = { access_token: string; expires_in: number };
type SignIn = { userId: string; accessToken: string; clientId: string };
type IdPayload = { data: { id: number } };

let googleClaims: IdTokenClaims;
let realFetch: typeof fetch;

function claimsFor(email: string, overrides: IdTokenClaims = {}): IdTokenClaims {
  return {
    iss: GOOGLE_ISSUER,
    aud: env.GOOGLE_CLIENT_ID,
    exp: GIVEN_NOW + ONE_HOUR_SECONDS,
    sub: `sub-${email}`,
    email,
    email_verified: true,
    name: "Test User",
    ...overrides,
  };
}

function idTokenOf(claims: IdTokenClaims): string {
  const header = encodeBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  return `${header}.${encodeBase64Url(JSON.stringify(claims))}.signature`;
}

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

function stubGoogle(): void {
  realFetch = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
      urlOf(input) === GOOGLE_TOKEN_ENDPOINT
        ? Response.json({ id_token: idTokenOf(googleClaims) })
        : realFetch(input, init),
    ),
  );
}

async function createVerifierPair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: toBase64Url(new Uint8Array(digest)) };
}

function registerClient(): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: CLIENT_NAME,
      redirect_uris: [CLIENT_REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
}

async function registeredClientId(): Promise<string> {
  const response = await registerClient();
  expect(response.status).toBe(201);
  return ((await response.json()) as { client_id: string }).client_id;
}

async function openConsent(clientId: string, challenge: string, scope = BOTH_SCOPES): Promise<Consent> {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: CLIENT_REDIRECT_URI,
    scope,
    state: CLIENT_STATE,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  const response = await SELF.fetch(`${ORIGIN}/authorize?${query}`, { redirect: "manual" });
  const html = await response.clone().text();
  return { response, html, handle: HANDLE_PATTERN.exec(html)?.[1] ?? "" };
}

function decide(consent: Consent, decision: "approve" | "deny"): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/authorize`, {
    method: "POST",
    headers: { cookie: cookieHeader(consent.response), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ handle: consent.handle, decision }),
    redirect: "manual",
  });
}

function googleCallback(approved: Response): Promise<Response> {
  const state = new URL(approved.headers.get("location") ?? "").searchParams.get("state") ?? "";
  return SELF.fetch(`${ORIGIN}/callback/google?${new URLSearchParams({ code: GOOGLE_CODE, state })}`, {
    headers: { cookie: cookieHeader(approved) },
    redirect: "manual",
  });
}

function exchangeCode(clientId: string, verifier: string, callback: Response): Promise<Response> {
  const code = new URL(callback.headers.get("location") ?? "").searchParams.get("code") ?? "";
  return SELF.fetch(`${ORIGIN}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: CLIENT_REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier,
    }),
  });
}

async function signInWith(email: string, scope = BOTH_SCOPES): Promise<SignIn> {
  googleClaims = claimsFor(email);
  const { verifier, challenge } = await createVerifierPair();
  const clientId = await registeredClientId();
  const consent = await openConsent(clientId, challenge, scope);
  const approved = await decide(consent, "approve");
  const callback = await googleCallback(approved);
  const tokens = (await (await exchangeCode(clientId, verifier, callback)).json()) as Tokens;
  const row = await env.DB.prepare("SELECT id FROM users WHERE email = ?1").bind(email).first<{ id: string }>();
  return { userId: row?.id ?? "", accessToken: tokens.access_token, clientId };
}

async function readOauthWrites(): Promise<number> {
  const row = await env.DB.prepare("SELECT oauth_kv_writes AS writes FROM usage_global WHERE day = ?1")
    .bind(GIVEN_DAY)
    .first<{ writes: number }>();
  return row?.writes ?? 0;
}

async function countRows(table: string, userColumn: string, userId: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE ${userColumn} = ?1`)
    .bind(userId)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

async function countUsers(email: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS total FROM users WHERE email = ?1")
    .bind(email)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

async function countGlobalRows(): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS total FROM usage_global").first<{ total: number }>();
  return row?.total ?? 0;
}

async function usedTools(userId: string): Promise<string[]> {
  const { results } = await env.DB.prepare("SELECT tool FROM usage_daily WHERE user_id = ?1")
    .bind(userId)
    .all<{ tool: string }>();
  return results.map((row) => row.tool);
}

async function seedOauthWrites(writes: number): Promise<void> {
  await env.DB.prepare("INSERT INTO usage_global (day, oauth_kv_writes) VALUES (?1, ?2)").bind(GIVEN_DAY, writes).run();
}

async function seedPersonalRows(rows: number): Promise<void> {
  await env.DB.prepare("INSERT INTO usage_global (day, personal_rows) VALUES (?1, ?2)").bind(GIVEN_DAY, rows).run();
}

function postDashboard(path: string, session: DashboardSession, fields: Record<string, string>): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { cookie: session.cookie, origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrf: session.csrf, ...fields }),
    redirect: "manual",
  });
}

function deleteAccountOf(session: DashboardSession, confirm: string): Promise<Response> {
  return postDashboard("/dashboard/account/delete", session, { confirm });
}

function listTools(bearer: string): Promise<Response> {
  return postMcp({ jsonrpc: "2.0", id: 1, method: "tools/list" }, bearer);
}

describe("oauth sign-in", () => {
  beforeEach(async () => {
    setNow(GIVEN_NOW);
    setBindings({ PUBLIC_ORIGIN: ORIGIN, SESSION_SECRET, GOOGLE_CLIENT_SECRET: "google-secret" });
    await clearState();
    await seedSnapshot();
    await seedSymbols([stockSymbol(COMI_ISIN, COMI_TICKER, { nameEn: "COMI Company", sector: "Banks" })]);
    stubGoogle();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    restoreBindings();
    vi.useRealTimers();
  });

  describe("consent", () => {
    it("registers a client dynamically at /register", async () => {
      const response = await registerClient();
      const body = (await response.json()) as { client_id: string; client_name: string };

      expect(response.status).toBe(201);
      expect(body.client_id).toBeTruthy();
      expect(body.client_name).toBe(CLIENT_NAME);
    });

    it("renders the consent page with the client, the scopes and both buttons every time", async () => {
      const clientId = await registeredClientId();
      const { challenge } = await createVerifierPair();

      const first = await openConsent(clientId, challenge);
      const second = await openConsent(clientId, challenge);

      for (const consent of [first, second]) {
        expect(consent.response.status).toBe(200);
        expect(consent.html).toContain(CLIENT_NAME);
        expect(consent.html).toContain(READ_SCOPE);
        expect(consent.html).toContain(WRITE_SCOPE);
        expect(consent.html).toContain(DELAY_STATEMENT);
        expect(consent.html).toContain(`Access will be sent to <strong>${CLIENT_REDIRECT_HOST}</strong>`);
        expect(consent.html).toContain(UNVERIFIED_CLIENT_TEXT);
        expect(consent.response.headers.get("x-frame-options")).toBe("DENY");
        expect(consent.response.headers.get("content-security-policy")).toBe("default-src 'self'; frame-ancestors 'none'");
        expect(consent.html).toContain('name="decision"');
        expect(consent.html).toContain('value="approve"');
        expect(consent.html).toContain('value="deny"');
        expect(consent.html).toContain("Approve");
        expect(consent.html).toContain("Deny");
        expect(consent.handle).not.toBe("");
      }
      expect(second.handle).not.toBe(first.handle);
    });

    it("ends the flow without a grant when the user denies", async () => {
      googleClaims = claimsFor(USER_EMAIL);
      const clientId = await registeredClientId();
      const { challenge } = await createVerifierPair();
      const consent = await openConsent(clientId, challenge);

      const denied = await decide(consent, "deny");
      const location = new URL(denied.headers.get("location") ?? "");

      expect(denied.status).toBe(302);
      expect(location.origin + location.pathname).toBe(CLIENT_REDIRECT_URI);
      expect(location.searchParams.get("error")).toBe("access_denied");
      expect(location.searchParams.get("state")).toBe(CLIENT_STATE);
      expect(location.searchParams.has("code")).toBe(false);
      expect(await countUsers(USER_EMAIL)).toBe(0);
    });
  });

  describe("sign-in", () => {
    it("sends the approved user to Google with the callback redirect URI", async () => {
      const clientId = await registeredClientId();
      const { challenge } = await createVerifierPair();
      const consent = await openConsent(clientId, challenge);

      const approved = await decide(consent, "approve");
      const location = new URL(approved.headers.get("location") ?? "");

      expect(approved.status).toBe(302);
      expect(location.origin + location.pathname).toBe(GOOGLE_AUTH_ENDPOINT);
      expect(location.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/callback/google`);
      expect(location.searchParams.get("scope")).toBe("openid email profile");
      expect(location.searchParams.get("state")).toBeTruthy();
    });

    it("completes authorization and redirects to the client with a code", async () => {
      googleClaims = claimsFor(USER_EMAIL);
      const clientId = await registeredClientId();
      const { challenge } = await createVerifierPair();
      const approved = await decide(await openConsent(clientId, challenge), "approve");

      const callback = await googleCallback(approved);
      const location = new URL(callback.headers.get("location") ?? "");

      expect(callback.status).toBe(302);
      expect(location.origin + location.pathname).toBe(CLIENT_REDIRECT_URI);
      expect(location.searchParams.get("code")).toBeTruthy();
      expect(location.searchParams.get("state")).toBe(CLIENT_STATE);
      expect(await countUsers(USER_EMAIL)).toBe(1);
    });

    it("issues a 24 hour access token that serves search as that user", async () => {
      googleClaims = claimsFor(USER_EMAIL);
      const { verifier, challenge } = await createVerifierPair();
      const clientId = await registeredClientId();
      const approved = await decide(await openConsent(clientId, challenge), "approve");
      const callback = await googleCallback(approved);

      const tokenResponse = await exchangeCode(clientId, verifier, callback);
      const tokens = (await tokenResponse.json()) as Tokens;
      const result = await callTool(SEARCH_TOOL, { query: COMI_TICKER }, tokens.access_token);
      const row = await env.DB.prepare("SELECT id FROM users WHERE email = ?1").bind(USER_EMAIL).first<{ id: string }>();

      expect(tokenResponse.status).toBe(200);
      expect(tokens.expires_in).toBe(ACCESS_TOKEN_SECONDS);
      expect(result.isError).toBeFalsy();
      expect(await usedTools(row?.id ?? "")).toEqual([SEARCH_TOOL]);
    });

    it("refuses an identity whose email is not verified", async () => {
      googleClaims = claimsFor(USER_EMAIL, { email_verified: false });
      const clientId = await registeredClientId();
      const { challenge } = await createVerifierPair();
      const approved = await decide(await openConsent(clientId, challenge), "approve");

      const callback = await googleCallback(approved);

      expect(callback.status).toBeGreaterThanOrEqual(400);
      expect(callback.headers.get("location") ?? "").not.toContain("code=");
      expect(await countUsers(USER_EMAIL)).toBe(0);
    });
  });

  describe("guard", () => {
    beforeEach(() => {
      setBindings({ OAUTH_DAILY_KV_WRITES: String(FIRST_SIGN_IN_KV_WRITES) });
    });

    it("charges a full first sign-in 6 KV writes, step by step", async () => {
      googleClaims = claimsFor(USER_EMAIL);
      const { verifier, challenge } = await createVerifierPair();

      const clientId = await registeredClientId();
      expect(await readOauthWrites()).toBe(1);
      const consent = await openConsent(clientId, challenge);
      expect(await readOauthWrites()).toBe(2);
      const approved = await decide(consent, "approve");
      expect(await readOauthWrites()).toBe(3);
      const callback = await googleCallback(approved);
      expect(await readOauthWrites()).toBe(4);
      const tokenResponse = await exchangeCode(clientId, verifier, callback);

      expect(tokenResponse.status).toBe(200);
      expect(await readOauthWrites()).toBe(FIRST_SIGN_IN_KV_WRITES);
    });

    it("refuses the next /register with 503 and Retry-After, leaving the counter at the cap", async () => {
      await signInWith(USER_EMAIL);

      const refused = await registerClient();

      expect(refused.status).toBe(503);
      expect(refused.headers.get("retry-after")).toBe(String(SECONDS_TO_MIDNIGHT));
      expect(await refused.text()).toContain(GUARD_MESSAGE);
      expect(await readOauthWrites()).toBe(FIRST_SIGN_IN_KV_WRITES);
    });

    it("lets exactly one of two concurrent /register calls through at the cap minus 1", async () => {
      await seedOauthWrites(ALMOST_FULL_KV_WRITES);

      const responses = await Promise.all([registerClient(), registerClient()]);

      expect(responses.map((response) => response.status).sort()).toEqual([201, 503]);
      expect(await readOauthWrites()).toBe(FIRST_SIGN_IN_KV_WRITES);
    });

    it("makes no usage_global call for the landing page, public pages or an unauthenticated /mcp", async () => {
      const landing = await SELF.fetch(`${ORIGIN}/`);
      const privacy = await SELF.fetch(`${ORIGIN}/privacy`);
      const unauthenticated = await postMcp({ jsonrpc: "2.0", id: 1, method: "tools/list" });

      expect(landing.status).toBe(200);
      expect(privacy.status).toBe(200);
      expect(unauthenticated.status).toBe(401);
      expect(await countGlobalRows()).toBe(0);
    });

    it("does not charge the OAuth counter for an authenticated /mcp call", async () => {
      const userId = await seedUser(USER_EMAIL);
      const key = await seedKey(userId);

      await callTool(SEARCH_TOOL, { query: COMI_TICKER }, key);

      expect(await readOauthWrites()).toBe(0);
    });
  });

  describe("account deletion", () => {
    it("removes the account data, revokes the OAuth grant and refuses the old token", async () => {
      const other = await seedUser(OTHER_EMAIL);
      await seedKey(other);
      const { userId, accessToken } = await signInWith(USER_EMAIL);
      await seedKey(userId);
      payloadOf<IdPayload>(await callTool(UPSERT_TOOL, HOLDING_ARGS, accessToken));
      payloadOf<IdPayload>(await callTool(LEVEL_SET_TOOL, LEVEL_ARGS, accessToken));
      const session = await dashboardSession(userId, GIVEN_NOW);
      expect((await listTools(accessToken)).status).toBe(200);

      const response = await deleteAccountOf(session, USER_EMAIL);

      expect(response.status).toBeLessThan(400);
      expect(await response.text()).toContain("Account deleted");
      expect(await countRows("holdings", "user_id", userId)).toBe(0);
      expect(await countRows("price_levels", "user_id", userId)).toBe(0);
      expect(await countRows("api_keys", "user_id", userId)).toBe(0);
      expect(await countRows("usage_daily", "user_id", userId)).toBe(0);
      expect(await countRows("users", "id", userId)).toBe(0);
      expect(await countRows("api_keys", "user_id", other)).toBe(1);
      expect((await listTools(accessToken)).status).toBe(401);
    });

    it("keeps the account when the confirm field is not the email", async () => {
      const { userId } = await signInWith(USER_EMAIL);
      const session = await dashboardSession(userId, GIVEN_NOW);

      const response = await deleteAccountOf(session, OTHER_EMAIL);

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(await countRows("users", "id", userId)).toBe(1);
    });

    it("is refused with the capacity message when the personal cap would be passed", async () => {
      setBindings({ PERSONAL_DAILY_ROWS: String(PERSONAL_ROWS_CAP) });
      const userId = await seedUser(USER_EMAIL);
      await seedPersonalRows(PERSONAL_ROWS_CAP);
      const session = await dashboardSession(userId, GIVEN_NOW);

      const response = await deleteAccountOf(session, USER_EMAIL);

      expect(await response.text()).toContain(CAPACITY_MESSAGE);
      expect(await countRows("users", "id", userId)).toBe(1);
    });

    it("no longer says deletion is by email on /privacy and offers a button on /dashboard", async () => {
      const userId = await seedUser(USER_EMAIL);
      const session = await dashboardSession(userId, GIVEN_NOW);

      const privacy = await (await SELF.fetch(`${ORIGIN}/privacy`)).text();
      const dashboard = await (await SELF.fetch(`${ORIGIN}/dashboard`, { headers: { cookie: session.cookie } })).text();

      expect(privacy).not.toContain("until a delete button is available");
      expect(privacy).toContain("Delete account");
      expect(dashboard).toContain("Delete account");
      expect(dashboard).not.toContain("until a delete button is available");
    });
  });

  describe("read-only scope", () => {
    it("serves the read tools and refuses the write tools with nothing written", async () => {
      const { userId, accessToken } = await signInWith(USER_EMAIL, READ_SCOPE);

      const search = await callTool(SEARCH_TOOL, { query: COMI_TICKER }, accessToken);
      const portfolio = await callTool(PORTFOLIO_TOOL, {}, accessToken);
      const changes = await callTool(CHANGES_TOOL, { since: "2026-10-24T00:00:00Z" }, accessToken);
      const refusals = [];
      for (const [name, args] of WRITE_TOOLS) refusals.push(await callTool(name, args, accessToken));

      expect(search.isError).toBeFalsy();
      expect(portfolio.isError).toBeFalsy();
      expect(changes.isError).toBeFalsy();
      for (const refusal of refusals) {
        expect(refusal.isError).toBe(true);
        expect(errorCodeOf(refusal)).toBe("forbidden");
      }
      expect(await countRows("holdings", "user_id", userId)).toBe(0);
      expect(await countRows("price_levels", "user_id", userId)).toBe(0);
      const tools = await usedTools(userId);
      for (const [name] of WRITE_TOOLS) expect(tools).not.toContain(name);
      expect(tools.sort()).toEqual([CHANGES_TOOL, PORTFOLIO_TOOL, SEARCH_TOOL].sort());
    });

    it("serves the write tools when both scopes were granted", async () => {
      const { accessToken } = await signInWith(USER_EMAIL, BOTH_SCOPES);

      const added = await callTool(UPSERT_TOOL, HOLDING_ARGS, accessToken);

      expect(added.isError).toBeFalsy();
    });
  });

  describe("personal cap", () => {
    it("creates no user and shows the capacity message for a new Google account", async () => {
      setBindings({ PERSONAL_DAILY_ROWS: String(PERSONAL_ROWS_CAP) });
      await seedPersonalRows(PERSONAL_ROWS_CAP);
      googleClaims = claimsFor(USER_EMAIL);
      const clientId = await registeredClientId();
      const { challenge } = await createVerifierPair();
      const approved = await decide(await openConsent(clientId, challenge), "approve");

      const callback = await googleCallback(approved);

      expect(await callback.text()).toContain(CAPACITY_MESSAGE);
      expect(callback.headers.get("location") ?? "").not.toContain("code=");
      expect(await countUsers(USER_EMAIL)).toBe(0);
    });
  });
});
