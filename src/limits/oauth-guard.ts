import type { Config } from "../config";
import { nextUtcMidnight, utcDay } from "../domain/calendar";
import { STATUS_SERVICE_UNAVAILABLE } from "../http/status";
import { htmlResponse, messageView } from "../http/views";
import { chargeOauthKvWrites } from "../store/d1/usage";

type OauthWriteCost = 0 | 1 | 2;

const TOKEN_WRITES = 2;
const JSON_ENDPOINTS = ["POST /token", "POST /register"];
const TEMPORARILY_UNAVAILABLE = "temporarily_unavailable";
const JSON_HEADERS = { "content-type": "application/json", "cache-control": "no-store" };
const CAPACITY_TITLE = "Sign-in at capacity";
const SIGN_IN_CAPACITY_MESSAGE = "Sign-in is at capacity for today. Try again after 00:00 UTC.";

export function oauthWriteCost(request: Request): OauthWriteCost {
  const key = requestKey(request);
  if (key === "POST /token") return TOKEN_WRITES;
  const singleWrite = ["POST /register", "GET /authorize", "POST /authorize", "GET /callback/google"];
  return singleWrite.includes(key) ? 1 : 0;
}

function requestKey(request: Request): string {
  return `${request.method} ${new URL(request.url).pathname}`;
}

function signInCapacityResponse(request: Request, now: number): Response {
  const response = JSON_ENDPOINTS.includes(requestKey(request))
    ? Response.json(
        { error: TEMPORARILY_UNAVAILABLE, error_description: SIGN_IN_CAPACITY_MESSAGE },
        { status: STATUS_SERVICE_UNAVAILABLE, headers: JSON_HEADERS },
      )
    : htmlResponse(messageView(CAPACITY_TITLE, SIGN_IN_CAPACITY_MESSAGE), STATUS_SERVICE_UNAVAILABLE);
  response.headers.set("retry-after", String(nextUtcMidnight(now) - now));
  return response;
}

export async function guardOauth(env: Env, cfg: Config, request: Request, now: number): Promise<Response | null> {
  const cost = oauthWriteCost(request);
  if (cost === 0) return null;
  const charged = await chargeOauthKvWrites(env.DB, utcDay(now), cost, cfg.oauthDailyKvWrites);
  return charged ? null : signInCapacityResponse(request, now);
}
