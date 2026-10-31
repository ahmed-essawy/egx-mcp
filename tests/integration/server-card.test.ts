import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { serverCard } from "../../src/site/discovery";
import { TEST_CONTEXT } from "../helpers/site";

const ORIGIN = "https://egx.test";
const CARD_CONTENT_TYPE = "application/mcp-server-card+json";
const UNAUTHORIZED = 401;

function fetchFrom(path: string, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(`${ORIGIN}${path}`, init);
}

describe("server card through the full Worker", () => {
  it("answers the card with the discovery CORS headers", async () => {
    const response = await fetchFrom("/mcp/server-card");
    const expected = serverCard({
      ...TEST_CONTEXT,
      origin: ORIGIN,
      mcpUrl: `${ORIGIN}/mcp`,
      dashboardUrl: `${ORIGIN}/dashboard`,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(CARD_CONTENT_TYPE);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-expose-headers")).toBe("ETag");
    expect(await response.json()).toEqual(JSON.parse(JSON.stringify(expected)));
  });

  it.each(["/mcp/server-card", "/.well-known/ai-catalog.json"])("answers the %s preflight with 204 and the discovery CORS headers", async (path) => {
    const response = await fetchFrom(path, { method: "OPTIONS" });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-methods")).toBe("GET");
    expect(response.headers.get("access-control-allow-headers")).toBe("Content-Type, If-None-Match");
    expect(response.headers.get("access-control-expose-headers")).toBe("ETag");
    expect(await response.text()).toBe("");
  });

  it("still refuses POST /mcp without a bearer token", async () => {
    const response = await fetchFrom("/mcp", { method: "POST", body: "{}" });

    expect(response.status).toBe(UNAUTHORIZED);
  });

  it.each(["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-authorization-server"])(
    "answers 200 for the metadata URL %s named in the card",
    async (path) => {
      expect((await fetchFrom(path)).status).toBe(200);
    },
  );
});
