import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { privacyView, termsView } from "../../src/http/legal";
import { defaultHandler } from "../../src/http/routes";
import { ICON_LINKS, SITE_HEADER } from "../helpers/html";

const ORIGIN = "https://egx.example.com";
const SERVER_ERROR = 500;
const NOT_FOUND = 404;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const ICON_CACHE_CONTROL = "public, max-age=86400";
const WIDTH_OFFSET = 16;
const HEIGHT_OFFSET = 20;
const COLOR_TYPE_OFFSET = 25;
const COLOR_TYPE_RGB = 2;
const COLOR_TYPE_RGBA = 6;
const ICO_CONTENT_TYPE = "image/x-icon";
const ICO_HEADER = [0, 0, 1, 0, 3, 0];
const ICO_SIZES = [16, 32, 48];
const ICO_ENTRY_SIZE = 16;
const ICO_DIRECTORY_OFFSET = 6;
const ICO_IMAGE_OFFSET_FIELD = 12;
const ARTWORK_SHA256: [string, string][] = [
  ["/favicon-32.png", "cc1d8ddd4f29bc85c4d22bb1f49b119140da17f4b05c73b8c6d47a5f3b1e23f9"],
  ["/favicon.ico", "27a5c823e0747a48299c28c2129b69935e238bb7dd924597eab0d7506e45aad1"],
  ["/apple-touch-icon.png", "70044c4bc2209e2110f6ec939d70e9668b80793caba67de22c6adc8aa5cdaf84"],
  ["/icon-192.png", "915a64bc304b1ed48cde32a7dfd975f48198199dc227677863d1549d3809b2cd"],
  ["/icon-512.png", "4c841d3a7e48a2ac241c16a36653330c080d0b3ecfdc1ed817249e7f0cf0d650"],
  ["/logo-96.png", "30430d7bc7b2703561d8b001d2226ac73ce1ce849b91e0b41e9d6c1c18c537f6"],
];

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

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
    ["/apple-touch-icon.png", 180],
    ["/icon-192.png", 192],
    ["/icon-512.png", 512],
    ["/logo-96.png", 96],
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

  it.each(ARTWORK_SHA256)("serves the EGX MCP artwork at %s", async (path, hash) => {
    const response = await call(path);
    expect(response.status).toBe(200);
    expect(await sha256Hex(new Uint8Array(await response.arrayBuffer()))).toBe(hash);
  });

  it("serves /favicon.ico as a 16, 32 and 48 px icon", async () => {
    const response = await call("/favicon.ico");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(ICO_CONTENT_TYPE);
    expect(response.headers.get("cache-control")).toBe(ICON_CACHE_CONTROL);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("set-cookie")).toBeNull();
    const bytes = new Uint8Array(await response.arrayBuffer());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(Array.from(bytes.slice(0, ICO_HEADER.length))).toEqual(ICO_HEADER);
    ICO_SIZES.forEach((size, index) => {
      const entry = ICO_DIRECTORY_OFFSET + index * ICO_ENTRY_SIZE;
      expect(bytes[entry]).toBe(size);
      expect(bytes[entry + 1]).toBe(size);
      const imageOffset = view.getUint32(entry + ICO_IMAGE_OFFSET_FIELD, true);
      expect(Array.from(bytes.slice(imageOffset, imageOffset + PNG_SIGNATURE.length))).toEqual(PNG_SIGNATURE);
    });
  });

  it("serves the header logo with an alpha channel for its rounded corners", async () => {
    const bytes = new Uint8Array(await (await call("/logo-96.png")).arrayBuffer());
    expect(bytes[COLOR_TYPE_OFFSET]).toBe(COLOR_TYPE_RGBA);
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
    ["GET", "/authorize", "parseAuthRequest"],
    ["POST", "/authorize", "denyConsent"],
    ["GET", "/callback/google", "finishUpstream"],
  ])("routes %s %s to the OAuth provider helpers", async (method, path, helper) => {
    const calls: string[] = [];
    const provider = new Proxy(
      {},
      {
        get: (_target, name) => async () => {
          calls.push(String(name));
          throw new Error("stop");
        },
      },
    );
    const bindings = { ...env, PUBLIC_ORIGIN: ORIGIN, OAUTH_PROVIDER: provider } as unknown as Env;
    const request = new Request(`${ORIGIN}${path}`, {
      method,
      body: method === "POST" ? new URLSearchParams({ handle: "h", decision: "deny" }) : undefined,
    });

    const response = await defaultHandler.fetch!(request as never, bindings, {} as ExecutionContext);

    expect(calls).toEqual([helper]);
    expect(response.status).toBe(SERVER_ERROR);
  });

  it.each([
    ["GET", "/missing"],
    ["POST", "/"],
    ["POST", "/privacy"],
    ["POST", "/terms"],
    ["POST", "/favicon.ico"],
    ["POST", "/icon-192.png"],
    ["POST", "/icon-512.png"],
    ["POST", "/logo-96.png"],
    ["GET", "/dashboard/keys/key-1/revoke"],
  ])("answers %s %s with 404", async (method, path) => {
    expect((await call(path, method)).status).toBe(NOT_FOUND);
  });
});
