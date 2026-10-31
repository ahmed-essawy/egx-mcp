import { describe, expect, it } from "vitest";
import { NOTICE } from "../../src/mcp/envelope";
import { TOOL_NAMES } from "../../src/mcp/tool-names";
import { escapeHtml } from "../../src/http/views";
import { serverCard } from "../../src/site/discovery";
import { SITE } from "../../src/site/identity";
import { markdownPath } from "../../src/site/paths";
import { PAGES, type PublicPage } from "../../src/site/pages";
import { sitemapXml } from "../../src/site/crawl";
import { renderPageHtml } from "../../src/site/render-html";
import { llmsTxt, renderPageMarkdown } from "../../src/site/render-markdown";
import { toolEntries } from "../../src/site/tool-catalog";
import { createNodeStores, listNodeTools } from "../helpers/node-mcp";
import { TEST_CONTEXT } from "../helpers/site";

const CTX = TEST_CONTEXT;
const TOOLS_HTML_PATTERN = /<h3><code>([^<]+)<\/code><\/h3>/g;
const TOOLS_TWIN_PATTERN = /^### `([^`]+)`$/gm;
const LLMS_TOOL_PATTERN = /^- `([^`]+)`: /gm;
const TITLE_PATTERN = /<title>([^<]*)<\/title>/;
const DESCRIPTION_PATTERN = /<meta name="description" content="([^"]*)">/;
const LISTED_KINDS: readonly PublicPage["kind"][] = ["home", "content", "guide", "faq"];
const META_TOOLS_KEY = `${SITE.registryName.split("/")[0]}/tools`;

function captures(pattern: RegExp, text: string): string[] {
  return Array.from(text.matchAll(pattern), (match) => match[1] ?? "");
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

function pageById(id: string): PublicPage {
  const page = PAGES.find((candidate) => candidate.id === id);
  if (page === undefined) throw new Error(`no page ${id}`);
  return page;
}

describe("tool lists agree", () => {
  const toolsPage = pageById("tools");
  const registered = listNodeTools(createNodeStores().env);

  it("registers every catalog tool and no other", async () => {
    expect(sorted((await registered).map((tool) => tool.name))).toEqual(sorted(TOOL_NAMES));
  });

  it("registers each catalog description followed by the notice", async () => {
    const descriptions = new Map(toolEntries().map((entry) => [entry.name, entry.description]));
    for (const tool of await registered) {
      expect(tool.description).toBe(`${descriptions.get(tool.name as (typeof TOOL_NAMES)[number])} ${NOTICE}`);
    }
  });

  it("lists the same tools in the /tools HTML, the twin, llms.txt and the server card", async () => {
    const expected = sorted((await registered).map((tool) => tool.name));
    const cardTools = (serverCard(CTX)._meta[META_TOOLS_KEY] as readonly { name: string }[]).map((tool) => tool.name);
    expect(sorted(captures(TOOLS_HTML_PATTERN, renderPageHtml(toolsPage, CTX)))).toEqual(expected);
    expect(sorted(captures(TOOLS_TWIN_PATTERN, renderPageMarkdown(toolsPage, CTX)))).toEqual(expected);
    expect(sorted(captures(LLMS_TOOL_PATTERN, llmsTxt(CTX).split("## Tools")[1]?.split("## Optional")[0] ?? ""))).toEqual(expected);
    expect(sorted(cardTools)).toEqual(expected);
  });

  it("states the tool count on the home page", () => {
    const html = renderPageHtml(pageById("home"), CTX);
    expect(html).toContain(`all ${TOOL_NAMES.length} tools and what they return`);
  });
});

describe("page metadata agrees", () => {
  it.each(PAGES.map((page) => [page.path, page] as const))("%s head matches PAGES", (_path, page) => {
    const html = renderPageHtml(page, CTX);
    expect(TITLE_PATTERN.exec(html)?.[1]).toBe(escapeHtml(page.title(CTX)));
    expect(DESCRIPTION_PATTERN.exec(html)?.[1]).toBe(escapeHtml(page.description));
  });

  it.each(PAGES.map((page) => [page.path, page] as const))("%s sitemap entry matches PAGES", (_path, page) => {
    expect(sitemapXml(CTX)).toContain(`<url><loc>${CTX.origin}${page.path}</loc><lastmod>${page.updated}</lastmod></url>`);
  });

  it.each(PAGES.filter((page) => LISTED_KINDS.includes(page.kind)).map((page) => [page.path, page] as const))(
    "%s llms.txt line matches PAGES",
    (_path, page) => {
      expect(llmsTxt(CTX)).toContain(`[${page.title(CTX)}](${CTX.origin}${markdownPath(page.path)}): ${page.description}`);
    },
  );
});
