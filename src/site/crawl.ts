import type { SiteContext } from "./content-model";
import { PAGES } from "./pages";
import { SERVER_CARD_PATH, SITEMAP_PATH } from "./paths";

export const CRAWLERS: readonly string[] = [
  "Googlebot",
  "Bingbot",
  "Applebot",
  "DuckDuckBot",
  "YandexBot",
  "Amzn-SearchBot",
  "OAI-SearchBot",
  "Claude-SearchBot",
  "PerplexityBot",
  "DuckAssistBot",
  "GoogleOther",
  "GPTBot",
  "ClaudeBot",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
  "Meta-ExternalAgent",
  "Amazonbot",
  "Bytespider",
  "cohere-ai",
  "MistralAI-Training",
  "ChatGPT-User",
  "Claude-User",
  "Perplexity-User",
  "Meta-ExternalFetcher",
  "MistralAI-User",
  "Amzn-User",
];

export const PRIVATE_PREFIXES: readonly string[] = [
  "/dashboard",
  "/authorize",
  "/callback/",
  "/token",
  "/register",
  "/mcp",
];

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
const URLSET_OPEN =
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">';
const XML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

const ROBOTS_RULES: readonly string[] = [
  "Allow: /",
  `Allow: ${SERVER_CARD_PATH}`,
  ...PRIVATE_PREFIXES.map((prefix) => `Disallow: ${prefix}`),
];

function xmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (character) => XML_ESCAPES[character] ?? character);
}

function robotsGroup(agents: readonly string[]): string {
  return [...agents.map((agent) => `User-agent: ${agent}`), ...ROBOTS_RULES].join("\n");
}

export function robotsTxt(ctx: SiteContext): string {
  return `${robotsGroup(["*"])}\n\n${robotsGroup(CRAWLERS)}\n\nSitemap: ${ctx.origin}${SITEMAP_PATH}\n`;
}

export function sitemapXml(ctx: SiteContext): string {
  const urls = PAGES.map(
    (page) => `<url><loc>${xmlEscape(`${ctx.origin}${page.path}`)}</loc><lastmod>${page.updated}</lastmod></url>`,
  );
  return [XML_DECLARATION, URLSET_OPEN, ...urls, "</urlset>"].join("\n") + "\n";
}
