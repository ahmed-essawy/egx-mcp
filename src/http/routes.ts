import { resolvePublicOrigin } from "../config";
import { authorizeDecisionHandler, authorizeHandler, googleCallbackHandler } from "./authorize";
import {
  callbackHandler,
  createKeyHandler,
  dashboardHandler,
  deleteAccountHandler,
  loginHandler,
  logoutHandler,
  revokeKeyHandler,
} from "./dashboard";
import { ICONS, type IconAsset } from "./icons";
import { privacyView, termsView } from "./legal";
import { STATUS_INTERNAL_ERROR, STATUS_NOT_FOUND, STATUS_OK } from "./status";
import { HTML_HEADERS, htmlResponse, landingView, mcpUrl, messageView, STYLESHEET } from "./views";

const CSS_CACHE_CONTROL = "public, max-age=300";
const CSS_CONTENT_TYPE = "text/css; charset=utf-8";
const ICON_CACHE_CONTROL = "public, max-age=86400";
const REGEX_METACHARACTERS = /[.*+?^${}()|[\]\\]/g;

type RouteHandler = (request: Request, env: Env, params: string[]) => Response | Promise<Response>;
type Route = { method: string; pattern: RegExp; handler: RouteHandler };

function stylesheetResponse(): Response {
  return new Response(STYLESHEET, { headers: { ...HTML_HEADERS, "content-type": CSS_CONTENT_TYPE, "cache-control": CSS_CACHE_CONTROL } });
}

function iconResponse(icon: IconAsset): Response {
  return new Response(icon.body, { headers: { ...HTML_HEADERS, "content-type": icon.contentType, "cache-control": ICON_CACHE_CONTROL } });
}

function exactPath(path: string): RegExp {
  return new RegExp(`^${path.replace(REGEX_METACHARACTERS, "\\$&")}$`);
}

function landingResponse(request: Request, env: Env): Response {
  const origin = resolvePublicOrigin(request, env);
  if (origin === null) return internalErrorResponse();
  return htmlResponse(landingView(mcpUrl(origin)), STATUS_OK);
}

function notFoundResponse(): Response {
  return htmlResponse(messageView("Page not found", "There is nothing at this address."), STATUS_NOT_FOUND);
}

export function internalErrorResponse(): Response {
  return htmlResponse(messageView("Something went wrong", "The request could not be completed."), STATUS_INTERNAL_ERROR);
}

const ICON_ROUTES: Route[] = [...ICONS].map(([path, icon]) => ({
  method: "GET",
  pattern: exactPath(path),
  handler: () => iconResponse(icon),
}));

const ROUTES: Route[] = [
  { method: "GET", pattern: /^\/$/, handler: landingResponse },
  { method: "GET", pattern: /^\/styles\.css$/, handler: stylesheetResponse },
  ...ICON_ROUTES,
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
  { method: "POST", pattern: /^\/dashboard\/account\/delete$/, handler: deleteAccountHandler },
  { method: "POST", pattern: /^\/dashboard\/logout$/, handler: logoutHandler },
  { method: "GET", pattern: /^\/authorize$/, handler: authorizeHandler },
  { method: "POST", pattern: /^\/authorize$/, handler: authorizeDecisionHandler },
  { method: "GET", pattern: /^\/callback\/google$/, handler: googleCallbackHandler },
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
