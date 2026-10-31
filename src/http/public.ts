import { sha256Hex } from "../domain/crypto";
import { loadConfig, resolvePublicOrigin } from "../config";
import type { SiteContext } from "../site/content-model";
import { robotsTxt, sitemapXml } from "../site/crawl";
import { aiCatalog, serverCard } from "../site/discovery";
import { INDEXNOW_KEY_PATH, SITE } from "../site/identity";
import { PAGES, type PublicPage } from "../site/pages";
import {
  AI_CATALOG_PATH,
  LLMS_FULL_PATH,
  LLMS_PATH,
  markdownPath,
  ROBOTS_PATH,
  SERVER_CARD_PATH,
  SITEMAP_PATH,
} from "../site/paths";
import { renderPageHtml } from "../site/render-html";
import { llmsFullTxt, llmsTxt, renderPageMarkdown } from "../site/render-markdown";
import { internalErrorResponse } from "./responses";
import { exactPath, getAndHead, READ_METHODS, type Route } from "./route";
import { STATUS_MOVED_PERMANENTLY, STATUS_NO_CONTENT, STATUS_NOT_MODIFIED, STATUS_OK } from "./status";
import { DASHBOARD_PATH, mcpUrl, SECURITY_HEADERS } from "./views";

const PUBLIC_CACHE_CONTROL = "public, max-age=3600";
const REDIRECT_CACHE_CONTROL = "public, max-age=86400";
const MARKDOWN_CONTENT_TYPE = "text/markdown; charset=utf-8";
const PLAIN_CONTENT_TYPE = "text/plain; charset=utf-8";
const XML_CONTENT_TYPE = "application/xml; charset=utf-8";
const CATALOG_CONTENT_TYPE = "application/ai-catalog+json";
const SERVER_CARD_CONTENT_TYPE = "application/mcp-server-card+json";
const MARKDOWN_RANGES = ["text/markdown", "text/plain"];
const HTML_RANGES = ["text/html", "application/xhtml+xml", "text/*", "*/*"];
const DEFAULT_QUALITY = 1;

const TEXT_HEADERS: Readonly<Record<string, string>> = {
  "x-content-type-options": "nosniff",
  "cache-control": PUBLIC_CACHE_CONTROL,
};

const DISCOVERY_CORS_HEADERS: Readonly<Record<string, string>> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET",
  "access-control-allow-headers": "Content-Type, If-None-Match",
  "access-control-expose-headers": "ETag",
};
const TRAILING_SLASHES = /\/+$/;
const ETAG_HEX_LENGTH = 32;
const WEAK_PREFIX = /^W\//;
const PREFLIGHT_METHOD = "OPTIONS";
const MATCH_ANY = "*";

export const PUBLIC_HTML_HEADERS: Readonly<Record<string, string>> = {
  ...SECURITY_HEADERS,
  "cache-control": PUBLIC_CACHE_CONTROL,
  vary: "Accept",
};

export function siteContext(request: Request, env: Env): SiteContext | null {
  const origin = resolvePublicOrigin(request, env);
  if (origin === null) return null;
  const { userDailyCalls, globalDailyCalls } = loadConfig(env);
  return {
    origin,
    mcpUrl: mcpUrl(origin),
    dashboardUrl: new URL(DASHBOARD_PATH, origin).href,
    limits: { userDailyCalls, globalDailyCalls },
  };
}

async function etagOf(body: string): Promise<string> {
  return `"${(await sha256Hex(body)).slice(0, ETAG_HEX_LENGTH)}"`;
}

function matchesEtag(ifNoneMatch: string | null, etag: string): boolean {
  if (ifNoneMatch === null) return false;
  const candidates = ifNoneMatch.split(",").map((value) => value.trim().replace(WEAK_PREFIX, ""));
  return candidates.includes(MATCH_ANY) || candidates.includes(etag);
}

export async function publicResponse(
  request: Request,
  body: string,
  headers: Record<string, string>,
): Promise<Response> {
  const etag = await etagOf(body);
  const responseHeaders = { ...headers, etag };
  if (matchesEtag(request.headers.get("if-none-match"), etag)) {
    return new Response(null, { status: STATUS_NOT_MODIFIED, headers: responseHeaders });
  }
  return new Response(request.method === "HEAD" ? null : body, { status: STATUS_OK, headers: responseHeaders });
}

export function htmlPageResponse(request: Request, page: PublicPage, ctx: SiteContext): Promise<Response> {
  const headers = {
    ...PUBLIC_HTML_HEADERS,
    link: `<${ctx.origin}${markdownPath(page.path)}>; rel="alternate"; type="text/markdown"`,
  };
  return publicResponse(request, renderPageHtml(page, ctx), headers);
}

function mediaRangeQualities(accept: string): Map<string, number> {
  const qualities = new Map<string, number>();
  for (const part of accept.split(",")) {
    const [range = "", ...params] = part.split(";").map((piece) => piece.trim().toLowerCase());
    const quality = params.find((param) => param.startsWith("q="));
    const value = quality === undefined ? DEFAULT_QUALITY : Number(quality.slice(2));
    qualities.set(range, Math.max(qualities.get(range) ?? 0, Number.isFinite(value) ? value : 0));
  }
  return qualities;
}

function highestQuality(qualities: Map<string, number>, ranges: readonly string[]): number {
  return Math.max(0, ...ranges.map((range) => qualities.get(range) ?? 0));
}

export function prefersMarkdown(accept: string | null): boolean {
  if (accept === null) return false;
  const qualities = mediaRangeQualities(accept);
  const markdownQuality = highestQuality(qualities, MARKDOWN_RANGES);
  return markdownQuality > 0 && markdownQuality > highestQuality(qualities, HTML_RANGES);
}

function markdownResponse(
  request: Request,
  page: PublicPage,
  ctx: SiteContext,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const headers = {
    ...TEXT_HEADERS,
    ...extraHeaders,
    "content-type": MARKDOWN_CONTENT_TYPE,
    link: `<${ctx.origin}${page.path}>; rel="canonical"`,
  };
  return publicResponse(request, renderPageMarkdown(page, ctx), headers);
}

function contextRoute(path: string, respond: (ctx: SiteContext, request: Request) => Promise<Response>): Route[] {
  return getAndHead(exactPath(path), async (request, env) => {
    const ctx = siteContext(request, env);
    return ctx === null ? internalErrorResponse() : respond(ctx, request);
  });
}

function pageRoute(page: PublicPage): Route[] {
  return contextRoute(page.path, (ctx, request) =>
    prefersMarkdown(request.headers.get("accept"))
      ? markdownResponse(request, page, ctx, { vary: "Accept" })
      : htmlPageResponse(request, page, ctx),
  );
}

function twinRoute(page: PublicPage): Route[] {
  return contextRoute(markdownPath(page.path), (ctx, request) => markdownResponse(request, page, ctx));
}

function textResponse(
  request: Request,
  body: string,
  contentType: string,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  return publicResponse(request, body, { ...TEXT_HEADERS, ...extraHeaders, "content-type": contentType });
}

function textRoute(path: string, contentType: string, render: (ctx: SiteContext) => string): Route[] {
  return contextRoute(path, (ctx, request) => textResponse(request, render(ctx), contentType));
}

function jsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function preflightResponse(): Response {
  return new Response(null, { status: STATUS_NO_CONTENT, headers: DISCOVERY_CORS_HEADERS });
}

export async function serverCardResponse(request: Request, env: Env): Promise<Response | null> {
  if (new URL(request.url).pathname !== SERVER_CARD_PATH) return null;
  if (request.method === PREFLIGHT_METHOD) return preflightResponse();
  if (!READ_METHODS.includes(request.method)) return null;
  const ctx = siteContext(request, env);
  if (ctx === null) return internalErrorResponse();
  return textResponse(request, jsonText(serverCard(ctx)), SERVER_CARD_CONTENT_TYPE, DISCOVERY_CORS_HEADERS);
}

export const PUBLIC_ROUTES: readonly Route[] = [
  ...PAGES.flatMap(pageRoute),
  ...PAGES.flatMap(twinRoute),
  ...textRoute(ROBOTS_PATH, PLAIN_CONTENT_TYPE, robotsTxt),
  ...textRoute(SITEMAP_PATH, XML_CONTENT_TYPE, sitemapXml),
  ...textRoute(LLMS_PATH, PLAIN_CONTENT_TYPE, llmsTxt),
  ...textRoute(LLMS_FULL_PATH, PLAIN_CONTENT_TYPE, llmsFullTxt),
  ...contextRoute(AI_CATALOG_PATH, (ctx, request) =>
    textResponse(request, jsonText(aiCatalog(ctx)), CATALOG_CONTENT_TYPE, DISCOVERY_CORS_HEADERS),
  ),
  { method: PREFLIGHT_METHOD, pattern: exactPath(AI_CATALOG_PATH), handler: preflightResponse },
  ...contextRoute(INDEXNOW_KEY_PATH, (_ctx, request) => textResponse(request, SITE.indexNowKey, PLAIN_CONTENT_TYPE)),
];

const CANONICAL_PATHS: ReadonlySet<string> = new Set(PAGES.flatMap((page) => [page.path, markdownPath(page.path)]));

function canonicalCandidate(pathname: string): string {
  const trimmed = pathname.toLowerCase().replace(TRAILING_SLASHES, "");
  return trimmed === "" ? "/" : trimmed;
}

export function canonicalRedirect(request: Request, env: Env): Response | null {
  if (!READ_METHODS.includes(request.method)) return null;
  const { pathname } = new URL(request.url);
  const candidate = canonicalCandidate(pathname);
  if (candidate === pathname || !CANONICAL_PATHS.has(candidate)) return null;
  const ctx = siteContext(request, env);
  if (ctx === null) return internalErrorResponse();
  return new Response(null, {
    status: STATUS_MOVED_PERMANENTLY,
    headers: { location: `${ctx.origin}${candidate}`, "cache-control": REDIRECT_CACHE_CONTROL },
  });
}
