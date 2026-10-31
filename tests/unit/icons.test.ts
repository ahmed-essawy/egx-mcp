import { describe, expect, it } from "vitest";
import { ICONS, mcpIcons, PAGE_ICONS } from "../../src/http/icons";

const ORIGIN = "https://egx.example.com";
const PNG = "image/png";

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

describe("PAGE_ICONS", () => {
  it("lists the head icons in page order", () => {
    expect(PAGE_ICONS).toEqual([
      { rel: "icon", path: "/favicon-32.png", sizes: "32x32", contentType: PNG },
      { rel: "icon", path: "/icon-192.png", sizes: "192x192", contentType: PNG },
      { rel: "apple-touch-icon", path: "/apple-touch-icon.png", sizes: "180x180", contentType: PNG },
    ]);
  });
});

describe("ICONS", () => {
  it("serves every image path with its type", () => {
    expect(new Map([...ICONS].map(([path, icon]) => [path, icon.contentType]))).toEqual(
      new Map([
        ["/favicon-32.png", PNG],
        ["/icon-192.png", PNG],
        ["/apple-touch-icon.png", PNG],
        ["/icon-512.png", PNG],
        ["/favicon.ico", "image/x-icon"],
        ["/logo-96.png", PNG],
        ["/og-image.png", PNG],
      ]),
    );
  });
});
