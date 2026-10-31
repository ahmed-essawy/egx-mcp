import { describe, expect, it } from "vitest";
import { PRIVACY_SECTIONS, TERMS_SECTIONS } from "../../src/http/legal";
import { BEARER_HEADER, CONNECT_NOTE, VALUE_LINE } from "../../src/http/views";
import { LOCALIZED, SITE } from "../../src/site/identity";
import { markdownPath } from "../../src/site/paths";
import { PAGES, type PublicPage } from "../../src/site/pages";
import { llmsFullTxt, llmsTxt, renderPageMarkdown } from "../../src/site/render-markdown";
import { toolEntries } from "../../src/site/tool-catalog";
import { TEST_CONTEXT } from "../helpers/site";

const CTX = TEST_CONTEXT;
const ORIGIN = CTX.origin;
const ANCHOR_PATTERN = /<a href="([^"]*)">([^<]*)<\/a>/g;
const LISTED_KINDS: readonly PublicPage["kind"][] = ["home", "content", "guide", "faq"];
const OPTIONAL_LINES = [
  `- [Full content](${ORIGIN}/llms-full.txt): Every page, the tool list and the questions and answers in one file`,
  `- [MCP server card](${ORIGIN}/mcp/server-card): Machine-readable server address, transport and sign-in`,
  `- [AI catalog](${ORIGIN}/.well-known/ai-catalog.json): Discovery entry for the MCP server card`,
];

const listedPages = PAGES.filter((page) => LISTED_KINDS.includes(page.kind));
const legalPages = PAGES.filter((page) => page.kind === "legal");
const newestUpdated = PAGES.map((page) => page.updated).sort().at(-1) ?? "";

function twin(page: PublicPage): string {
  return renderPageMarkdown(page, CTX);
}

function pageById(id: string): PublicPage {
  const page = PAGES.find((candidate) => candidate.id === id);
  if (page === undefined) throw new Error(`no page ${id}`);
  return page;
}

function bodyOf(page: PublicPage): string {
  const markdown = twin(page);
  const afterHeading = markdown.slice(markdown.indexOf("\n\n") + 2);
  return afterHeading.slice(0, afterHeading.indexOf("\n\nCanonical:"));
}

function pageLine(page: PublicPage, path: string): string {
  return `- [${page.title(CTX)}](${ORIGIN}${path}): ${page.description}`;
}

function bulletLines(text: string): string[] {
  return text.split("\n").filter((line) => line.startsWith("- "));
}

describe("renderPageMarkdown", () => {
  it.each(PAGES.map((page) => [page.id, page] as const))("%s starts with its heading and ends with the canonical lines", (_id, page) => {
    const markdown = twin(page);
    expect(markdown.startsWith(`# ${page.heading}\n\n`)).toBe(true);
    expect(markdown.endsWith(`\n\nCanonical: ${ORIGIN}${page.path}\n${LOCALIZED.en.lastUpdated}: ${page.updated}\n`)).toBe(true);
    expect(markdown.endsWith("\n\n")).toBe(false);
    expect(markdown).not.toContain("</");
  });

  it.each(PAGES.filter((page) => page.kind !== "legal").map((page) => [page.id, page] as const))(
    "%s has lead, sections, related pages and the notice in order",
    (_id, page) => {
      const markdown = twin(page);
      const content = page.content(CTX);
      const parts = [
        ...content.lead.slice(0, 1),
        ...content.sections.slice(0, 1).map((section) => `## ${section.heading}`),
        ...(page.related.length === 0 ? [] : [`## ${LOCALIZED.en.relatedHeading}`]),
        LOCALIZED.en.notice,
        "Canonical:",
      ];
      const positions = parts.map((part) => markdown.indexOf(part));
      expect(positions.every((position) => position >= 0)).toBe(true);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
      for (const id of page.related) {
        const related = pageById(id);
        expect(markdown).toContain(pageLine(related, related.path));
      }
    },
  );

  it("renders FAQ pairs as second level questions", () => {
    const faq = pageById("faq");
    const markdown = twin(faq);
    for (const { question, answer } of faq.content(CTX).faq ?? []) {
      expect(markdown).toContain(`## ${question}\n\n${answer}\n`);
    }
  });

  it.each(PAGES.filter((page) => page.kind === "guide").map((page) => [page.id, page] as const))(
    "%s numbers its steps",
    (_id, page) => {
      const steps = page.content(CTX).sections.flatMap((section) => section.blocks).find((block) => block.kind === "steps");
      if (steps?.kind !== "steps") throw new Error("no steps block");
      const expected = steps.items.map((item, index) => `${index + 1}. ${item}`).join("\n");
      expect(twin(page)).toContain(expected);
    },
  );

  it("renders the tools page with one third level heading per tool", () => {
    const markdown = twin(pageById("tools"));
    for (const entry of toolEntries()) {
      expect(markdown).toContain(
        `### \`${entry.name}\`\n${entry.description}\nAsk: "${entry.example}"\nReturns: ${entry.returns}\n`,
      );
    }
  });

  it("renders tables with a separator row and code blocks fenced with their language", () => {
    expect(twin(pageById("data"))).toMatch(/^\| .+ \|\n\|[-| ]+\|\n\| .+ \|$/m);
    expect(twin(pageById("connect-cursor"))).toMatch(/```[a-z]+\n[^`]+\n```/);
  });

  it("renders link blocks as absolute Markdown links with their notes", () => {
    expect(twin(pageById("home"))).toContain(`- [Connect Claude](${ORIGIN}/connect/claude): custom connector steps`);
  });

  it("starts the home twin with the connect section in text fences", () => {
    const markdown = twin(pageById("home"));
    const firstSection = markdown.split("\n").find((line) => line.startsWith("## "));
    expect(firstSection).toBe("## Connect your assistant");
    expect(markdown).toContain(
      `${VALUE_LINE}\n\n## Connect your assistant\n\n\`\`\`text\n${CTX.mcpUrl}\n\`\`\`\n\n\`\`\`text\n${BEARER_HEADER}\n\`\`\`\n\n${CONNECT_NOTE}\n`,
    );
  });

  it.each(legalPages.map((page) => [page.id, page] as const))("%s twin has Markdown links and no notice", (_id, page) => {
    const markdown = twin(page);
    const sections = page.id === "privacy" ? PRIVACY_SECTIONS : TERMS_SECTIONS;
    expect(markdown.startsWith(`# ${page.heading}\n\n## ${sections[0]?.title}\n`)).toBe(true);
    expect(markdown).not.toContain(LOCALIZED.en.notice);
    expect(markdown).not.toContain(LOCALIZED.en.relatedHeading);
    expect(markdown).not.toContain("<a ");
    for (const section of sections) {
      expect(markdown).toContain(`## ${section.title}\n`);
      for (const paragraph of section.paragraphs) {
        expect(markdown).toContain(paragraph.replace(ANCHOR_PATTERN, (_anchor, href: string, label: string) => `[${label}](${href.startsWith("/") ? ORIGIN : ""}${href})`));
      }
    }
    expect(markdown).not.toMatch(/\]\(\//);
    expect(markdown.endsWith(`Canonical: ${ORIGIN}${page.path}\n${LOCALIZED.en.lastUpdated}: ${page.updated}\n`)).toBe(true);
  });
});

describe("llmsTxt", () => {
  const text = llmsTxt(CTX);
  const sections = text.split("\n## ");

  it("follows the contract layout", () => {
    const head = [
      `# ${SITE.name}`,
      "",
      `> ${SITE.oneLine}`,
      "",
      `${SITE.audience} Server address: ${CTX.mcpUrl}. Transport: ${SITE.transportLabel}. Sign-in: ${SITE.signInMethods}. ${SITE.dataLimits}`,
      "",
      `Last updated: ${newestUpdated}`,
      "",
      "## Pages",
      "",
    ].join("\n");
    expect(text.startsWith(head)).toBe(true);
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
  });

  it("lists every listed page in order with its Markdown address", () => {
    expect(bulletLines(sections[1] ?? "")).toEqual(listedPages.map((page) => pageLine(page, markdownPath(page.path))));
  });

  it("lists every tool in the tools section", () => {
    expect(sections[2]?.startsWith("Tools\n")).toBe(true);
    expect(bulletLines(sections[2] ?? "")).toEqual(toolEntries().map((entry) => `- \`${entry.name}\`: ${entry.description}`));
  });

  it("has an optional section with the five items and no Arabic section", () => {
    expect(sections.map((section) => section.split("\n")[0])).toEqual([expect.any(String), "Pages", "Tools", "Optional"]);
    expect(bulletLines(sections[3] ?? "")).toEqual([
      ...legalPages.map((page) => pageLine(page, markdownPath(page.path))),
      ...OPTIONAL_LINES,
    ]);
  });
});

describe("llmsFullTxt", () => {
  const text = llmsFullTxt(CTX);

  it("starts with the llms.txt header", () => {
    const header = llmsTxt(CTX).split("\n\n## Pages")[0] ?? "";
    expect(text.startsWith(`${header}\n\n---\n\n`)).toBe(true);
  });

  it("holds every listed page body once, in order", () => {
    let cursor = 0;
    for (const page of listedPages) {
      const block = `---\n\n# ${page.title(CTX)}\n\nSource: ${ORIGIN}${page.path}\n${LOCALIZED.en.lastUpdated}: ${page.updated}\n\n${bodyOf(page)}\n`;
      const index = text.indexOf(block);
      expect(index).toBeGreaterThanOrEqual(cursor);
      expect(text.indexOf(block, index + 1)).toBe(-1);
      cursor = index + block.length;
    }
  });

  it("lists the legal pages only as links", () => {
    const tail = text.split("\n---\n\n# Legal pages\n\n")[1];
    expect(tail).toBe(`${legalPages.map((page) => pageLine(page, page.path)).join("\n")}\n`);
    for (const section of [...PRIVACY_SECTIONS, ...TERMS_SECTIONS]) {
      expect(text).not.toContain(`## ${section.title}\n`);
    }
  });
});

describe("summary files", () => {
  it.each([
    ["llms.txt", llmsTxt(CTX)],
    ["llms-full.txt", llmsFullTxt(CTX)],
  ])("%s names no person", (_name, text) => {
    expect(text).not.toContain("Essawy");
    expect(text).not.toContain("@gmail");
    expect(text).toContain(SITE.dataLimits);
  });
});
