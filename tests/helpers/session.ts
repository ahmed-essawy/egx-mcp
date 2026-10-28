import { env } from "cloudflare:test";
import { createSessionCookie } from "../../src/auth/session";
import { decodeBase64Url } from "./base64url";
import { cookiePair } from "./cookies";

export type DashboardSession = { cookie: string; csrf: string };

export async function dashboardSession(userId: string, now: number): Promise<DashboardSession> {
  const cookie = cookiePair(await createSessionCookie(env, userId, now));
  const payload = cookie.slice(cookie.indexOf("=") + 1).split(".")[0] ?? "";
  const { csrf } = JSON.parse(decodeBase64Url(payload)) as { csrf: string };
  return { cookie, csrf };
}
