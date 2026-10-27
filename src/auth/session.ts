import { fromBase64Url, toBase64Url } from "../domain/crypto";

const COOKIE_NAME = "__Host-egx_session";
const SESSION_TTL_SECONDS = 43200;
const CSRF_BYTES = 32;
export const CSRF_FIELD = "csrf";
const COOKIE_ATTRIBUTES = "Path=/; Secure; HttpOnly; SameSite=Lax";
const MISSING_SECRET = "session_secret_missing";
const SIGNATURE_SEPARATOR = ".";

export type Session = { userId: string; csrf: string };

type Claims = { uid: string; exp: number; csrf: string };

const encoder = new TextEncoder();

function encodeText(text: string): string {
  return toBase64Url(encoder.encode(text));
}

function decodeText(text: string): string {
  return new TextDecoder().decode(fromBase64Url(text));
}

async function signingKey(env: Env): Promise<CryptoKey> {
  if (!env.SESSION_SECRET) throw new Error(MISSING_SECRET);
  return crypto.subtle.importKey("raw", encoder.encode(env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

async function sign(env: Env, payload: string): Promise<string> {
  const signature = await crypto.subtle.sign("HMAC", await signingKey(env), encoder.encode(payload));
  return toBase64Url(new Uint8Array(signature));
}

async function signatureMatches(env: Env, payload: string, signature: string): Promise<boolean> {
  return crypto.subtle.verify("HMAC", await signingKey(env), fromBase64Url(signature), encoder.encode(payload));
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  const prefix = `${name}=`;
  const entry = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
  return entry === undefined ? null : entry.slice(prefix.length);
}

function parseClaims(payload: string): Claims | null {
  try {
    const claims = JSON.parse(decodeText(payload)) as Partial<Claims>;
    const valid = typeof claims.uid === "string" && typeof claims.exp === "number" && typeof claims.csrf === "string";
    return valid ? (claims as Claims) : null;
  } catch {
    return null;
  }
}

export async function createSessionCookie(env: Env, userId: string, now: number): Promise<string> {
  const csrf = toBase64Url(crypto.getRandomValues(new Uint8Array(CSRF_BYTES)));
  const claims: Claims = { uid: userId, exp: now + SESSION_TTL_SECONDS, csrf };
  const payload = encodeText(JSON.stringify(claims));
  const signature = await sign(env, payload);
  return `${COOKIE_NAME}=${payload}${SIGNATURE_SEPARATOR}${signature}; ${COOKIE_ATTRIBUTES}; Max-Age=${SESSION_TTL_SECONDS}`;
}

export async function readSession(env: Env, request: Request, now: number): Promise<Session | null> {
  const value = readCookie(request, COOKIE_NAME);
  if (value === null) return null;
  const separator = value.lastIndexOf(SIGNATURE_SEPARATOR);
  if (separator < 0) return null;
  const payload = value.slice(0, separator);
  const verified = await signatureMatches(env, payload, value.slice(separator + 1)).catch(() => false);
  if (!verified) return null;
  const claims = parseClaims(payload);
  if (claims === null || claims.exp <= now) return null;
  return { userId: claims.uid, csrf: claims.csrf };
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`;
}

export async function checkPost(request: Request, session: Session, publicOrigin: string): Promise<boolean> {
  if (request.headers.get("origin") !== publicOrigin) return false;
  const form = await request.clone().formData().catch(() => null);
  return form?.get(CSRF_FIELD) === session.csrf;
}
