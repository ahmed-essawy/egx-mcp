import { describe, expect, it } from "vitest";
import { CRAWLERS, PRIVATE_PREFIXES, robotsTxt, sitemapXml } from "../../src/site/crawl";
import {
  AI_CATALOG_PATH,
  LLMS_FULL_PATH,
  LLMS_PATH,
  markdownPath,
  SERVER_CARD_PATH,
  SITEMAP_PATH,
} from "../../src/site/paths";
import { PAGES } from "../../src/site/pages";
import { TEST_CONTEXT } from "../helpers/site";

const CTX = TEST_CONTEXT;
const ORIGIN = CTX.origin;

const EXPECTED_CRAWLERS = [
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

const RULES = [
  "Allow: /",
  "Allow: /mcp/server-card",
  "Disallow: /dashboard",
  "Disallow: /authorize",
  "Disallow: /callback/",
  "Disallow: /token",
  "Disallow: /register",
  "Disallow: /mcp",
];

const EXPECTED_ROBOTS = `${["User-agent: *", ...RULES].join("\n")}\n\n${[
  ...EXPECTED_CRAWLERS.map((token) => `User-agent: ${token}`),
  ...RULES,
].join("\n")}\n\nSitemap: ${ORIGIN}/sitemap.xml\n`;

const ALLOWED_PATHS = [
  ...PAGES.map((page) => page.path),
  ...PAGES.map((page) => markdownPath(page.path)),
  LLMS_PATH,
  LLMS_FULL_PATH,
  SITEMAP_PATH,
  AI_CATALOG_PATH,
  SERVER_CARD_PATH,
];
const DISALLOWED_PATHS = [
  "/dashboard",
  "/dashboard/login",
  "/authorize",
  "/callback/google",
  "/token",
  "/register",
  "/mcp",
];

type Group = { agents: string[]; rules: { allow: boolean; path: string }[] };

function parseGroups(text: string): Group[] {
  return text
    .split("\n\n")
    .map((block) => block.split("\n"))
    .filter((lines) => lines.some((line) => line.startsWith("User-agent:")))
    .map((lines) => ({
      agents: lines
        .filter((line) => line.startsWith("User-agent:"))
        .map((line) => line.slice("User-agent:".length).trim()),
      rules: lines
        .filter((line) => /^(Allow|Disallow):/.test(line))
        .map((line) => ({ allow: line.startsWith("Allow:"), path: line.slice(line.indexOf(":") + 1).trim() })),
    }));
}

function isAllowed(groups: readonly Group[], agent: string, path: string): boolean {
  const group =
    groups.find((candidate) => candidate.agents.some((name) => name.toLowerCase() === agent.toLowerCase())) ??
    groups.find((candidate) => candidate.agents.includes("*"));
  const matches = (group?.rules ?? []).filter((rule) => rule.path !== "" && path.startsWith(rule.path));
  const longest = Math.max(0, ...matches.map((rule) => rule.path.length));
  const best = matches.filter((rule) => rule.path.length === longest);
  return best.length === 0 || best.some((rule) => rule.allow);
}

describe("robotsTxt", () => {
  const text = robotsTxt(CTX);
  const groups = parseGroups(text);

  it("equals the contract", () => {
    expect(text).toBe(EXPECTED_ROBOTS);
  });

  it("lists every crawler once in research order", () => {
    expect([...CRAWLERS]).toEqual(EXPECTED_CRAWLERS);
    for (const token of CRAWLERS) {
      expect(text.split("\n").filter((line) => line === `User-agent: ${token}`)).toHaveLength(1);
    }
  });

  it("ends with the sitemap line", () => {
    expect(text.trimEnd().split("\n").at(-1)).toBe("Sitemap: https://egx.example.com/sitemap.xml");
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
  });

  it("keeps the private prefixes in the disallow lines", () => {
    expect(PRIVATE_PREFIXES.map((prefix) => `Disallow: ${prefix}`)).toEqual(RULES.slice(2));
  });

  it.each(["*", ...EXPECTED_CRAWLERS])("allows public paths and blocks private ones for %s", (agent) => {
    for (const path of ALLOWED_PATHS) expect(isAllowed(groups, agent, path), `${agent} ${path}`).toBe(true);
    for (const path of DISALLOWED_PATHS) expect(isAllowed(groups, agent, path), `${agent} ${path}`).toBe(false);
  });
});

describe("sitemapXml", () => {
  const xml = sitemapXml(CTX);
  const lines = xml.split("\n");
  const urlLines = lines.filter((line) => line.startsWith("<url>"));

  it("has the declaration, urlset and a closing tag", () => {
    expect(lines[0]).toBe('<?xml version="1.0" encoding="UTF-8"?>');
    expect(lines[1]).toBe(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    );
    expect(lines.at(-2)).toBe("</urlset>");
    expect(xml.endsWith("</urlset>\n")).toBe(true);
  });

  it("lists every page once with its updated date", () => {
    expect(urlLines).toEqual(
      PAGES.map((page) => `<url><loc>${ORIGIN}${page.path}</loc><lastmod>${page.updated}</lastmod></url>`),
    );
    for (const line of urlLines) {
      expect(line).toMatch(
        /^<url><loc>https:\/\/egx\.example\.com\/[a-z0-9/-]*<\/loc><lastmod>\d{4}-\d{2}-\d{2}<\/lastmod><\/url>$/,
      );
    }
  });

  it("holds no twin, no private path and no alternate links yet", () => {
    expect(xml).not.toContain(".md<");
    expect(xml).not.toContain("xhtml:link");
    for (const prefix of PRIVATE_PREFIXES) expect(xml).not.toContain(`${ORIGIN}${prefix}`);
  });

  it("escapes the origin", () => {
    expect(sitemapXml({ ...CTX, origin: "https://egx.example.com/?a=1&b=<2>" })).toContain(
      "<loc>https://egx.example.com/?a=1&amp;b=&lt;2&gt;/</loc>",
    );
  });
});
