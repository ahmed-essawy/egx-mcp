import { describe, expect, it } from "vitest";
import { checkPost, createSessionCookie, readSession, type Session } from "../../src/auth/session";
import { decodeBase64Url, encodeBase64Url } from "../helpers/base64url";
import { cookiePair } from "../helpers/cookies";
import { MS_PER_SECOND } from "../helpers/time";

const GIVEN_NOW = Date.UTC(2026, 9, 25, 12, 0, 0) / MS_PER_SECOND;
const SESSION_TTL_SECONDS = 43200;
const SESSION_SECRET = "test-session-secret";
const OTHER_SECRET = "other-session-secret";
const PUBLIC_ORIGIN = "https://egx.test";
const OTHER_ORIGIN = "https://evil.example";
const USER_ID = "user-1";
const OTHER_USER_ID = "user-2";
const COOKIE_NAME = "__Host-egx_session";

const env = { SESSION_SECRET } as unknown as Env;

async function issueCookie(now = GIVEN_NOW, userId = USER_ID): Promise<string> {
  const setCookie = await createSessionCookie(env, userId, now);
  return cookiePair(setCookie);
}

function splitCookie(cookie: string): { payload: string; signature: string } {
  const value = cookie.slice(cookie.indexOf("=") + 1);
  const separator = value.indexOf(".");
  return { payload: value.slice(0, separator), signature: value.slice(separator + 1) };
}

function cookieOf(payload: string, signature: string): string {
  return `${COOKIE_NAME}=${payload}.${signature}`;
}

function requestWithCookie(cookie: string): Request {
  return new Request(`${PUBLIC_ORIGIN}/dashboard`, { headers: { cookie } });
}

function postRequest(origin: string | null, fields: Record<string, string>): Request {
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (origin !== null) headers.origin = origin;
  return new Request(`${PUBLIC_ORIGIN}/dashboard/keys`, {
    method: "POST",
    headers,
    body: new URLSearchParams(fields),
  });
}

async function freshSession(): Promise<Session> {
  const session = await readSession(env, requestWithCookie(await issueCookie()), GIVEN_NOW);
  if (session === null) throw new Error("fresh session expected");
  return session;
}

describe("createSessionCookie", () => {
  it("sets the host-prefixed cookie with the required attributes", async () => {
    const setCookie = await createSessionCookie(env, USER_ID, GIVEN_NOW);

    expect(setCookie.startsWith(`${COOKIE_NAME}=`)).toBe(true);
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
  });

  it("encodes the user id, a 12 hour expiry and a csrf token in the payload", async () => {
    const { payload } = splitCookie(await issueCookie());

    const claims = JSON.parse(decodeBase64Url(payload)) as { uid: string; exp: number; csrf: string };

    expect(claims.uid).toBe(USER_ID);
    expect(claims.exp).toBe(GIVEN_NOW + SESSION_TTL_SECONDS);
    expect(claims.csrf.length).toBeGreaterThan(0);
  });
});

describe("readSession", () => {
  it("round-trips a fresh cookie", async () => {
    const cookie = await issueCookie();
    const { payload } = splitCookie(cookie);
    const { csrf } = JSON.parse(decodeBase64Url(payload)) as { csrf: string };

    const session = await readSession(env, requestWithCookie(cookie), GIVEN_NOW);

    expect(session).toEqual({ userId: USER_ID, csrf });
  });

  it("rejects a request without a cookie", async () => {
    const request = new Request(`${PUBLIC_ORIGIN}/dashboard`);

    await expect(readSession(env, request, GIVEN_NOW)).resolves.toBeNull();
  });

  it("rejects a cookie whose payload was tampered with", async () => {
    const { payload, signature } = splitCookie(await issueCookie());
    const claims = JSON.parse(decodeBase64Url(payload)) as Record<string, unknown>;
    const forged = encodeBase64Url(JSON.stringify({ ...claims, uid: OTHER_USER_ID }));

    const session = await readSession(env, requestWithCookie(cookieOf(forged, signature)), GIVEN_NOW);

    expect(session).toBeNull();
  });

  it("rejects a cookie whose signature was tampered with", async () => {
    const { payload, signature } = splitCookie(await issueCookie());
    const flipped = `${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;

    const session = await readSession(env, requestWithCookie(cookieOf(payload, flipped)), GIVEN_NOW);

    expect(session).toBeNull();
  });

  it("rejects a cookie signed with a different secret", async () => {
    const foreign = await createSessionCookie({ SESSION_SECRET: OTHER_SECRET } as unknown as Env, USER_ID, GIVEN_NOW);

    const session = await readSession(env, requestWithCookie(cookiePair(foreign)), GIVEN_NOW);

    expect(session).toBeNull();
  });

  it("rejects a cookie at exactly its expiry second", async () => {
    const cookie = await issueCookie();

    const session = await readSession(env, requestWithCookie(cookie), GIVEN_NOW + SESSION_TTL_SECONDS);

    expect(session).toBeNull();
  });

  it.each([
    ["undefined", undefined],
    ["empty", ""],
  ])("fails closed when SESSION_SECRET is %s", async (_label, secret) => {
    const cookie = await issueCookie();
    const unconfigured = { SESSION_SECRET: secret } as unknown as Env;

    await expect(createSessionCookie(unconfigured, USER_ID, GIVEN_NOW)).rejects.toThrow("session_secret_missing");
    await expect(readSession(unconfigured, requestWithCookie(cookie), GIVEN_NOW)).resolves.toBeNull();
  });

  it("rejects an expired cookie", async () => {
    const cookie = await issueCookie();

    const session = await readSession(env, requestWithCookie(cookie), GIVEN_NOW + SESSION_TTL_SECONDS + 1);

    expect(session).toBeNull();
  });
});

describe("checkPost", () => {
  it("accepts a POST with the same origin and the session csrf", async () => {
    const session = await freshSession();

    await expect(checkPost(postRequest(PUBLIC_ORIGIN, { csrf: session.csrf }), session, PUBLIC_ORIGIN)).resolves.toBe(true);
  });

  it("rejects a POST with a different Origin", async () => {
    const session = await freshSession();

    await expect(checkPost(postRequest(OTHER_ORIGIN, { csrf: session.csrf }), session, PUBLIC_ORIGIN)).resolves.toBe(false);
  });

  it("rejects a POST without an Origin header", async () => {
    const session = await freshSession();

    await expect(checkPost(postRequest(null, { csrf: session.csrf }), session, PUBLIC_ORIGIN)).resolves.toBe(false);
  });

  it("rejects a POST with a wrong csrf field", async () => {
    const session = await freshSession();

    await expect(checkPost(postRequest(PUBLIC_ORIGIN, { csrf: `${session.csrf}x` }), session, PUBLIC_ORIGIN)).resolves.toBe(false);
  });

  it("rejects a POST with no csrf field", async () => {
    const session = await freshSession();

    await expect(checkPost(postRequest(PUBLIC_ORIGIN, {}), session, PUBLIC_ORIGIN)).resolves.toBe(false);
  });
});
