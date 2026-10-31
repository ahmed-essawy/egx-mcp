import { describe, expect, it } from "vitest";
import { SITE } from "../../src/site/identity";
import { PREVIEW_IMAGE_PATH } from "../../src/site/paths";
import { PAGES, type PublicPage } from "../../src/site/pages";
import { renderPageHtml } from "../../src/site/render-html";
import { structuredDataJson } from "../../src/site/structured-data";
import { TEST_CONTEXT } from "../helpers/site";

const CTX = TEST_CONTEXT;
const ORIGIN = CTX.origin;
const SCRIPT_PATTERN = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/;
const BREADCRUMB_PATTERN = /<nav aria-label="Breadcrumb">([\s\S]*?)<\/nav>/;
const TAG_PATTERN = /<[^>]+>/g;
const ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};
const ENTITY_PATTERN = /&(?:amp|lt|gt|quot|#39);/g;

type Node = Record<string, unknown>;

function plainText(html: string): string {
  return html.replace(TAG_PATTERN, "").replace(ENTITY_PATTERN, (entity) => ENTITIES[entity] ?? entity);
}

function graphOf(html: string): Node[] {
  const json = SCRIPT_PATTERN.exec(html)?.[1] ?? "";
  const parsed = JSON.parse(json) as { "@context": string; "@graph": Node[] };
  expect(parsed["@context"]).toBe("https://schema.org");
  return parsed["@graph"];
}

function nodeOfType(graph: Node[], type: string): Node {
  const node = graph.find((candidate) => candidate["@type"] === type);
  if (node === undefined) throw new Error(`missing ${type}`);
  return node;
}

function textsOf(html: string, pattern: RegExp): string[] {
  return [...html.matchAll(pattern)].map((match) => plainText(match[1] ?? ""));
}

function pageOfKind(kind: PublicPage["kind"]): PublicPage {
  const page = PAGES.find((candidate) => candidate.kind === kind);
  if (page === undefined) throw new Error(`no ${kind} page`);
  return page;
}

const HOME = pageOfKind("home");

describe("structured data on every page", () => {
  for (const page of PAGES) {
    describe(page.id, () => {
      const html = renderPageHtml(page, CTX);
      const graph = graphOf(html);
      const webPage = nodeOfType(graph, "WebPage");

      it("has exactly one script and it is the JSON-LD block", () => {
        expect(html.match(/<script/g)).toHaveLength(1);
        expect(html).toContain('<script type="application/ld+json">');
      });

      it("describes the page with the visible title, description and date", () => {
        expect(webPage["@id"]).toBe(`${ORIGIN}${page.path}#webpage`);
        expect(webPage.url).toBe(`${ORIGIN}${page.path}`);
        expect(webPage.name).toBe(page.title(CTX));
        expect(webPage.description).toBe(page.description);
        expect(webPage.inLanguage).toBe(page.lang);
        expect(webPage.dateModified).toBe(page.updated);
        expect(webPage.isPartOf).toEqual({ "@id": `${ORIGIN}/#website` });
        if (page.kind !== "legal") {
          expect(/<time datetime="([^"]*)">/.exec(html)?.[1]).toBe(webPage.dateModified);
        }
      });

      it("names no person and no email", () => {
        const text = JSON.stringify(graph).replaceAll(SITE.repositoryUrl, "");
        expect(text).not.toMatch(/Essawy|gmail|[\w.+-]+@[\w-]+\.[a-z]/i);
        expect(text).not.toContain('"Person"');
      });
    });
  }
});

describe("home graph", () => {
  const graph = graphOf(renderPageHtml(HOME, CTX));

  it("holds the organization, website, software application and web page", () => {
    expect(graph.map((node) => node["@type"])).toEqual(["Organization", "WebSite", "SoftwareApplication", "WebPage"]);
  });

  it("states the publisher with the issues page as the only contact", () => {
    expect(nodeOfType(graph, "Organization")).toEqual({
      "@type": "Organization",
      "@id": `${ORIGIN}/#organization`,
      name: SITE.publisherName,
      url: `${ORIGIN}/`,
      logo: { "@type": "ImageObject", url: `${ORIGIN}/icon-512.png`, width: 512, height: 512 },
      sameAs: [SITE.repositoryUrl],
      contactPoint: { "@type": "ContactPoint", contactType: "customer support", url: SITE.issuesUrl },
    });
  });

  it("lists the languages present on the site", () => {
    expect(nodeOfType(graph, "WebSite")).toEqual({
      "@type": "WebSite",
      "@id": `${ORIGIN}/#website`,
      name: SITE.name,
      url: `${ORIGIN}/`,
      inLanguage: [...new Set(PAGES.map((page) => page.lang))],
      publisher: { "@id": `${ORIGIN}/#organization` },
    });
  });

  it("describes the free software with no rating or review", () => {
    expect(nodeOfType(graph, "SoftwareApplication")).toEqual({
      "@type": "SoftwareApplication",
      "@id": `${ORIGIN}/#software`,
      name: SITE.name,
      description: SITE.oneLine,
      url: `${ORIGIN}/`,
      image: `${ORIGIN}${PREVIEW_IMAGE_PATH}`,
      applicationCategory: "FinanceApplication",
      operatingSystem: "Any",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      publisher: { "@id": `${ORIGIN}/#organization` },
    });
    expect(JSON.stringify(graph)).not.toMatch(/aggregateRating|review/i);
  });

  it("points the web page at the software and has no breadcrumb", () => {
    const webPage = nodeOfType(graph, "WebPage");
    expect(webPage.about).toEqual({ "@id": `${ORIGIN}/#software` });
    expect(webPage.breadcrumb).toBeUndefined();
  });
});

describe("breadcrumb", () => {
  it("is absent on the home page", () => {
    expect(renderPageHtml(HOME, CTX)).not.toContain('aria-label="Breadcrumb"');
  });

  for (const page of PAGES.filter((candidate) => candidate.kind !== "home")) {
    describe(page.id, () => {
      const html = renderPageHtml(page, CTX);
      const nav = BREADCRUMB_PATTERN.exec(html)?.[1] ?? "";
      const graph = graphOf(html);

      it("shows home and the current page with aria-current on the last item", () => {
        expect(nav).toContain('<ol class="breadcrumb">');
        expect(nav).toContain('<li><a href="/">Home</a></li>');
        expect(nav).toContain(`<li aria-current="page">${page.breadcrumb}</li>`);
        expect(html.indexOf('aria-label="Breadcrumb"')).toBeLessThan(html.indexOf("<h1"));
      });

      it("is restated by the BreadcrumbList with two items", () => {
        const visible = textsOf(nav, /<li[^>]*>([\s\S]*?)<\/li>/g);
        expect(visible).toHaveLength(2);
        expect(nodeOfType(graph, "BreadcrumbList")).toEqual({
          "@type": "BreadcrumbList",
          "@id": `${ORIGIN}${page.path}#breadcrumb`,
          itemListElement: [
            { "@type": "ListItem", position: 1, name: visible[0], item: `${ORIGIN}/` },
            { "@type": "ListItem", position: 2, name: visible[1], item: `${ORIGIN}${page.path}` },
          ],
        });
        expect(nodeOfType(graph, "WebPage").breadcrumb).toEqual({ "@id": `${ORIGIN}${page.path}#breadcrumb` });
      });
    });
  }
});

describe("faq graph", () => {
  const page = pageOfKind("faq");
  const html = renderPageHtml(page, CTX);
  const graph = graphOf(html);

  it("restates every visible question and answer", () => {
    const questions = textsOf(html, /<h2 id="faq-\d+">([\s\S]*?)<\/h2>/g);
    const answers = textsOf(html, /<h2 id="faq-\d+">[\s\S]*?<\/h2>\n<p>([\s\S]*?)<\/p>/g);
    expect(questions.length).toBeGreaterThan(0);
    expect(nodeOfType(graph, "FAQPage")).toEqual({
      "@type": "FAQPage",
      "@id": `${ORIGIN}${page.path}#faq`,
      mainEntity: questions.map((name, index) => ({
        "@type": "Question",
        name,
        acceptedAnswer: { "@type": "Answer", text: answers[index] },
      })),
    });
  });

  it("is the main entity of the web page", () => {
    expect(nodeOfType(graph, "WebPage").mainEntity).toEqual({ "@id": `${ORIGIN}${page.path}#faq` });
  });
});

describe("guide graphs", () => {
  for (const page of PAGES.filter((candidate) => candidate.kind === "guide")) {
    it(`${page.id} restates the visible steps`, () => {
      const html = renderPageHtml(page, CTX);
      const start = html.indexOf("<ol>");
      const steps = html.slice(start, html.indexOf("</ol>", start));
      const texts = textsOf(steps, /<li>([\s\S]*?)<\/li>/g);
      const name = textsOf(html, /<h2 id="steps">([\s\S]*?)<\/h2>/g)[0];
      expect(texts.length).toBeGreaterThan(0);
      expect(nodeOfType(graphOf(html), "HowTo")).toEqual({
        "@type": "HowTo",
        "@id": `${ORIGIN}${page.path}#howto`,
        name,
        step: texts.map((text, index) => ({
          "@type": "HowToStep",
          position: index + 1,
          name: `Step ${index + 1}`,
          text,
        })),
      });
    });
  }

  it("adds no HowTo or FAQPage to a plain content page", () => {
    const tools = PAGES.find((candidate) => candidate.id === "tools") as PublicPage;
    const types = graphOf(renderPageHtml(tools, CTX)).map((node) => node["@type"]);
    expect(types).toEqual(["WebPage", "BreadcrumbList"]);
  });
});

describe("serialization", () => {
  it("escapes angle brackets and ampersands so the block cannot be closed early", () => {
    const json = structuredDataJson(HOME, { ...CTX, origin: "https://x.test/</script>&" });
    expect(json).not.toMatch(/[<>&]/);
    expect(json).toContain("\\u003c");
  });

  it("keeps the escaped text parseable", () => {
    expect(() => JSON.parse(structuredDataJson(HOME, CTX))).not.toThrow();
  });
});
