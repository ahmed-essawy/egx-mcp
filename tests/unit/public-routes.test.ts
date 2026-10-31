import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { defaultHandler } from "../../src/http/routes";
import worker from "../../src/index";
import { robotsTxt, sitemapXml } from "../../src/site/crawl";
import { aiCatalog } from "../../src/site/discovery";
import { INDEXNOW_KEY_PATH, SITE } from "../../src/site/identity";
import { PAGES } from "../../src/site/pages";
import {
  AI_CATALOG_PATH,
  LLMS_FULL_PATH,
  LLMS_PATH,
  markdownPath,
  ROBOTS_PATH,
  SERVER_CARD_PATH,
  SITEMAP_PATH,
} from "../../src/site/paths";
import { renderPageHtml } from "../../src/site/render-html";
import { llmsFullTxt, llmsTxt, renderPageMarkdown } from "../../src/site/render-markdown";
import { TEST_CONTEXT } from "../helpers/site";

const CONFIGURED_ORIGIN = "https://egx.configured.test";
const REQUEST_ORIGIN = "https://egx.example.com";
const PUBLIC_CACHE_CONTROL = "public, max-age=3600";
const PRIVATE_CACHE_CONTROL = "no-store";
const NOINDEX = "noindex, nofollow";
const HTML_CSP = "default-src 'self'; frame-ancestors 'none'";
const HTML_CONTENT_TYPE = "text/html; charset=utf-8";
const WIDTH_OFFSET = 16;
const HEIGHT_OFFSET = 20;
const OG_IMAGE_MAX_BYTES = 61_440;
const OG_IMAGE_SHA256 = "ed29b505c6538fa94ce1dceed17e937ccfba9be4ca14a277c367c312ef13e131";
const MOVED_PERMANENTLY = 301;
const NOT_FOUND = 404;
const REDIRECT_CACHE_CONTROL = "public, max-age=86400";

function envWith(origin: string): Env {
  return { ...env, PUBLIC_ORIGIN: origin } as unknown as Env;
}

async function call(
  path: string,
  method = "GET",
  bindings: Env = envWith(CONFIGURED_ORIGIN),
  headers: Record<string, string> = {},
): Promise<Response> {
  const request = new Request(`${REQUEST_ORIGIN}${path}`, { method, headers });
  return defaultHandler.fetch!(request as never, bindings, {} as ExecutionContext);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function configuredContext() {
  return {
    ...TEST_CONTEXT,
    origin: CONFIGURED_ORIGIN,
    mcpUrl: `${CONFIGURED_ORIGIN}/mcp`,
    dashboardUrl: `${CONFIGURED_ORIGIN}/dashboard`,
  };
}

describe("public pages", () => {
  for (const page of PAGES) {
    describe(page.path, () => {
      it("answers 200 with the public header set and no cookie", async () => {
        const response = await call(page.path);

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe(HTML_CONTENT_TYPE);
        expect(response.headers.get("cache-control")).toBe(PUBLIC_CACHE_CONTROL);
        expect(response.headers.get("content-security-policy")).toBe(HTML_CSP);
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
        expect(response.headers.get("referrer-policy")).toBe("same-origin");
        expect(response.headers.get("vary")).toBe("Accept");
        expect(response.headers.get("link")).toBe(
          `<${CONFIGURED_ORIGIN}${markdownPath(page.path)}>; rel="alternate"; type="text/markdown"`,
        );
        expect(response.headers.get("set-cookie")).toBeNull();
        expect(response.headers.get("x-robots-tag")).toBeNull();
      });

      it("renders the page for the configured origin", async () => {
        const body = await (await call(page.path)).text();

        expect(body).toBe(renderPageHtml(page, configuredContext()));
      });
    });
  }

  it("falls back to the request origin when no origin is configured", async () => {
    const body = await (await call("/tools", "GET", envWith(""))).text();

    expect(body).toContain(`<link rel="canonical" href="${REQUEST_ORIGIN}/tools">`);
  });

  it("answers 500 when the configured origin is invalid", async () => {
    expect((await call("/tools", "GET", envWith("ftp://egx.example.com"))).status).toBe(500);
  });

  it("ignores the query string and keeps the canonical URL without it", async () => {
    const response = await call("/tools?utm_source=x");

    expect(response.status).toBe(200);
    expect(await response.text()).toContain(`<link rel="canonical" href="${CONFIGURED_ORIGIN}/tools">`);
  });
});

describe("canonical redirects", () => {
  it.each([
    ["/Tools", "/tools"],
    ["/tools/", "/tools"],
    ["/TOOLS/", "/tools"],
    ["/connect/Claude", "/connect/claude"],
    ["/PRIVACY", "/privacy"],
    ["/Tools/?utm_source=x", "/tools"],
  ])("answers 301 for %s to %s without a body", async (path, canonical) => {
    const response = await call(path);

    expect(response.status).toBe(MOVED_PERMANENTLY);
    expect(response.headers.get("location")).toBe(`${CONFIGURED_ORIGIN}${canonical}`);
    expect(response.headers.get("cache-control")).toBe(REDIRECT_CACHE_CONTROL);
    expect(await response.text()).toBe("");
  });

  it.each(["/tool", "/connect", "/connect/claude/x", "/no-such-page"])("answers 404 for %s", async (path) => {
    expect((await call(path)).status).toBe(NOT_FOUND);
  });

  it("answers 404 for POST /tools and does not redirect POST /Tools", async () => {
    expect((await call("/tools", "POST")).status).toBe(NOT_FOUND);
    expect((await call("/Tools", "POST")).status).toBe(NOT_FOUND);
  });
});

describe("private pages", () => {
  it("marks the not found page noindex and no-store", async () => {
    const response = await call("/no-such-page");

    expect(response.headers.get("x-robots-tag")).toBe(NOINDEX);
    expect(response.headers.get("cache-control")).toBe(PRIVATE_CACHE_CONTROL);
    expect(await response.text()).toContain('<meta name="robots" content="noindex, nofollow">');
  });

  it("keeps the dashboard redirect without a session unchanged", async () => {
    const response = await call("/dashboard");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/dashboard/login");
  });

  it("marks the error page for an invalid origin noindex and no-store", async () => {
    const response = await call("/tools", "GET", envWith("ftp://egx.example.com"));

    expect(response.headers.get("x-robots-tag")).toBe(NOINDEX);
    expect(response.headers.get("cache-control")).toBe(PRIVATE_CACHE_CONTROL);
  });
});

describe("preview image", () => {
  it("serves a 1200 by 630 PNG with the image headers and the pinned hash", async () => {
    const response = await call("/og-image.png");
    const bytes = new Uint8Array(await response.arrayBuffer());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect([view.getUint32(WIDTH_OFFSET), view.getUint32(HEIGHT_OFFSET)]).toEqual([1200, 630]);
    expect(bytes.byteLength).toBeLessThanOrEqual(OG_IMAGE_MAX_BYTES);
    expect(await sha256Hex(bytes)).toBe(OG_IMAGE_SHA256);
  });
});

const MARKDOWN_CONTENT_TYPE = "text/markdown; charset=utf-8";
const PLAIN_CONTENT_TYPE = "text/plain; charset=utf-8";
const XML_CONTENT_TYPE = "application/xml; charset=utf-8";
const CATALOG_CONTENT_TYPE = "application/ai-catalog+json";
const CHROME_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";

describe("markdown twins", () => {
  for (const page of PAGES) {
    const twinPath = markdownPath(page.path);

    it(`serves ${twinPath} with the twin header set`, async () => {
      const response = await call(twinPath);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(MARKDOWN_CONTENT_TYPE);
      expect(response.headers.get("link")).toBe(`<${CONFIGURED_ORIGIN}${page.path}>; rel="canonical"`);
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("cache-control")).toBe(PUBLIC_CACHE_CONTROL);
      expect(response.headers.get("content-security-policy")).toBeNull();
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(await response.text()).toBe(renderPageMarkdown(page, configuredContext()));
    });
  }

  it("redirects an upper-case twin path to the lower-case one", async () => {
    const response = await call("/TOOLS.MD");

    expect(response.status).toBe(MOVED_PERMANENTLY);
    expect(response.headers.get("location")).toBe(`${CONFIGURED_ORIGIN}/tools.md`);
  });
});

describe("content negotiation", () => {
  it.each(["text/markdown", "text/markdown, text/html;q=0.9"])("answers the twin for Accept %s", async (accept) => {
    const response = await call("/data", "GET", envWith(CONFIGURED_ORIGIN), { accept });
    const page = PAGES.find((candidate) => candidate.path === "/data")!;

    expect(response.headers.get("content-type")).toBe(MARKDOWN_CONTENT_TYPE);
    expect(response.headers.get("vary")).toBe("Accept");
    expect(response.headers.get("link")).toBe(`<${CONFIGURED_ORIGIN}/data>; rel="canonical"`);
    expect(await response.text()).toBe(renderPageMarkdown(page, configuredContext()));
  });

  it.each([CHROME_ACCEPT, "*/*", "text/plain;q=0.5, text/html", "text/markdown;q=0, text/html", ""])(
    "answers HTML for Accept %s",
    async (accept) => {
      const response = await call("/data", "GET", envWith(CONFIGURED_ORIGIN), accept === "" ? {} : { accept });

      expect(response.headers.get("content-type")).toBe(HTML_CONTENT_TYPE);
      expect(response.headers.get("vary")).toBe("Accept");
    },
  );
});

describe("text and discovery files", () => {
  it.each([
    [ROBOTS_PATH, PLAIN_CONTENT_TYPE, () => robotsTxt(configuredContext())],
    [LLMS_PATH, PLAIN_CONTENT_TYPE, () => llmsTxt(configuredContext())],
    [LLMS_FULL_PATH, PLAIN_CONTENT_TYPE, () => llmsFullTxt(configuredContext())],
    [SITEMAP_PATH, XML_CONTENT_TYPE, () => sitemapXml(configuredContext())],
  ])("serves %s", async (path, contentType, expected) => {
    const response = await call(path);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(contentType);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe(PUBLIC_CACHE_CONTROL);
    expect(response.headers.get("content-security-policy")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.text()).toBe(expected());
  });

  it("serves the AI catalog with the discovery CORS headers", async () => {
    const response = await call(AI_CATALOG_PATH);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(CATALOG_CONTENT_TYPE);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-methods")).toBe("GET");
    expect(response.headers.get("access-control-allow-headers")).toBe("Content-Type, If-None-Match");
    expect(response.headers.get("access-control-expose-headers")).toBe("ETag");
    expect(await response.text()).toBe(`${JSON.stringify(aiCatalog(configuredContext()), null, 2)}\n`);
  });

  it("serves the IndexNow key with no trailing newline", async () => {
    const response = await call(INDEXNOW_KEY_PATH);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(PLAIN_CONTENT_TYPE);
    expect(await response.text()).toBe(SITE.indexNowKey);
  });

  it("answers 500 for a text file when the configured origin is invalid", async () => {
    expect((await call(LLMS_PATH, "GET", envWith("ftp://egx.example.com"))).status).toBe(500);
  });
});

const NOT_MODIFIED = 304;
const ETAG_HEX_LENGTH = 32;
const CONDITIONAL_HEADER_NAMES = ["etag", "cache-control", "vary", "link", "access-control-allow-origin"];

const CONDITIONAL_PATHS = [
  ...PAGES.map((page) => page.path),
  ...PAGES.map((page) => markdownPath(page.path)),
  ROBOTS_PATH,
  SITEMAP_PATH,
  LLMS_PATH,
  LLMS_FULL_PATH,
  AI_CATALOG_PATH,
  INDEXNOW_KEY_PATH,
  SERVER_CARD_PATH,
];

async function callEntry(path: string, method = "GET", headers: Record<string, string> = {}): Promise<Response> {
  const request = new Request(`${REQUEST_ORIGIN}${path}`, { method, headers });
  return worker.fetch!(request as never, envWith(CONFIGURED_ORIGIN), {} as ExecutionContext);
}

async function expectedEtag(response: Response): Promise<string> {
  const bytes = new Uint8Array(await response.clone().arrayBuffer());
  return `"${(await sha256Hex(bytes)).slice(0, ETAG_HEX_LENGTH)}"`;
}

function headerEntries(response: Response): [string, string][] {
  return [...response.headers.entries()].sort(([left], [right]) => left.localeCompare(right));
}

describe("conditional requests and HEAD on public routes", () => {
  describe.each(CONDITIONAL_PATHS)("%s", (path) => {
    it("sets an etag from the SHA-256 of the body", async () => {
      const response = await callEntry(path);

      expect(response.status).toBe(200);
      expect(response.headers.get("etag")).toBe(await expectedEtag(response));
    });

    it.each([
      ["the exact value", (etag: string) => etag],
      ["a weak value", (etag: string) => `W/${etag}`],
      ["a list", (etag: string) => `"other", ${etag} , "another"`],
      ["a star", () => "*"],
    ])("answers 304 without a body for %s", async (_label, build) => {
      const full = await callEntry(path);
      const etag = full.headers.get("etag")!;

      const response = await callEntry(path, "GET", { "if-none-match": build(etag) });

      expect(response.status).toBe(NOT_MODIFIED);
      expect(await response.text()).toBe("");
      for (const name of CONDITIONAL_HEADER_NAMES) {
        expect(response.headers.get(name)).toBe(full.headers.get(name));
      }
      expect(headerEntries(response)).toEqual(headerEntries(full));
    });

    it("answers 200 for a different etag", async () => {
      const response = await callEntry(path, "GET", { "if-none-match": '"0123456789abcdef0123456789abcdef"' });

      expect(response.status).toBe(200);
      expect((await response.text()).length).toBeGreaterThan(0);
    });

    it("answers HEAD with the GET status and headers and no body", async () => {
      const full = await callEntry(path);

      const response = await callEntry(path, "HEAD");

      expect(response.status).toBe(200);
      expect(headerEntries(response)).toEqual(headerEntries(full));
      expect(await response.text()).toBe("");
    });

    it("answers a conditional HEAD with 304", async () => {
      const full = await callEntry(path);

      const response = await callEntry(path, "HEAD", { "if-none-match": full.headers.get("etag")! });

      expect(response.status).toBe(NOT_MODIFIED);
      expect(await response.text()).toBe("");
    });
  });

  it("gives the HTML and Markdown representations of one URL different etags", async () => {
    const html = await callEntry("/data");
    const markdown = await callEntry("/data", "GET", { accept: "text/markdown" });

    expect(markdown.headers.get("etag")).not.toBe(html.headers.get("etag"));
    expect(markdown.headers.get("etag")).toBe(await expectedEtag(markdown));
  });

  it("keeps the Accept negotiated 304 on the Markdown representation", async () => {
    const markdown = await callEntry("/data", "GET", { accept: "text/markdown" });

    const response = await callEntry("/data", "GET", {
      accept: "text/markdown",
      "if-none-match": markdown.headers.get("etag")!,
    });

    expect(response.status).toBe(NOT_MODIFIED);
    expect(response.headers.get("vary")).toBe("Accept");
  });

  it("does not set an etag on the preview image", async () => {
    expect((await callEntry("/og-image.png")).headers.get("etag")).toBeNull();
  });

  it("keeps HEAD /dashboard and HEAD on an unknown path at 404", async () => {
    expect((await callEntry("/dashboard", "HEAD")).status).toBe(NOT_FOUND);
    expect((await callEntry("/no-such-page", "HEAD")).status).toBe(NOT_FOUND);
  });

  it("answers HEAD for a mixed-case path with the canonical redirect", async () => {
    const response = await callEntry("/Tools", "HEAD");

    expect(response.status).toBe(MOVED_PERMANENTLY);
  });
});
