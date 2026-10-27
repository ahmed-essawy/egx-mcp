import { fromBase64Url, toBase64Url } from "../domain/crypto";
import type { GoogleProfile } from "../store/d1/users";

const MS_PER_SECOND = 1000;
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const SCOPE = "openid email profile";
const CODE_CHALLENGE_METHOD = "S256";
const VERIFIER_BYTES = 32;
const INVALID_IDENTITY = "google_identity_invalid";

export type GoogleIdentity = GoogleProfile;

type IdTokenClaims = {
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
};

function invalidIdentity(): Error {
  return new Error(INVALID_IDENTITY);
}

function decodeClaims(idToken: unknown): IdTokenClaims {
  if (typeof idToken !== "string") throw invalidIdentity();
  const payload = idToken.split(".")[1];
  if (!payload) throw invalidIdentity();
  try {
    const claims: unknown = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
    if (typeof claims !== "object" || claims === null) throw invalidIdentity();
    return claims as IdTokenClaims;
  } catch {
    throw invalidIdentity();
  }
}

function toIdentity(claims: IdTokenClaims, clientId: string): GoogleIdentity {
  const nowSeconds = Date.now() / MS_PER_SECOND;
  const valid =
    typeof claims.iss === "string" &&
    GOOGLE_ISSUERS.includes(claims.iss) &&
    claims.aud === clientId &&
    typeof claims.exp === "number" &&
    claims.exp > nowSeconds &&
    claims.email_verified === true &&
    typeof claims.sub === "string" &&
    typeof claims.email === "string";
  if (!valid) throw invalidIdentity();
  return {
    sub: claims.sub as string,
    email: claims.email as string,
    name: typeof claims.name === "string" ? claims.name : null,
  };
}

export function googleAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const query = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: "code",
    scope: SCOPE,
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: CODE_CHALLENGE_METHOD,
  });
  return `${AUTH_ENDPOINT}?${query.toString()}`;
}

export async function exchangeGoogleCode(
  env: Env,
  params: { code: string; redirectUri: string; codeVerifier: string },
): Promise<GoogleIdentity> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: params.code,
      code_verifier: params.codeVerifier,
      redirect_uri: params.redirectUri,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: "authorization_code",
    }),
  });
  if (!response.ok) throw invalidIdentity();
  const body = (await response.json().catch(() => {
    throw invalidIdentity();
  })) as { id_token?: unknown } | null;
  return toIdentity(decodeClaims(body?.id_token), env.GOOGLE_CLIENT_ID);
}

export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = toBase64Url(crypto.getRandomValues(new Uint8Array(VERIFIER_BYTES)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: toBase64Url(new Uint8Array(digest)) };
}
