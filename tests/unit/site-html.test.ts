import { describe, expect, it } from "vitest";
import { legalBody, PRIVACY_SECTIONS, TERMS_SECTIONS } from "../../src/http/legal";
import { ICONS, LOGO_PATH } from "../../src/http/icons";
import type { PageContent } from "../../src/site/content-model";
import { connectSection, escapeHtml, heroSection, STYLESHEET } from "../../src/http/views";
import { LOCALIZED, SITE } from "../../src/site/identity";
import { FOOTER_LINKS, markdownPath, PREVIEW_IMAGE_PATH } from "../../src/site/paths";
import { PAGES, type PublicPage } from "../../src/site/pages";
import { renderPageHtml } from "../../src/site/render-html";
import { FOOTER_NAV, ICON_LINKS, SITE_HEADER } from "../helpers/html";
import { TEST_CONTEXT } from "../helpers/site";

const CTX = TEST_CONTEXT;
const HEAD_PATTERN = /<head>([\s\S]*?)<\/head>/;
const MAIN_PATTERN = /<main id="main">\n([\s\S]*)\n<\/main>/;
const H1_PATTERN = /<h1[^>]*>([^<]*)<\/h1>/g;
const HEADING_PATTERN = /<h([1-6])\b/g;
const FOOTER_NAV_PATTERN = /<footer><nav aria-label="Site">([\s\S]*?)<\/nav><\/footer>/;
const ANCHOR_PATTERN = /<a href="([^"]*)">([^<]*)<\/a>/g;
const NOTICE_PARAGRAPH = `<p class="notice">${escapeHtml(LOCALIZED.en.notice)}</p>`;
const BREADCRUMB_PATTERN = /<nav aria-label="Breadcrumb">[\s\S]*?<\/nav>\n/;
const PAGE_WEIGHT_LIMIT_BYTES = 102_400;
const HOSTILE_ORIGIN = 'https://egx.example.com/"x';
const NOTICE_KINDS: readonly PublicPage["kind"][] = ["home", "content", "guide", "faq"];

function render(page: PublicPage, ctx = CTX): string {
  return renderPageHtml(page, ctx);
}

function headOf(html: string): string {
  return HEAD_PATTERN.exec(html)?.[1] ?? "";
}

function mainOf(html: string): string {
  return MAIN_PATTERN.exec(html)?.[1] ?? "";
}

function metaContent(head: string, attribute: string, name: string): string | undefined {
  const pattern = new RegExp(`<meta ${attribute}="${name}" content="([^"]*)">`);
  return pattern.exec(head)?.[1];
}

function pageByIdOrThrow(id: string): PublicPage {
  const page = PAGES.find((candidate) => candidate.id === id);
  if (page === undefined) throw new Error(`missing page ${id}`);
  return page;
}

const HOME = pageByIdOrThrow("home");
const CONTENT_PAGES = PAGES.filter((page) => NOTICE_KINDS.includes(page.kind) && page.kind !== "home");

describe("public page head", () => {
  for (const page of PAGES) {
    describe(page.id, () => {
      const html = render(page);
      const head = headOf(html);
      const title = escapeHtml(page.title(CTX));
      const description = escapeHtml(page.description);
      const url = `${CTX.origin}${page.path}`;
      const image = `${CTX.origin}${PREVIEW_IMAGE_PATH}`;

      it("declares the English language and left-to-right direction", () => {
        expect(html).toContain('<html lang="en" dir="ltr">');
      });

      it("holds the title, description, canonical and Markdown alternate", () => {
        expect(head).toContain(`<title>${title}</title>`);
        expect(head).toContain(`<meta name="description" content="${description}">`);
        expect(head).toContain(`<link rel="canonical" href="${url}">`);
        expect(head).toContain(
          `<link rel="alternate" type="text/markdown" href="${CTX.origin}${markdownPath(page.path)}">`,
        );
      });

      it("holds the Open Graph and Twitter tags with the page values", () => {
        const alt = escapeHtml(SITE.previewImageAlt);
        expect(metaContent(head, "property", "og:site_name")).toBe(SITE.name);
        expect(metaContent(head, "property", "og:type")).toBe("website");
        expect(metaContent(head, "property", "og:locale")).toBe("en_US");
        expect(metaContent(head, "property", "og:title")).toBe(title);
        expect(metaContent(head, "property", "og:description")).toBe(description);
        expect(metaContent(head, "property", "og:url")).toBe(url);
        expect(metaContent(head, "property", "og:image")).toBe(image);
        expect(metaContent(head, "property", "og:image:width")).toBe("1200");
        expect(metaContent(head, "property", "og:image:height")).toBe("630");
        expect(metaContent(head, "property", "og:image:type")).toBe("image/png");
        expect(metaContent(head, "property", "og:image:alt")).toBe(alt);
        expect(metaContent(head, "name", "twitter:card")).toBe("summary_large_image");
        expect(metaContent(head, "name", "twitter:title")).toBe(title);
        expect(metaContent(head, "name", "twitter:description")).toBe(description);
        expect(metaContent(head, "name", "twitter:image")).toBe(image);
        expect(metaContent(head, "name", "twitter:image:alt")).toBe(alt);
      });

      it("has no alternate language link and no locale alternate while only English exists", () => {
        expect(head).not.toContain("hreflang");
        expect(head).not.toContain("og:locale:alternate");
      });

      it("links the icons and the stylesheet", () => {
        expect(head).toContain(ICON_LINKS);
        expect(head).toContain('<link rel="stylesheet" href="/styles.css">');
      });
    });
  }
});

describe("public page body", () => {
  for (const page of PAGES) {
    describe(page.id, () => {
      const html = render(page);
      const main = mainOf(html);

      it("has exactly one h1 equal to the page heading", () => {
        const headings = [...html.matchAll(H1_PATTERN)].map((match) => match[1]);
        expect(headings).toEqual([escapeHtml(page.heading)]);
      });

      it("never skips a heading level", () => {
        const levels = [...html.matchAll(HEADING_PATTERN)].map((match) => Number(match[1]));
        expect(levels[0]).toBe(1);
        levels.forEach((level, index) => {
          if (index > 0) expect(level).toBeLessThanOrEqual((levels[index - 1] ?? 0) + 1);
        });
      });

      it("starts with the skip link and the site header", () => {
        expect(html).toContain(`<a class="skip-link" href="#main">${LOCALIZED.en.skipLink}</a>`);
        expect(html).toContain(SITE_HEADER);
        expect(html.indexOf('href="#main"')).toBeLessThan(html.indexOf("<header>"));
        expect(html.indexOf("<header>")).toBeLessThan(html.indexOf("<main"));
      });

      it("lists the site links in order in the footer", () => {
        const nav = FOOTER_NAV_PATTERN.exec(html)?.[1] ?? "";
        const links = [...nav.matchAll(ANCHOR_PATTERN)].map((match) => ({ label: match[2], href: match[1] }));
        expect(links).toEqual(FOOTER_LINKS.en.map((link) => ({ label: link.label, href: link.href })));
      });

      it("carries no inline style or style element and only the JSON-LD script", () => {
        expect(html).not.toContain("style=");
        expect(html).not.toContain("<style");
        expect(html.match(/<script/g)).toHaveLength(1);
        expect(html).toContain('<script type="application/ld+json">');
      });

      if (page.kind === "legal") {
        it("keeps the legal body unchanged and adds no notice or updated line", () => {
          const sections = page.id === "privacy" ? PRIVACY_SECTIONS : TERMS_SECTIONS;
          expect(main.replace(BREADCRUMB_PATTERN, "")).toBe(legalBody(page.heading, sections));
          expect(html).not.toContain('class="notice"');
          expect(html).not.toContain('class="updated"');
        });
        return;
      }

      it("ends the main content with the notice and the last updated line", () => {
        const updated = `<p class="updated">${LOCALIZED.en.lastUpdated}: <time datetime="${page.updated}">${page.updated}</time></p>`;
        expect(main).toContain(NOTICE_PARAGRAPH);
        expect(main.endsWith(`${NOTICE_PARAGRAPH}\n${updated}`)).toBe(true);
      });
    });
  }
});

describe("home page", () => {
  const html = render(HOME);
  const main = mainOf(html);
  const hero = heroSection();
  const connect = connectSection(CTX.mcpUrl);

  it("starts the main content with the hero and the connect block", () => {
    expect(main.startsWith(`${hero}\n${connect}\n`)).toBe(true);
  });

  it("holds the examples and the learn more section after the connect block, then the notice", () => {
    const connectEnd = html.indexOf(connect) + connect.length;
    const examples = html.indexOf('<h2 id="examples">');
    const learnMore = html.indexOf('<h2 id="learn-more">');
    expect(examples).toBeGreaterThan(connectEnd);
    expect(learnMore).toBeGreaterThan(examples);
    expect(html.indexOf(NOTICE_PARAGRAPH)).toBeGreaterThan(learnMore);
  });

  it("shows the five example questions and a link to every other page", () => {
    expect([...main.matchAll(/<li>([^<]*)<\/li>/g)].length).toBeGreaterThanOrEqual(5);
    for (const page of PAGES.filter((candidate) => candidate.id !== "home")) {
      expect(main).toContain(`href="${page.path}"`);
    }
  });

  it("states the affiliation once", () => {
    expect(html.split(LOCALIZED.en.affiliation)).toHaveLength(2);
  });
});

describe("content, guide and faq pages", () => {
  for (const page of CONTENT_PAGES) {
    describe(page.id, () => {
      const html = render(page);
      const main = mainOf(html);

      it("puts the first lead paragraph right after the h1", () => {
        const lead = page.content(CTX).lead[0] ?? "";
        const afterHeading = main.slice(main.indexOf("</h1>") + "</h1>".length).trimStart();
        expect(afterHeading.startsWith(`<p>${escapeHtml(lead)}</p>`)).toBe(true);
      });

      it("lists the related pages before the notice", () => {
        const related = main.indexOf(`<h2 id="related">${LOCALIZED.en.relatedHeading}</h2>`);
        expect(related).toBeGreaterThan(-1);
        expect(related).toBeLessThan(main.indexOf(NOTICE_PARAGRAPH));
        for (const id of page.related) expect(main.slice(related)).toContain(`href="${pageByIdOrThrow(id).path}"`);
      });
    });
  }
});

describe("escaping", () => {
  it("escapes a quote in the configured origin inside attributes", () => {
    const html = render(HOME, { ...CTX, origin: HOSTILE_ORIGIN, mcpUrl: `${HOSTILE_ORIGIN}/mcp` });
    const head = headOf(html);

    expect(head).toContain("&quot;");
    expect(head).not.toContain(`href="${HOSTILE_ORIGIN}`);
    expect(head).not.toContain(`content="${HOSTILE_ORIGIN}`);
  });
});

const VALUE_LINE_TEXT = "Ask your AI assistant about Egyptian Exchange stocks and indices. Data is delayed.";
const BEARER_HEADER_TEXT = "Authorization: Bearer &lt;your key&gt;";
const CONNECT_NOTE_TEXT =
  "Claude and ChatGPT connect with Google sign-in, Claude Code with either, and Cursor with an API key header. Create your key after signing in.";
const SIGN_IN_AGREEMENT = "By signing in you agree to the";
const AGREEMENT_PARAGRAPH_PATTERN = /<p class="agreement">By [^<]*you agree to the[\s\S]*?<\/p>/;
const GITHUB_LINK = '<a href="https://github.com/ahmed-essawy/egx-mcp">GitHub</a>';
const REMOVED_TEXT = [
  "What you can ask",
  "Connect in 3 steps",
  "What is covered",
  "Read the docs",
  "cannot send a header",
  "<ol",
  "<h3",
];
const ARIA_LABELLEDBY_PATTERN = /aria-labelledby="([^"]+)"/g;
const BODY_PATTERN = /<body>([\s\S]*)<\/body>/;

describe("home page landing content (moved from the landing view tests)", () => {
  const html = render(HOME);
  const body = BODY_PATTERN.exec(html)?.[1] ?? "";

  it("has exactly one h1 with the product name", () => {
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('<h1 id="hero-title">EGX MCP</h1>');
  });

  it("states the value line and offers one sign in button", () => {
    expect(html).toContain(VALUE_LINE_TEXT);
    expect(html).toContain('<a class="button" href="/dashboard">Sign in</a>');
    expect(html.match(/class="button"/g)).toHaveLength(1);
  });

  it("shows the agreement notice with both policy links after the dashboard link", () => {
    const notice = AGREEMENT_PARAGRAPH_PATTERN.exec(html)?.[0] ?? "";

    expect(notice).toContain(SIGN_IN_AGREEMENT);
    expect(notice).toContain('href="/terms"');
    expect(notice).toContain('href="/privacy"');
    expect(html.indexOf(SIGN_IN_AGREEMENT)).toBeGreaterThan(html.indexOf('href="/dashboard"'));
  });

  it("points every aria-labelledby at a heading id", () => {
    const labelledBy = [...html.matchAll(ARIA_LABELLEDBY_PATTERN)].map((match) => match[1]);

    expect(labelledBy.length).toBeGreaterThan(0);
    for (const id of labelledBy) {
      expect(html, id).toMatch(new RegExp(`<h[12] id="${id}"`));
    }
  });

  it("shows the server url and the bearer header in their own boxes with the connect note", () => {
    expect(html).toContain(`<code>${CTX.mcpUrl}</code>`);
    expect(html).toContain(`<code>${BEARER_HEADER_TEXT}</code>`);
    expect(html).toContain(CONNECT_NOTE_TEXT);
    expect(html.indexOf(BEARER_HEADER_TEXT)).toBeGreaterThan(html.indexOf(CTX.mcpUrl));
  });

  it("escapes the server url", () => {
    const output = render(HOME, { ...CTX, mcpUrl: 'https://x.test/"><script>' });

    expect(output.match(/<script/g)).toHaveLength(1);
    expect(output).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("shows the independence and data notice with the sources", () => {
    expect(html).toContain(NOTICE_PARAGRAPH);
  });

  it("links the privacy policy, terms and GitHub in the footer", () => {
    expect(html).toContain(FOOTER_NAV);
    expect(html).toContain(GITHUB_LINK);
  });

  it("drops the removed sections and the false connector claim", () => {
    for (const text of REMOVED_TEXT) {
      expect(html).not.toContain(text);
    }
    expect(html).not.toMatch(/cannot (send|take)/i);
  });

  it("has only the JSON-LD script, no style element or inline style and only the GitHub external link in the body", () => {
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).not.toContain("<style");
    expect(html).not.toContain("style=");
    expect([...body.matchAll(/href="(http[^"]+)"/g)].map((match) => match[1])).toEqual([
      "https://github.com/ahmed-essawy/egx-mcp",
    ]);
  });
});

describe("page weight", () => {
  const encoder = new TextEncoder();
  const logoBytes = ICONS.get(LOGO_PATH)!.body.byteLength;

  it.each(PAGES.map((page) => [page.id, page] as const))("keeps %s under 100 KiB with the stylesheet and logo", (_id, page) => {
    const total = encoder.encode(render(page)).byteLength + encoder.encode(STYLESHEET).byteLength + logoBytes;

    expect(total).toBeLessThan(PAGE_WEIGHT_LIMIT_BYTES);
  });
});

describe("section heading level", () => {
  const TOOLS = pageByIdOrThrow("tools");
  const withSections = (sections: PageContent["sections"]): PublicPage => ({
    ...TOOLS,
    content: () => ({ lead: [], sections }),
  });

  it("renders a level 3 section as an h3 and a section without a level as an h2", () => {
    const html = render(
      withSections([
        { id: "plain", heading: "Plain", blocks: [] },
        { id: "deep", heading: "Deep", level: 3, blocks: [] },
      ]),
    );

    expect(html).toContain('<h2 id="plain">Plain</h2>');
    expect(html).toContain('<h3 id="deep">Deep</h3>');
  });
});
