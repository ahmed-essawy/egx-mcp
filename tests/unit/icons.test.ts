import { describe, expect, it } from "vitest";
import { mcpIcons } from "../../src/http/icons";

const ORIGIN = "https://egx.example.com";

describe("mcpIcons", () => {
  it("builds absolute PNG icon URLs on the given origin", () => {
    expect(mcpIcons(ORIGIN)).toEqual([
      { src: "https://egx.example.com/favicon-32.png", mimeType: "image/png", sizes: ["32x32"] },
      { src: "https://egx.example.com/icon-192.png", mimeType: "image/png", sizes: ["192x192"] },
      { src: "https://egx.example.com/icon-512.png", mimeType: "image/png", sizes: ["512x512"] },
    ]);
  });

  it("keeps only the origin of a URL with a path", () => {
    expect(mcpIcons(`${ORIGIN}/some/path`)[0]?.src).toBe("https://egx.example.com/favicon-32.png");
  });
});
