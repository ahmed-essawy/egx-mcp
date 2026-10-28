import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { privacyView, termsView } from "../../src/http/legal";
import { defaultHandler } from "../../src/http/routes";
import { ICON_LINKS, SITE_HEADER } from "../helpers/html";

const ORIGIN = "https://egx.example.com";
const NOT_IMPLEMENTED = 501;
const NOT_FOUND = 404;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const ICON_CACHE_CONTROL = "public, max-age=86400";
const WIDTH_OFFSET = 16;
const HEIGHT_OFFSET = 20;
const COLOR_TYPE_OFFSET = 25;
const COLOR_TYPE_RGB = 2;

function pngSize(bytes: Uint8Array): [number, number] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [view.getUint32(WIDTH_OFFSET), view.getUint32(HEIGHT_OFFSET)];
}

function envWith(origin: string): Env {
  return { ...env, PUBLIC_ORIGIN: origin } as unknown as Env;
}

async function call(path: string, method = "GET", bindings: Env = {} as Env): Promise<Response> {
  const request = new Request(`${ORIGIN}${path}`, { method });
  return defaultHandler.fetch!(request as never, bindings, {} as ExecutionContext);
}

describe("defaultHandler", () => {
  it("serves the landing page as HTML with the configured MCP URL", async () => {
    const response = await call("/", "GET", envWith("https://egx.configured.test"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'self'; frame-ancestors 'none'");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    const body = await response.text();
    expect(body).toContain("<code>https://egx.configured.test/mcp</code>");
    expect(body).toContain(SITE_HEADER);
  });

  it("falls back to the request origin for the MCP URL", async () => {
    const response = await call("/", "GET", envWith(""));
    expect(await response.text()).toContain("<code>https://egx.example.com/mcp</code>");
  });

  it("answers 500 for the landing page when the configured origin is invalid", async () => {
    const response = await call("/", "GET", envWith("ftp://egx.example.com"));
    expect(response.status).toBe(500);
  });

  it("serves the stylesheet as CSS with the security headers", async () => {
    const response = await call("/styles.css");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/css");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toContain("body {");
  });

  it.each([
    ["/favicon-32.png", 32],
    ["/favicon.ico", 32],
    ["/apple-touch-icon.png", 180],
    ["/icon-192.png", 192],
  ])("serves %s as a %i px PNG with a cache header", async (path, size) => {
    const response = await call(path);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe(ICON_CACHE_CONTROL);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("set-cookie")).toBeNull();
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(bytes.slice(0, PNG_SIGNATURE.length))).toEqual(PNG_SIGNATURE);
    expect(pngSize(bytes)).toEqual([size, size]);
  });

  it("serves the apple touch icon without an alpha channel", async () => {
    const bytes = new Uint8Array(await (await call("/apple-touch-icon.png")).arrayBuffer());
    expect(bytes[COLOR_TYPE_OFFSET]).toBe(COLOR_TYPE_RGB);
  });

  it("serves the full icon on every request", async () => {
    const first = new Uint8Array(await (await call("/icon-192.png")).arrayBuffer());
    const second = new Uint8Array(await (await call("/icon-192.png")).arrayBuffer());
    expect(first.byteLength).toBeGreaterThan(0);
    expect(second).toEqual(first);
  });

  it.each([
    ["/privacy", privacyView, "<h1>Privacy policy</h1>"],
    ["/terms", termsView, "<h1>Terms of use</h1>"],
  ])("serves %s as HTML with the security headers and no cookie", async (path, view, heading) => {
    const response = await call(path);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'self'; frame-ancestors 'none'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("same-origin");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    const body = await response.text();
    expect(body).toBe(view());
    expect(body).toContain(heading);
    expect(body).toContain(SITE_HEADER);
    expect(body).toContain(ICON_LINKS);
  });

  it.each([
    ["GET", "/authorize"],
    ["POST", "/authorize"],
    ["GET", "/callback/google"],
  ])("answers %s %s with 501", async (method, path) => {
    const response = await call(path, method);
    expect(response.status).toBe(NOT_IMPLEMENTED);
    expect(await response.text()).toContain("Sign-in not available yet");
  });

  it.each([
    ["GET", "/missing"],
    ["POST", "/"],
    ["POST", "/privacy"],
    ["POST", "/terms"],
    ["POST", "/favicon.ico"],
    ["POST", "/icon-192.png"],
    ["GET", "/dashboard/keys/key-1/revoke"],
  ])("answers %s %s with 404", async (method, path) => {
    expect((await call(path, method)).status).toBe(NOT_FOUND);
  });
});
