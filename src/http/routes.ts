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
import { canonicalRedirect, PUBLIC_ROUTES } from "./public";
import { internalErrorResponse } from "./responses";
import { exactPath, type Route } from "./route";
import { STATUS_NOT_FOUND } from "./status";
import { htmlResponse, messageView, SECURITY_HEADERS, STYLESHEET } from "./views";

const CSS_CACHE_CONTROL = "public, max-age=300";
const CSS_CONTENT_TYPE = "text/css; charset=utf-8";
const ICON_CACHE_CONTROL = "public, max-age=86400";
const IMAGE_HEADERS: Record<string, string> = {
  "cache-control": ICON_CACHE_CONTROL,
  "x-content-type-options": "nosniff",
  "access-control-allow-origin": "*",
};

function stylesheetResponse(): Response {
  return new Response(STYLESHEET, { headers: { ...SECURITY_HEADERS, "content-type": CSS_CONTENT_TYPE, "cache-control": CSS_CACHE_CONTROL } });
}

function iconResponse(icon: IconAsset): Response {
  return new Response(icon.body, { headers: { ...IMAGE_HEADERS, "content-type": icon.contentType } });
}

function notFoundResponse(): Response {
  return htmlResponse(messageView("Page not found", "There is nothing at this address."), STATUS_NOT_FOUND);
}

const ICON_ROUTES: Route[] = [...ICONS].map(([path, icon]) => ({
  method: "GET",
  pattern: exactPath(path),
  handler: () => iconResponse(icon),
}));

const ROUTES: Route[] = [
  ...PUBLIC_ROUTES,
  { method: "GET", pattern: /^\/styles\.css$/, handler: stylesheetResponse },
  ...ICON_ROUTES,
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
      return canonicalRedirect(request, env) ?? notFoundResponse();
    } catch (error) {
      console.error("request_failed", error instanceof Error ? error.message : "unknown");
      return internalErrorResponse();
    }
  },
};
