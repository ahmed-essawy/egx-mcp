import { generateApiKey, hashApiKey } from "../auth/api-keys";
import { exchangeGoogleCode, googleAuthUrl, pkcePair } from "../auth/google";
import { checkPost, clearSessionCookie, createSessionCookie, readCookie, readSession } from "../auth/session";
import { loadConfig, parseOrigin, type Config } from "../config";
import { toBase64Url } from "../domain/crypto";
import { nowSeconds, utcDay } from "../domain/calendar";
import { readToolUsage } from "../store/d1/usage";
import {
  MAX_ACTIVE_KEYS,
  accountRowsUpperBound,
  createApiKey,
  deleteAccount,
  getUser,
  listApiKeys,
  revokeApiKey,
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
} from "./status";
import { capacityResponse, messageResponse, redirect } from "./responses";
import { accountDeletedResponse, hasCapacity, recordPersonalRows, signInGoogleUser } from "./sign-in";
import { DASHBOARD_PATH, KEY_NAME_MAX_LENGTH, dashboardView, htmlResponse } from "./views";

const LOGIN_COOKIE_NAME = "__Host-egx_login";
const LOGIN_COOKIE_SECONDS = 600;
const LOGIN_COOKIE_ATTRIBUTES = "Path=/; Secure; HttpOnly; SameSite=Lax";
const LOGIN_SEPARATOR = ".";
const STATE_BYTES = 32;
const CALLBACK_PATH = "/dashboard/callback";
const LANDING_PATH = "/";
const LOGIN_PATH = "/dashboard/login";
const KEY_CREATE_WORST_CASE_ROWS = 5;
const KEY_REVOKE_WORST_CASE_ROWS = 3;
const KEY_LIMIT_MESSAGE = `You already have ${MAX_ACTIVE_KEYS} active keys. Revoke one to create another.`;
const KEY_NAME_MESSAGE = `Enter a key name of 1 to ${KEY_NAME_MAX_LENGTH} characters.`;
const CONFIRM_MESSAGE = "Type your email address exactly to confirm deleting your account.";
const ACCOUNT_DELETED_TITLE = "Account deleted";
const ACCOUNT_REMOVED_MESSAGE =
  "Your account, API keys, holdings, price levels and usage records were deleted, and your assistant connections were revoked.";
const SIGN_IN_FAILED_MESSAGE = "Sign-in could not be completed. Please try again.";

type Viewer = { user: User; csrf: string; now: number };
type PostContext = Viewer & { cfg: Config };
type Configured = { cfg: Config; origin: string };

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
  const signIn = await signInGoogleUser(env, cfg, identity, now);
  if (signIn.kind === "capacity") return capacityResponse([clearLoginCookie()]);
  if (signIn.kind === "deleted") return accountDeletedResponse([clearLoginCookie()]);
  return redirect(DASHBOARD_PATH, STATUS_FOUND, [await createSessionCookie(env, signIn.id, now), clearLoginCookie()]);
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

async function revokeOAuthGrants(env: Env, userId: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await env.OAUTH_PROVIDER.listUserGrants(userId, { cursor });
    for (const grant of page.items) await env.OAUTH_PROVIDER.revokeGrant(grant.id, userId);
    cursor = page.cursor;
  } while (cursor !== undefined);
}

export async function deleteAccountHandler(request: Request, env: Env): Promise<Response> {
  const context = await authorizePost(request, env);
  if (context instanceof Response) return context;
  const { user, cfg, now } = context;
  const confirm = String((await request.formData()).get("confirm") ?? "").trim();
  if (confirm !== user.email) return renderDashboard(env, context, STATUS_BAD_REQUEST, { error: CONFIRM_MESSAGE });
  const worstCaseRows = await accountRowsUpperBound(env.DB, user.id);
  if (!(await hasCapacity(env, cfg, now, worstCaseRows))) return capacityResponse();
  await revokeOAuthGrants(env, user.id);
  const { rowsWritten } = await deleteAccount(env.DB, user.id);
  await recordPersonalRows(env, now, rowsWritten);
  return messageResponse(ACCOUNT_DELETED_TITLE, ACCOUNT_REMOVED_MESSAGE, STATUS_OK, [clearSessionCookie()]);
}

export async function logoutHandler(request: Request, env: Env): Promise<Response> {
  const context = await authorizePost(request, env);
  if (context instanceof Response) return context;
  return redirect(LANDING_PATH, STATUS_SEE_OTHER, [clearSessionCookie()]);
}
