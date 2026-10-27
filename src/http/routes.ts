import { resolvePublicOrigin } from "../config";
import {
  callbackHandler,
  createKeyHandler,
  dashboardHandler,
  loginHandler,
  logoutHandler,
  revokeKeyHandler,
} from "./dashboard";
import { privacyView, termsView } from "./legal";
import { STATUS_INTERNAL_ERROR, STATUS_NOT_FOUND, STATUS_NOT_IMPLEMENTED, STATUS_OK } from "./status";
import { HTML_HEADERS, htmlResponse, landingView, mcpUrl, messageView, STYLESHEET } from "./views";

const CSS_CACHE_CONTROL = "public, max-age=300";
const CSS_CONTENT_TYPE = "text/css; charset=utf-8";
const SIGN_IN_UNAVAILABLE_TITLE = "Sign-in not available yet";
const SIGN_IN_UNAVAILABLE_TEXT = "Sign-in for AI assistants is not available yet. Use an API key from the dashboard instead.";

type RouteHandler = (request: Request, env: Env, params: string[]) => Response | Promise<Response>;
type Route = { method: string; pattern: RegExp; handler: RouteHandler };

function stylesheetResponse(): Response {
  return new Response(STYLESHEET, { headers: { ...HTML_HEADERS, "content-type": CSS_CONTENT_TYPE, "cache-control": CSS_CACHE_CONTROL } });
}

function landingResponse(request: Request, env: Env): Response {
  const origin = resolvePublicOrigin(request, env);
  if (origin === null) return internalErrorResponse();
  return htmlResponse(landingView(mcpUrl(origin)), STATUS_OK);
}

function signInUnavailableResponse(): Response {
  return htmlResponse(messageView(SIGN_IN_UNAVAILABLE_TITLE, SIGN_IN_UNAVAILABLE_TEXT), STATUS_NOT_IMPLEMENTED);
}

function notFoundResponse(): Response {
  return htmlResponse(messageView("Page not found", "There is nothing at this address."), STATUS_NOT_FOUND);
}

export function internalErrorResponse(): Response {
  return htmlResponse(messageView("Something went wrong", "The request could not be completed."), STATUS_INTERNAL_ERROR);
}

const ROUTES: Route[] = [
  { method: "GET", pattern: /^\/$/, handler: landingResponse },
  { method: "GET", pattern: /^\/styles\.css$/, handler: stylesheetResponse },
  { method: "GET", pattern: /^\/privacy$/, handler: () => htmlResponse(privacyView(), STATUS_OK) },
  { method: "GET", pattern: /^\/terms$/, handler: () => htmlResponse(termsView(), STATUS_OK) },
  { method: "GET", pattern: /^\/dashboard\/login$/, handler: loginHandler },
  { method: "GET", pattern: /^\/dashboard\/callback$/, handler: callbackHandler },
  { method: "GET", pattern: /^\/dashboard$/, handler: dashboardHandler },
  { method: "POST", pattern: /^\/dashboard\/keys$/, handler: createKeyHandler },
  {
    method: "POST",
    pattern: /^\/dashboard\/keys\/([^/]+)\/revoke$/,
    handler: (request, env, [keyId = ""]) => revokeKeyHandler(request, env, keyId),
  },
  { method: "POST", pattern: /^\/dashboard\/logout$/, handler: logoutHandler },
  { method: "GET", pattern: /^\/authorize$/, handler: signInUnavailableResponse },
  { method: "POST", pattern: /^\/authorize$/, handler: signInUnavailableResponse },
  { method: "GET", pattern: /^\/callback\/google$/, handler: signInUnavailableResponse },
];

export const defaultHandler: ExportedHandler<Env> = {
  async fetch(request, env) {
    try {
      const { pathname } = new URL(request.url);
      for (const route of ROUTES) {
        const match = route.method === request.method ? route.pattern.exec(pathname) : null;
        if (match !== null) return await route.handler(request, env, match.slice(1));
      }
      return notFoundResponse();
    } catch (error) {
      console.error("request_failed", error instanceof Error ? error.message : "unknown");
      return internalErrorResponse();
    }
  },
};
