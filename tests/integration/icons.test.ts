import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://egx.test";
const CLIENT_ORIGIN = "https://client.example";
const ANY_ORIGIN = "*";
const IMAGES: [string, string][] = [
  ["/favicon-32.png", "image/png"],
  ["/favicon.ico", "image/x-icon"],
  ["/apple-touch-icon.png", "image/png"],
  ["/icon-192.png", "image/png"],
  ["/icon-512.png", "image/png"],
  ["/logo-96.png", "image/png"],
];

function fetchFrom(path: string): Promise<Response> {
  return exports.default.fetch(`${ORIGIN}${path}`, { headers: { origin: CLIENT_ORIGIN } });
}

describe("image paths through the full Worker", () => {
  it.each(IMAGES)("lets other origins read %s", async (path, contentType) => {
    const response = await fetchFrom(path);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(contentType);
    expect(response.headers.get("access-control-allow-origin")).toBe(ANY_ORIGIN);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("adds no CORS header to the landing page", async () => {
    const response = await fetchFrom("/");
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});
