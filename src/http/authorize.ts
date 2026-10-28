import { AuthorizationError, authorizationErrorRedirect, CimdFetchError } from "@cloudflare/workers-oauth-provider";
import { API_KEY_SCOPES } from "../auth/api-keys";
import { exchangeGoogleCode, googleAuthUrl, pkcePair } from "../auth/google";
import { loadConfig, resolvePublicOrigin } from "../config";
import { nowSeconds } from "../domain/calendar";
import { capacityResponse, messageResponse, redirect } from "./responses";
import { accountDeletedResponse, signInGoogleUser } from "./sign-in";
import { STATUS_BAD_GATEWAY, STATUS_BAD_REQUEST, STATUS_FOUND, STATUS_INTERNAL_ERROR, STATUS_OK } from "./status";
import { consentView, HTML_HEADERS } from "./views";

const CALLBACK_PATH = "/callback/google";
const READ_SCOPE = "mcp:read";
const FRAME_OPTIONS_DENY = "DENY";
const SET_COOKIE_HEADER = "set-cookie";
const APPROVE_DECISION = "approve";
const ACCESS_DENIED = "access_denied";
const REQUEST_REFUSED_TITLE = "Authorization request refused";
const REQUEST_EXPIRED_TEXT = "This authorization request is invalid or has expired. Start again from your AI assistant.";
const CLIENT_UNVERIFIED_TEXT = "The app asking for access could not be verified. Start again from your AI assistant.";
const SIGN_IN_FAILED_TITLE = "Sign-in failed";
const SIGN_IN_FAILED_TEXT = "Sign-in could not be completed. Start again from your AI assistant.";

type UpstreamData = { verifier: string };

export function grantedScopes(requested: string[]): string[] {
  if (requested.length === 0) return [...API_KEY_SCOPES];
  const supported = requested.filter((scope) => API_KEY_SCOPES.includes(scope));
  return supported.length > 0 ? supported : [READ_SCOPE];
}

function consentResponse(html: string, consentHeaders: Headers): Response {
  const headers = new Headers(HTML_HEADERS);
  for (const [name, value] of consentHeaders) {
    if (name === SET_COOKIE_HEADER) headers.append(name, value);
  }
  headers.set("x-frame-options", FRAME_OPTIONS_DENY);
  return new Response(html, { status: STATUS_OK, headers });
}

function redirectWithHeaders(headers: Headers, location: string): Response {
  headers.set("location", location);
  return new Response(null, { status: STATUS_FOUND, headers });
}

function authorizationFailure(error: unknown): Response {
  if (error instanceof AuthorizationError) {
    if (error.redirectTo !== undefined) return redirect(error.redirectTo, STATUS_FOUND);
    return messageResponse(REQUEST_REFUSED_TITLE, REQUEST_EXPIRED_TEXT, STATUS_BAD_REQUEST);
  }
  if (error instanceof CimdFetchError) {
    return messageResponse(REQUEST_REFUSED_TITLE, CLIENT_UNVERIFIED_TEXT, STATUS_BAD_REQUEST);
  }
  throw error;
}

async function guarded(action: () => Promise<Response>): Promise<Response> {
  try {
    return await action();
  } catch (error) {
    return authorizationFailure(error);
  }
}

function unconfiguredResponse(): Response {
  return messageResponse("Sign-in unavailable", "The service is not configured.", STATUS_INTERNAL_ERROR);
}

export function authorizeHandler(request: Request, env: Env): Promise<Response> {
  return guarded(async () => {
    const authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
    const details = await env.OAUTH_PROVIDER.describeConsent(authRequest);
    const consent = await env.OAUTH_PROVIDER.beginConsent(authRequest);
    const html = consentView({
      clientName: details.clientName,
      clientDomain: details.clientDomain,
      redirectHost: details.redirectHost,
      redirectIsLoopback: details.redirectIsLoopback,
      scopes: grantedScopes(authRequest.scope),
      handle: consent.handle,
    });
    return consentResponse(html, consent.headers);
  });
}

export function authorizeDecisionHandler(request: Request, env: Env): Promise<Response> {
  return guarded(async () => {
    const origin = resolvePublicOrigin(request, env);
    if (origin === null) return unconfiguredResponse();
    const form = await request.formData();
    const handle = String(form.get("handle") ?? "");
    if (form.get("decision") !== APPROVE_DECISION) {
      const denied = await env.OAUTH_PROVIDER.denyConsent(request, handle);
      return new Response(null, { status: STATUS_FOUND, headers: denied.headers });
    }
    const approved = await env.OAUTH_PROVIDER.approveConsent(request, handle);
    const { verifier, challenge } = await pkcePair();
    const upstream = await env.OAUTH_PROVIDER.beginUpstream(approved.request, {
      data: { verifier } satisfies UpstreamData,
      headers: approved.headers,
    });
    const location = googleAuthUrl({
      clientId: env.GOOGLE_CLIENT_ID,
      redirectUri: `${origin}${CALLBACK_PATH}`,
      state: upstream.state,
      codeChallenge: challenge,
    });
    return redirectWithHeaders(upstream.headers, location);
  });
}

export function googleCallbackHandler(request: Request, env: Env): Promise<Response> {
  return guarded(async () => {
    const origin = resolvePublicOrigin(request, env);
    if (origin === null) return unconfiguredResponse();
    const resumed = await env.OAUTH_PROVIDER.finishUpstream<UpstreamData>(request);
    const { request: original, data, headers } = resumed;
    const cookies = headers.getSetCookie();
    const params = new URL(request.url).searchParams;
    const code = params.get("code");
    if (params.has("error") || code === null) {
      return redirectWithHeaders(headers, authorizationErrorRedirect(original, ACCESS_DENIED));
    }
    const identity = await exchangeGoogleCode(env, {
      code,
      redirectUri: `${origin}${CALLBACK_PATH}`,
      codeVerifier: data.verifier,
    }).catch(() => null);
    if (identity === null) return messageResponse(SIGN_IN_FAILED_TITLE, SIGN_IN_FAILED_TEXT, STATUS_BAD_GATEWAY, cookies);
    const signIn = await signInGoogleUser(env, loadConfig(env), identity, nowSeconds());
    if (signIn.kind === "capacity") return capacityResponse(cookies);
    if (signIn.kind === "deleted") return accountDeletedResponse(cookies);
    const { id } = signIn;
    const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
      request: original,
      userId: id,
      metadata: {},
      scope: grantedScopes(original.scope),
      props: { userId: id, email: identity.email, via: "oauth" },
    });
    return redirectWithHeaders(headers, redirectTo);
  });
}
