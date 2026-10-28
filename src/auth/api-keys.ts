import { sha256Hex, toBase64Url } from "../domain/crypto";
import { findActiveKeyByHash } from "../store/d1/users";

export type AuthProps = {
  userId: string;
  email: string;
  via: "key" | "oauth";
  keyId?: string;
  scopes: string[];
};

const KEY_PREFIX = "egx_";
const KEY_BYTES = 32;
const KEY_PREFIX_LENGTH = 8;
const KEY_CACHE_MILLISECONDS = 60_000;
export const API_KEY_SCOPES: readonly string[] = ["mcp:read", "mcp:write"];

type CachedAuth = { auth: AuthProps; cachedAt: number };

const cache = new Map<string, CachedAuth>();

function pruneExpired(now: number): void {
  for (const [hash, entry] of cache) {
    if (now - entry.cachedAt < KEY_CACHE_MILLISECONDS) return;
    cache.delete(hash);
  }
}

export function generateApiKey(): { key: string; prefix: string } {
  const secret = toBase64Url(crypto.getRandomValues(new Uint8Array(KEY_BYTES)));
  return { key: `${KEY_PREFIX}${secret}`, prefix: secret.slice(0, KEY_PREFIX_LENGTH) };
}

export function hashApiKey(key: string): Promise<string> {
  return sha256Hex(key);
}

export async function resolveApiKey(env: Env, bearer: string): Promise<AuthProps | null> {
  if (!bearer.startsWith(KEY_PREFIX)) return null;
  const hash = await hashApiKey(bearer);
  const now = Date.now();
  const cached = cache.get(hash);
  if (cached && now - cached.cachedAt < KEY_CACHE_MILLISECONDS) return cached.auth;
  cache.delete(hash);
  const found = await findActiveKeyByHash(env.DB, hash);
  if (!found) return null;
  const auth: AuthProps = {
    userId: found.userId,
    email: found.email,
    keyId: found.keyId,
    via: "key",
    scopes: [...API_KEY_SCOPES],
  };
  pruneExpired(now);
  cache.set(hash, { auth, cachedAt: now });
  return auth;
}
