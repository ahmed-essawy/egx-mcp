import { describe, expect, it } from "vitest";
import { defaultHandler } from "../../src/http/routes";

const ORIGIN = "https://egx.example.com";
const NOT_IMPLEMENTED = 501;
const NOT_FOUND = 404;

async function call(path: string, method = "GET"): Promise<Response> {
  const request = new Request(`${ORIGIN}${path}`, { method });
  return defaultHandler.fetch!(request as never, {} as Env, {} as ExecutionContext);
}

describe("defaultHandler", () => {
  it("serves the landing page as HTML", async () => {
    const response = await call("/");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'self'; frame-ancestors 'none'");
  });

  it("serves the stylesheet as CSS with the security headers", async () => {
    const response = await call("/styles.css");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/css");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toContain("body {");
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
    ["GET", "/dashboard/keys/key-1/revoke"],
  ])("answers %s %s with 404", async (method, path) => {
    expect((await call(path, method)).status).toBe(NOT_FOUND);
  });
});
