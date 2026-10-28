import { describe, expect, it } from "vitest";
import { authorizeHandler, grantedScopes } from "../../src/http/authorize";

const READ_SCOPE = "mcp:read";
const WRITE_SCOPE = "mcp:write";
const HANDLE = "consent-handle";
const BINDING_COOKIE = "__Host-consent=bound; Path=/; Secure; HttpOnly";

function providerFor(details: Record<string, unknown>): Env["OAUTH_PROVIDER"] {
  return {
    parseAuthRequest: async () => ({ scope: [READ_SCOPE] }),
    describeConsent: async () => details,
    beginConsent: async () => {
      const headers = new Headers({ "cache-control": "no-store" });
      headers.append("set-cookie", BINDING_COOKIE);
      return { handle: HANDLE, headers };
    },
  } as unknown as Env["OAUTH_PROVIDER"];
}

describe("grantedScopes", () => {
  it("grants both scopes when the client requested none", () => {
    expect(grantedScopes([])).toEqual([READ_SCOPE, WRITE_SCOPE]);
  });

  it("grants only the requested supported scopes", () => {
    expect(grantedScopes([READ_SCOPE])).toEqual([READ_SCOPE]);
    expect(grantedScopes([WRITE_SCOPE, READ_SCOPE])).toEqual([WRITE_SCOPE, READ_SCOPE]);
  });

  it("drops unsupported scopes from a mixed request", () => {
    expect(grantedScopes(["openid", WRITE_SCOPE])).toEqual([WRITE_SCOPE]);
  });

  it("grants read only when the request is openid only", () => {
    expect(grantedScopes(["openid"])).toEqual([READ_SCOPE]);
  });

  it("grants read only when the requested scope is misspelled", () => {
    expect(grantedScopes(["mcp:reed"])).toEqual([READ_SCOPE]);
  });
});

describe("authorizeHandler", () => {
  async function consentFor(details: Record<string, unknown>): Promise<Response> {
    const env = { OAUTH_PROVIDER: providerFor(details) } as Env;
    return authorizeHandler(new Request("https://egx.example/authorize"), env);
  }

  it("renders the redirect host, the loopback warning and the unverified client text", async () => {
    const response = await consentFor({
      clientName: "Local App",
      redirectHost: "localhost",
      redirectIsLoopback: true,
    });
    const html = await response.text();

    expect(html).toContain("Access will be sent to <strong>localhost</strong>.");
    expect(html).toContain("on your own computer");
    expect(html).toContain("its name is not verified");
  });

  it("renders the client domain of a published client", async () => {
    const response = await consentFor({
      clientName: "Published App",
      clientDomain: "app.example",
      redirectHost: "app.example",
      redirectIsLoopback: false,
    });

    expect(await response.text()).toContain("This app is published by app.example.");
  });

  it("forbids framing and keeps the page headers and the binding cookie", async () => {
    const response = await consentFor({ clientName: "App", redirectHost: "app.example", redirectIsLoopback: false });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'self'; frame-ancestors 'none'");
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.getSetCookie()).toEqual([BINDING_COOKIE]);
  });
});
