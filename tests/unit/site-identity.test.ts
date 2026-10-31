import { describe, expect, it } from "vitest";
import wrangler from "../../wrangler.jsonc?raw";
import { INDEXNOW_KEY_PATH, LOCALIZED, RATE_LIMIT_PER_MINUTE, SITE } from "../../src/site/identity";
import { FOOTER_LINKS, markdownPath, PREVIEW_IMAGE_PATH } from "../../src/site/paths";

const NOTICE =
  "Data is delayed, unofficial and for information only, not financial advice. Sources: EGX website, TradingView, Mubasher Info, iSagha.";
const PERSON_FREE_FIELDS = Object.entries(SITE).filter(
  ([key]) => !["repositoryUrl", "issuesUrl", "registryName"].includes(key),
);
const EXPECTED_FOOTER = [
  ["Home", "/"],
  ["Tools", "/tools"],
  ["Connect Claude", "/connect/claude"],
  ["Connect ChatGPT", "/connect/chatgpt"],
  ["Connect Claude Code", "/connect/claude-code"],
  ["Connect Cursor", "/connect/cursor"],
  ["Questions", "/faq"],
  ["Data and limits", "/data"],
  ["Privacy policy", "/privacy"],
  ["Terms of use", "/terms"],
  ["GitHub", SITE.repositoryUrl],
];

describe("site identity", () => {
  it("holds the values of the English copy", () => {
    expect(SITE.name).toBe("EGX MCP");
    expect(SITE.oneLine).toBe(
      "EGX MCP is a free MCP server that lets AI assistants answer questions about Egyptian Exchange stocks, indices and funds with delayed data.",
    );
    expect(SITE.registryDescription).toBe(
      "Delayed Egyptian Exchange (EGX) stocks, indices, funds, gold and USD/EGP data for AI assistants.",
    );
    expect(SITE.issuesUrl).toBe("https://github.com/ahmed-essawy/egx-mcp/issues");
    expect(SITE.registryName).toBe("io.github.ahmed-essawy/egx-mcp");
    expect(SITE.indexNowKey).toBe("c60c57998197b5e5b4a9fc2f935a3c44");
    expect(PREVIEW_IMAGE_PATH).toBe("/og-image.png");
    expect(SITE.previewImageWidth).toBe(1200);
    expect(SITE.previewImageHeight).toBe(630);
    expect(INDEXNOW_KEY_PATH).toBe("/c60c57998197b5e5b4a9fc2f935a3c44.txt");
  });

  it("respects the registry and search length limits", () => {
    expect(SITE.registryDescription.length).toBeLessThanOrEqual(100);
    expect(SITE.shortDescription.length).toBeLessThanOrEqual(160);
    expect(SITE.oneLine.length).toBeLessThanOrEqual(160);
    expect(SITE.registryName).toMatch(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
    expect(SITE.indexNowKey).toMatch(/^[a-f0-9]{32}$/);
  });

  it("names no person", () => {
    for (const [key, value] of PERSON_FREE_FIELDS) {
      const text = Array.isArray(value) ? value.join(" ") : String(value);
      expect(text, key).not.toMatch(/Essawy|gmail|@/);
    }
  });

  it("maps a page path to its Markdown twin path", () => {
    expect(markdownPath("/")).toBe("/index.md");
    expect(markdownPath("/tools")).toBe("/tools.md");
    expect(markdownPath("/ar")).toBe("/ar.md");
  });

  it("lists the English footer links in order, ending with GitHub", () => {
    expect(FOOTER_LINKS.en.map((link) => [link.label, link.href])).toEqual(EXPECTED_FOOTER);
  });

  it("keeps the rate limit equal to the wrangler configuration", () => {
    const config = JSON.parse(wrangler) as { ratelimits: { simple: { limit: number } }[] };
    expect(RATE_LIMIT_PER_MINUTE).toBe(config.ratelimits[0]?.simple.limit);
  });

  it("holds the English localized text", () => {
    expect(LOCALIZED.en).toEqual({
      affiliation: "Independent service, not affiliated with the Egyptian Exchange.",
      skipLink: "Skip to main content",
      notice: NOTICE,
      homeLabel: "Home",
      breadcrumbLabel: "Breadcrumb",
      relatedHeading: "Related pages",
      lastUpdated: "Last updated",
    });
  });
});
