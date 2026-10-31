import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ICONS } from "../../src/http/icons";
import worker from "../../src/index";
import { INDEXNOW_KEY_PATH } from "../../src/site/identity";
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

const ORIGIN = "https://egx.example.com";
const STYLESHEET_PATH = "/styles.css";
const OK = 200;
const NOT_MODIFIED = 304;
const MOVED_PERMANENTLY = 301;
const NOT_FOUND = 404;

const accesses: string[] = [];

function trap(name: string): unknown {
  return new Proxy(
    {},
    {
      get: (_target, property) => {
        accesses.push(`${name}.${String(property)}`);
        return () => {
          throw new Error(`${name}.${String(property)} must not be used by a public request`);
        };
      },
    },
  );
}

function trappedEnv(): Env {
  return {
    ...env,
    PUBLIC_ORIGIN: ORIGIN,
    DB: trap("DB"),
    DATA: trap("DATA"),
    OAUTH_KV: trap("OAUTH_KV"),
    RATE_LIMITER: trap("RATE_LIMITER"),
  } as unknown as Env;
}

async function callEntry(path: string, method = "GET", headers: Record<string, string> = {}): Promise<Response> {
  const request = new Request(`${ORIGIN}${path}`, { method, headers });
  return worker.fetch!(request as never, trappedEnv(), {} as ExecutionContext);
}

const READABLE_PATHS = [
  ...PAGES.map((page) => page.path),
  ...PAGES.map((page) => markdownPath(page.path)),
  ROBOTS_PATH,
  SITEMAP_PATH,
  LLMS_PATH,
  LLMS_FULL_PATH,
  INDEXNOW_KEY_PATH,
  AI_CATALOG_PATH,
  SERVER_CARD_PATH,
];

const IMAGE_PATHS = [...ICONS.keys()];

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  accesses.length = 0;
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
    throw new Error("fetch must not be used by a public request");
  });
});

afterEach(() => {
  fetchSpy.mockRestore();
});

function expectNoIo(response: Response): void {
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(accesses).toEqual([]);
  expect(fetchSpy).not.toHaveBeenCalled();
}

describe("public requests touch no storage, limiter or network", () => {
  describe.each(READABLE_PATHS)("%s", (path) => {
    it.each(["GET", "HEAD"])("answers %s", async (method) => {
      const response = await callEntry(path, method);

      expect(response.status).toBe(OK);
      expectNoIo(response);
    });
  });

  it.each([...IMAGE_PATHS, STYLESHEET_PATH])("answers GET %s", async (path) => {
    const response = await callEntry(path);

    expect(response.status).toBe(OK);
    expectNoIo(response);
  });

  it("answers a conditional GET with 304", async () => {
    const first = await callEntry("/faq");
    const response = await callEntry("/faq", "GET", { "if-none-match": first.headers.get("etag")! });

    expect(response.status).toBe(NOT_MODIFIED);
    expectNoIo(response);
  });

  it("answers the Markdown twin for Accept text/markdown", async () => {
    const response = await callEntry("/data", "GET", { accept: "text/markdown" });

    expect(response.status).toBe(OK);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expectNoIo(response);
  });

  it("redirects a non-canonical path", async () => {
    const response = await callEntry("/Tools/");

    expect(response.status).toBe(MOVED_PERMANENTLY);
    expectNoIo(response);
  });

  it("answers 404 for an unknown path", async () => {
    const response = await callEntry("/no-such-page");

    expect(response.status).toBe(NOT_FOUND);
    expectNoIo(response);
  });
});
