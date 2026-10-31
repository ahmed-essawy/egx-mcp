import { describe, expect, it } from "vitest";
import descriptions from "../../docs/listing/descriptions.md?raw";
import serverJson from "../../docs/listing/server.json?raw";
import { escapeHtml } from "../../src/http/views";
import { NOTICE } from "../../src/mcp/envelope";
import { robotsTxt, sitemapXml } from "../../src/site/crawl";
import { aiCatalog, serverCard } from "../../src/site/discovery";
import { LOCALIZED, SITE } from "../../src/site/identity";
import { PAGES, type PublicPage } from "../../src/site/pages";
import { renderPageHtml } from "../../src/site/render-html";
import { llmsFullTxt, llmsTxt, renderPageMarkdown } from "../../src/site/render-markdown";
import { TEST_CONTEXT } from "../helpers/site";

const CTX = TEST_CONTEXT;
const NOTICE_PARAGRAPH = `<p class="notice">${escapeHtml(LOCALIZED.en.notice)}</p>`;
const NOTICE_KINDS: readonly PublicPage["kind"][] = ["home", "content", "guide", "faq"];
const TAG_PATTERN = /<[^>]*>/g;
const NUMERIC_ENTITY_PATTERN = /&#(x[0-9a-f]+|\d+);/gi;
const NAMED_ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const NAMED_ENTITY_PATTERN = /&(amp|lt|gt|quot|apos);/g;
const HEX_RADIX = 16;
const DECIMAL_RADIX = 10;

const BANNED_PATTERNS: readonly RegExp[] = [
  /real[- ]?time/i,
  /\bbuy\b/i,
  /\bsell\b/i,
  /\bhold\b/i,
  /recommend/i,
  /endorsed by/i,
  /\bofficial (data|source|partner|feed)/i,
  /live price/i,
  /affiliated with/i,
];

const ALLOWED_PHRASES: readonly string[] = [
  "Is the data real-time?",
  "Is EGX MCP affiliated with the Egyptian Exchange?",
  "It is not real-time",
  "not real-time",
  "buy, sell or hold recommendation",
  "buy and sell prices",
  "bought",
  "not affiliated with, endorsed by or sponsored by the Egyptian Exchange",
  "not affiliated with the Egyptian Exchange",
  "It does not show live prices on this website",
  "Check an official source before acting",
];

function decodeEntities(text: string): string {
  return text
    .replace(NUMERIC_ENTITY_PATTERN, (_match, code: string) =>
      String.fromCodePoint(code.startsWith("x") || code.startsWith("X") ? parseInt(code.slice(1), HEX_RADIX) : parseInt(code, DECIMAL_RADIX)),
    )
    .replace(NAMED_ENTITY_PATTERN, (_match, name: string) => NAMED_ENTITIES[name] ?? _match);
}

function visibleText(source: string): string {
  return decodeEntities(source.replace(TAG_PATTERN, " "));
}

function withoutAllowedPhrases(text: string): string {
  return ALLOWED_PHRASES.reduce((remaining, phrase) => remaining.split(phrase).join(" "), text);
}

function bannedMatches(source: string): string[] {
  const text = withoutAllowedPhrases(visibleText(source));
  return BANNED_PATTERNS.flatMap((pattern) => {
    const match = pattern.exec(text);
    return match === null ? [] : [`${pattern}: ...${text.slice(Math.max(0, match.index - 30), match.index + 40)}...`];
  });
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

type PublicText = { label: string; text: string };

const publicTexts: readonly PublicText[] = [
  ...PAGES.flatMap((page) => [
    { label: `${page.path} html`, text: renderPageHtml(page, CTX) },
    { label: `${page.path} twin`, text: renderPageMarkdown(page, CTX) },
  ]),
  { label: "robots.txt", text: robotsTxt(CTX) },
  { label: "sitemap.xml", text: sitemapXml(CTX) },
  { label: "llms.txt", text: llmsTxt(CTX) },
  { label: "llms-full.txt", text: llmsFullTxt(CTX) },
  { label: "server card", text: json(serverCard(CTX)) },
  { label: "ai catalog", text: json(aiCatalog(CTX)) },
  { label: "listing descriptions", text: descriptions },
  { label: "listing server.json", text: serverJson },
];

describe("content honesty", () => {
  it.each(publicTexts.map(({ label, text }) => [label, text] as const))("%s has no banned wording", (_label, text) => {
    expect(bannedMatches(text)).toEqual([]);
  });

  it.each([
    "Live prices from the exchange",
    "Real-time quotes",
    "realtime data",
    "We recommend this stock",
    "You should buy now",
    "Time to SELL",
    "Hold the position",
    "Official data from the exchange",
    "We are affiliated with the exchange",
    "Endorsed by the exchange",
    "Official feed",
  ])("catches %s", (sample) => {
    expect(bannedMatches(`<p>${sample}</p>`)).not.toEqual([]);
  });

  it("allows the negations and decodes entities before checking", () => {
    expect(bannedMatches("<p>It is not real-time. Check an official source before acting.</p>")).toEqual([]);
    expect(bannedMatches("<p>Buy&#32;now, then sell&nbsp;later</p>")).not.toEqual([]);
    expect(bannedMatches("<p>buy &amp; sell</p>")).not.toEqual([]);
  });

  it("does not let a word hide inside a longer word", () => {
    expect(bannedMatches("<p>household, holder, purchase, buyer, seller</p>")).toEqual([]);
  });

  it.each(PAGES.filter((page) => NOTICE_KINDS.includes(page.kind)).map((page) => [page.path, page] as const))(
    "%s carries the notice paragraph",
    (_path, page) => {
      expect(renderPageHtml(page, CTX)).toContain(NOTICE_PARAGRAPH);
    },
  );

  it.each([
    ["llms.txt", llmsTxt(CTX)],
    ["llms-full.txt", llmsFullTxt(CTX)],
    ["server card", json(serverCard(CTX))],
    ["ai catalog", json(aiCatalog(CTX))],
  ])("%s carries the data limits or the notice", (_label, text) => {
    expect(text.includes(JSON.stringify(SITE.dataLimits).slice(1, -1)) || text.includes(NOTICE)).toBe(true);
  });
});
