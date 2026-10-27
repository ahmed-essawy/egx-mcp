import { generateApiKey, hashApiKey } from "../auth/api-keys";
import { exchangeGoogleCode, googleAuthUrl, pkcePair } from "../auth/google";
import { checkPost, clearSessionCookie, createSessionCookie, readCookie, readSession } from "../auth/session";
import { loadConfig, parseOrigin, type Config } from "../config";
import { toBase64Url } from "../domain/crypto";
import { nowSeconds, utcDay } from "../domain/calendar";
import { CAPACITY_MESSAGE, checkPersonalWrite } from "../limits/usage";
import { addPersonalRows, readGlobal, readToolUsage } from "../store/d1/usage";
import {
  MAX_ACTIVE_KEYS,
  createApiKey,
  getUser,
  listApiKeys,
  revokeApiKey,
  upsertUserByGoogleSub,
  type User,
} from "../store/d1/users";
import {
  STATUS_BAD_GATEWAY,
  STATUS_BAD_REQUEST,
  STATUS_CONFLICT,
  STATUS_FORBIDDEN,
  STATUS_FOUND,
  STATUS_INTERNAL_ERROR,
  STATUS_NOT_FOUND,
  STATUS_OK,
  STATUS_SEE_OTHER,
  STATUS_SERVICE_UNAVAILABLE,
} from "./status";
import { DASHBOARD_PATH, KEY_NAME_MAX_LENGTH, dashboardView, htmlResponse, messageView, withCookies } from "./views";

const LOGIN_COOKIE_NAME = "__Host-egx_login";
const LOGIN_COOKIE_SECONDS = 600;
const LOGIN_COOKIE_ATTRIBUTES = "Path=/; Secure; HttpOnly; SameSite=Lax";
const LOGIN_SEPARATOR = ".";
const STATE_BYTES = 32;
const CALLBACK_PATH = "/dashboard/callback";
const LANDING_PATH = "/";
const LOGIN_PATH = "/dashboard/login";
const NEW_USER_WORST_CASE_ROWS = 4;
const KEY_CREATE_WORST_CASE_ROWS = 5;
const KEY_REVOKE_WORST_CASE_ROWS = 3;
const KEY_LIMIT_MESSAGE = `You already have ${MAX_ACTIVE_KEYS} active keys. Revoke one to create another.`;
const KEY_NAME_MESSAGE = `Enter a key name of 1 to ${KEY_NAME_MAX_LENGTH} characters.`;
const ACCOUNT_DELETED_MESSAGE = "This account has been deleted and cannot sign in.";
const SIGN_IN_FAILED_MESSAGE = "Sign-in could not be completed. Please try again.";

type Viewer = { user: User; csrf: string; now: number };
type PostContext = Viewer & { cfg: Config };
type Configured = { cfg: Config; origin: string };

function messageResponse(title: string, text: string, status: number, cookies: string[] = []): Response {
  return htmlResponse(messageView(title, text), status, cookies);
}

function redirect(location: string, status: number, cookies: string[] = []): Response {
  return new Response(null, { status, headers: withCookies(new Headers({ location }), cookies) });
}

function capacityResponse(cookies: string[] = []): Response {
  return messageResponse("Service at capacity", CAPACITY_MESSAGE, STATUS_SERVICE_UNAVAILABLE, cookies);
}

function signedOutResponse(status: number): Response {
  return redirect(LOGIN_PATH, status, [clearSessionCookie()]);
}

function requireConfigured(env: Env, cookies: string[] = []): Configured | Response {
  const cfg = loadConfig(env);
  const origin = parseOrigin(cfg.publicOrigin);
  if (origin === null || !env.SESSION_SECRET) {
    return messageResponse("Dashboard unavailable", "The service is not configured.", STATUS_INTERNAL_ERROR, cookies);
  }
  return { cfg, origin };
}

function loginCookie(value: string, maxAge: number): string {
  return `${LOGIN_COOKIE_NAME}=${value}; ${LOGIN_COOKIE_ATTRIBUTES}; Max-Age=${maxAge}`;
}

function clearLoginCookie(): string {
  return loginCookie("", 0);
}

function signInFailedResponse(status: number): Response {
  return messageResponse("Sign-in failed", SIGN_IN_FAILED_MESSAGE, status, [clearLoginCookie()]);
}

async function hasCapacity(env: Env, cfg: Config, now: number, worstCaseRows: number): Promise<boolean> {
  return checkPersonalWrite(await readGlobal(env.DB, utcDay(now)), cfg, worstCaseRows);
}

async function recordPersonalRows(env: Env, now: number, rowsWritten: number): Promise<void> {
  if (rowsWritten > 0) await addPersonalRows(env.DB, utcDay(now), rowsWritten);
}

async function findActiveUser(env: Env, userId: string): Promise<User | null> {
  const user = await getUser(env.DB, userId);
  return user === null || user.deletedAt !== null ? null : user;
}

async function authorizePost(request: Request, env: Env): Promise<PostContext | Response> {
  const configured = requireConfigured(env);
  if (configured instanceof Response) return configured;
  const { cfg, origin } = configured;
  const now = nowSeconds();
  const session = await readSession(env, request, now);
  if (session === null) return redirect(LOGIN_PATH, STATUS_SEE_OTHER);
  if (!(await checkPost(request, session, origin))) {
    return messageResponse("Request refused", "The request could not be verified.", STATUS_FORBIDDEN);
  }
  const user = await findActiveUser(env, session.userId);
  if (user === null) return signedOutResponse(STATUS_SEE_OTHER);
  return { user, csrf: session.csrf, now, cfg };
}

async function renderDashboard(
  env: Env,
  { user, csrf, now }: Viewer,
  status: number,
  extras: { newKey?: string; error?: string } = {},
): Promise<Response> {
  const [keys, usage] = await Promise.all([listApiKeys(env.DB, user.id), readToolUsage(env.DB, user.id, utcDay(now))]);
  return htmlResponse(dashboardView({ email: user.email, keys, usage, csrf, ...extras }), status);
}

export async function loginHandler(_request: Request, env: Env): Promise<Response> {
  const configured = requireConfigured(env);
  if (configured instanceof Response) return configured;
  const state = toBase64Url(crypto.getRandomValues(new Uint8Array(STATE_BYTES)));
  const { verifier, challenge } = await pkcePair();
  const location = googleAuthUrl({
    clientId: env.GOOGLE_CLIENT_ID,
    redirectUri: `${configured.origin}${CALLBACK_PATH}`,
    state,
    codeChallenge: challenge,
  });
  return redirect(location, STATUS_FOUND, [
    loginCookie(`${state}${LOGIN_SEPARATOR}${verifier}`, LOGIN_COOKIE_SECONDS),
  ]);
}

export async function callbackHandler(request: Request, env: Env): Promise<Response> {
  const configured = requireConfigured(env, [clearLoginCookie()]);
  if (configured instanceof Response) return configured;
  const { cfg, origin } = configured;
  const params = new URL(request.url).searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const stored = readCookie(request, LOGIN_COOKIE_NAME);
  const separator = stored?.indexOf(LOGIN_SEPARATOR) ?? -1;
  if (stored === null || separator < 0 || code === null || state === null || stored.slice(0, separator) !== state) {
    return signInFailedResponse(STATUS_BAD_REQUEST);
  }
  const identity = await exchangeGoogleCode(env, {
    code,
    redirectUri: `${origin}${CALLBACK_PATH}`,
    codeVerifier: stored.slice(separator + 1),
  }).catch(() => null);
  if (identity === null) return signInFailedResponse(STATUS_BAD_GATEWAY);
  const now = nowSeconds();
  if (!(await hasCapacity(env, cfg, now, NEW_USER_WORST_CASE_ROWS))) {
    return capacityResponse([clearLoginCookie()]);
  }
  const { id, deletedAt, rowsWritten } = await upsertUserByGoogleSub(env.DB, identity, now);
  await recordPersonalRows(env, now, rowsWritten);
  if (deletedAt !== null) {
    return messageResponse("Account deleted", ACCOUNT_DELETED_MESSAGE, STATUS_FORBIDDEN, [clearLoginCookie()]);
  }
  return redirect(DASHBOARD_PATH, STATUS_FOUND, [await createSessionCookie(env, id, now), clearLoginCookie()]);
}

export async function dashboardHandler(request: Request, env: Env): Promise<Response> {
  const now = nowSeconds();
  const session = await readSession(env, request, now);
  if (session === null) return redirect(LOGIN_PATH, STATUS_FOUND);
  const user = await findActiveUser(env, session.userId);
  if (user === null) return signedOutResponse(STATUS_FOUND);
  return renderDashboard(env, { user, csrf: session.csrf, now }, STATUS_OK);
}

export async function createKeyHandler(request: Request, env: Env): Promise<Response> {
  const context = await authorizePost(request, env);
  if (context instanceof Response) return context;
  const { user, cfg, now } = context;
  const name = String((await request.formData()).get("name") ?? "").trim();
  if (name === "" || name.length > KEY_NAME_MAX_LENGTH) {
    return renderDashboard(env, context, STATUS_BAD_REQUEST, { error: KEY_NAME_MESSAGE });
  }
  if (!(await hasCapacity(env, cfg, now, KEY_CREATE_WORST_CASE_ROWS))) return capacityResponse();
  const { key, prefix } = generateApiKey();
  const { created, rowsWritten } = await createApiKey(env.DB, {
    id: crypto.randomUUID(),
    userId: user.id,
    prefix,
    keyHash: await hashApiKey(key),
    name,
    now,
  });
  await recordPersonalRows(env, now, rowsWritten);
  if (!created) return renderDashboard(env, context, STATUS_CONFLICT, { error: KEY_LIMIT_MESSAGE });
  return renderDashboard(env, context, STATUS_OK, { newKey: key });
}

export async function revokeKeyHandler(request: Request, env: Env, keyId: string): Promise<Response> {
  const context = await authorizePost(request, env);
  if (context instanceof Response) return context;
  const { user, cfg, now } = context;
  if (!(await hasCapacity(env, cfg, now, KEY_REVOKE_WORST_CASE_ROWS))) return capacityResponse();
  const { revoked, rowsWritten } = await revokeApiKey(env.DB, user.id, keyId, now);
  await recordPersonalRows(env, now, rowsWritten);
  if (!revoked) {
    return messageResponse("Key not found", "No active key with that id belongs to your account.", STATUS_NOT_FOUND);
  }
  return redirect(DASHBOARD_PATH, STATUS_SEE_OTHER);
}

export async function logoutHandler(request: Request, env: Env): Promise<Response> {
  const context = await authorizePost(request, env);
  if (context instanceof Response) return context;
  return redirect(LANDING_PATH, STATUS_SEE_OTHER, [clearSessionCookie()]);
}
