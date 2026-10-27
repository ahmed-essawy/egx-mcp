import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exchangeGoogleCode, googleAuthUrl } from "../../src/auth/google";
import { encodeBase64Url } from "../helpers/base64url";
import { setNow } from "../helpers/seed";
import { MS_PER_SECOND } from "../helpers/time";

const GIVEN_NOW = Date.UTC(2026, 9, 25, 12, 0, 0) / MS_PER_SECOND;
const ONE_HOUR_SECONDS = 3600;
const CLIENT_ID = "client-id.apps.googleusercontent.com";
const CLIENT_SECRET = "client-secret";
const REDIRECT_URI = "https://egx.example/dashboard/callback";
const CODE = "auth-code";
const CODE_VERIFIER = "verifier-value";
const CODE_CHALLENGE = "challenge-value";
const STATE = "state-value";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_ISSUER = "https://accounts.google.com";
const GOOGLE_ISSUER_BARE = "accounts.google.com";
const SUBJECT = "google-sub-1";
const EMAIL = "reader@example.com";
const NAME = "Reader One";

const env = {
  GOOGLE_CLIENT_ID: CLIENT_ID,
  GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
} as unknown as Env;

type IdTokenClaims = Record<string, unknown>;

function validClaims(overrides: IdTokenClaims = {}): IdTokenClaims {
  return {
    iss: GOOGLE_ISSUER,
    aud: CLIENT_ID,
    exp: GIVEN_NOW + ONE_HOUR_SECONDS,
    sub: SUBJECT,
    email: EMAIL,
    email_verified: true,
    name: NAME,
    ...overrides,
  };
}

function idToken(claims: IdTokenClaims): string {
  const header = encodeBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  return `${header}.${encodeBase64Url(JSON.stringify(claims))}.signature`;
}

function stubTokenEndpoint(claims: IdTokenClaims): ReturnType<typeof vi.fn> {
  const fetchStub = vi.fn(async () => Response.json({ id_token: idToken(claims) }));
  vi.stubGlobal("fetch", fetchStub);
  return fetchStub;
}

function exchange(): Promise<unknown> {
  return exchangeGoogleCode(env, {
    code: CODE,
    redirectUri: REDIRECT_URI,
    codeVerifier: CODE_VERIFIER,
  });
}

describe("exchangeGoogleCode", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setNow(GIVEN_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("returns the identity for a valid id_token", async () => {
    stubTokenEndpoint(validClaims());

    await expect(exchange()).resolves.toEqual({ sub: SUBJECT, email: EMAIL, name: NAME });
  });

  it("accepts the bare accounts.google.com issuer", async () => {
    stubTokenEndpoint(validClaims({ iss: GOOGLE_ISSUER_BARE }));

    await expect(exchange()).resolves.toMatchObject({ sub: SUBJECT });
  });

  it("returns a null name when the token has none", async () => {
    stubTokenEndpoint(validClaims({ name: undefined }));

    await expect(exchange()).resolves.toMatchObject({ name: null });
  });

  it("posts the code, verifier and credentials to the token endpoint", async () => {
    const fetchStub = stubTokenEndpoint(validClaims());

    await exchange();

    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    const form = new URLSearchParams(String(init.body));
    expect(url).toBe(TOKEN_ENDPOINT);
    expect(init.method).toBe("POST");
    expect(form.get("code")).toBe(CODE);
    expect(form.get("code_verifier")).toBe(CODE_VERIFIER);
    expect(form.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(form.get("client_id")).toBe(CLIENT_ID);
    expect(form.get("client_secret")).toBe(CLIENT_SECRET);
    expect(form.get("grant_type")).toBe("authorization_code");
  });

  it.each([
    ["a payload that is not an object", "null"],
    ["a payload that is a string", '"text"'],
  ])("rejects %s with google_identity_invalid", async (_label, payload) => {
    const token = `header.${encodeBase64Url(payload)}.signature`;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id_token: token })));

    await expect(exchange()).rejects.toThrow("google_identity_invalid");
  });

  it("rejects a non-JSON token response with google_identity_invalid", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>bad gateway</html>")));

    await expect(exchange()).rejects.toThrow("google_identity_invalid");
  });

  it.each([
    ["an issuer that is not Google", { iss: "https://evil.example" }],
    ["an audience that differs from GOOGLE_CLIENT_ID", { aud: "other-client" }],
    ["an expired token", { exp: GIVEN_NOW - 1 }],
    ["an unverified email", { email_verified: false }],
  ])("rejects %s with google_identity_invalid", async (_label, overrides) => {
    stubTokenEndpoint(validClaims(overrides));

    await expect(exchange()).rejects.toThrow("google_identity_invalid");
  });
});

describe("googleAuthUrl", () => {
  const url = new URL(
    googleAuthUrl({
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      state: STATE,
      codeChallenge: CODE_CHALLENGE,
    }),
  );

  it("targets the Google authorization endpoint", () => {
    expect(`${url.origin}${url.pathname}`).toBe(AUTH_ENDPOINT);
  });

  it("requests PKCE S256 and the openid email profile scope", () => {
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(CODE_CHALLENGE);
    expect(url.searchParams.get("scope")).toBe("openid email profile");
  });

  it("carries the client, redirect and state", () => {
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(url.searchParams.get("state")).toBe(STATE);
    expect(url.searchParams.get("response_type")).toBe("code");
  });
});
