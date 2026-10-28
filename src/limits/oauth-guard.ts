import type { Config } from "../config";
import { nextUtcMidnight, utcDay } from "../domain/calendar";
import { STATUS_SERVICE_UNAVAILABLE, STATUS_TOO_MANY_REQUESTS } from "../http/status";
import { htmlResponse, messageView } from "../http/views";
import { chargeOauthKvWrites } from "../store/d1/usage";

type OauthWriteCost = 0 | 1 | 2;

const TOKEN_WRITES = 2;
const JSON_ENDPOINTS = ["POST /token", "POST /register"];
const TEMPORARILY_UNAVAILABLE = "temporarily_unavailable";
const JSON_HEADERS = { "content-type": "application/json", "cache-control": "no-store" };
const CAPACITY_TITLE = "Sign-in at capacity";
const SIGN_IN_CAPACITY_MESSAGE = "Sign-in is at capacity for today. Try again after 00:00 UTC.";
const RATE_LIMITED_TITLE = "Too many sign-in attempts";
const RATE_LIMITED_MESSAGE = "Too many sign-in attempts from this address. Try again in a minute.";
const RATE_LIMIT_RETRY_AFTER_SECONDS = 60;
const CALLER_KEY_PREFIX = "oauth:";
const UNKNOWN_CALLER = "unknown";

export function oauthWriteCost(request: Request): OauthWriteCost {
  const key = requestKey(request);
  if (key === "POST /token") return TOKEN_WRITES;
  const singleWrite = ["POST /register", "GET /authorize", "POST /authorize", "GET /callback/google"];
  return singleWrite.includes(key) ? 1 : 0;
}

function requestKey(request: Request): string {
  return `${request.method} ${new URL(request.url).pathname}`;
}

function refusal(request: Request, status: number, title: string, message: string, retryAfter: number): Response {
  const response = JSON_ENDPOINTS.includes(requestKey(request))
    ? Response.json(
        { error: TEMPORARILY_UNAVAILABLE, error_description: message },
        { status, headers: JSON_HEADERS },
      )
    : htmlResponse(messageView(title, message), status);
  response.headers.set("retry-after", String(retryAfter));
  return response;
}

function signInCapacityResponse(request: Request, now: number): Response {
  return refusal(request, STATUS_SERVICE_UNAVAILABLE, CAPACITY_TITLE, SIGN_IN_CAPACITY_MESSAGE, nextUtcMidnight(now) - now);
}

function rateLimitedResponse(request: Request): Response {
  return refusal(request, STATUS_TOO_MANY_REQUESTS, RATE_LIMITED_TITLE, RATE_LIMITED_MESSAGE, RATE_LIMIT_RETRY_AFTER_SECONDS);
}

function isChargedUpFront(request: Request): boolean {
  return JSON_ENDPOINTS.includes(requestKey(request));
}

export async function guardOauth(env: Env, cfg: Config, request: Request, now: number): Promise<Response | null> {
  const cost = oauthWriteCost(request);
  if (cost === 0) return null;
  const charged = await chargeOauthKvWrites(env.DB, utcDay(now), cost, cfg.oauthDailyKvWrites);
  return charged ? null : signInCapacityResponse(request, now);
}

async function guardCaller(env: Env, request: Request): Promise<Response | null> {
  const caller = request.headers.get("cf-connecting-ip") ?? UNKNOWN_CALLER;
  const { success } = await env.RATE_LIMITER.limit({ key: `${CALLER_KEY_PREFIX}${caller}` });
  return success ? null : rateLimitedResponse(request);
}

export async function guardOauthEntry(env: Env, cfg: Config, request: Request, now: number): Promise<Response | null> {
  if (oauthWriteCost(request) === 0) return null;
  const limited = await guardCaller(env, request);
  if (limited !== null) return limited;
  return isChargedUpFront(request) ? guardOauth(env, cfg, request, now) : null;
}
