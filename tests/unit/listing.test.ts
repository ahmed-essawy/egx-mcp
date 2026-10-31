import { describe, expect, it } from "vitest";
import descriptions from "../../docs/listing/descriptions.md?raw";
import registries from "../../docs/listing/registries.md?raw";
import serverJson from "../../docs/listing/server.json?raw";
import wrangler from "../../wrangler.jsonc?raw";
import { serverCard } from "../../src/site/discovery";
import { SITE } from "../../src/site/identity";
import { PREVIEW_IMAGE_PATH } from "../../src/site/paths";

const REGISTRY_NAME_PATTERN = /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/;
const REGISTRY_DESCRIPTION_MAX = 100;
const STATUS_NOT_SUBMITTED = "not submitted";
const STATUS_COLUMN = 4;
const LISTING_COLUMNS = ["Listing", "URL", "Method", "Text to use", "Status", "Date", "Notes"];
const REQUIRED_LISTINGS = [
  "Official MCP Registry",
  "Smithery",
  "PulseMCP",
  "mcp.so",
  "Glama",
  "awesome-remote-mcp-servers",
  "GitHub repository description and topics",
  "Google Search Console",
  "Bing Webmaster Tools",
  "IndexNow",
];
const LOGOS = [
  ["/icon-512.png", "512"],
  ["/icon-192.png", "192"],
  ["/favicon-32.png", "32"],
  [PREVIEW_IMAGE_PATH, "1200 by 630"],
];
const PERSON_PATTERNS = [/Ahmed Essawy/i, /gmail/i, /@/];

type Manifest = {
  name: string;
  title: string;
  description: string;
  version: string;
  websiteUrl: string;
  repository: { url: string };
  icons: { src: string }[];
  remotes: { url: string }[];
};

const origin = (JSON.parse(wrangler) as { vars: { PUBLIC_ORIGIN: string } }).vars.PUBLIC_ORIGIN;
const card = serverCard({
  origin,
  mcpUrl: `${origin}/mcp`,
  dashboardUrl: `${origin}/dashboard`,
  limits: { userDailyCalls: 0, globalDailyCalls: 0 },
});
const manifest = JSON.parse(serverJson) as Manifest;

function tableRows(markdown: string): string[][] {
  return markdown
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .map((line) =>
      line
        .slice(1, line.lastIndexOf("|"))
        .split("|")
        .map((cell) => cell.trim()),
    );
}

describe("registry manifest", () => {
  it("matches the server card for the configured origin", () => {
    expect(manifest.name).toBe(card.name);
    expect(manifest.title).toBe(card.title);
    expect(manifest.description).toBe(card.description);
    expect(manifest.version).toBe(card.version);
    expect(manifest.websiteUrl).toBe(card.websiteUrl);
    expect(manifest.repository.url).toBe(card.repository.url);
    expect(manifest.remotes).toEqual(card.remotes);
  });

  it("uses only icons the server card lists", () => {
    const cardIcons = card.icons.map(({ src }) => src);
    manifest.icons.forEach(({ src }) => expect(cardIcons).toContain(src));
  });

  it("fits the registry limits and names the site identity", () => {
    expect(manifest.name).toBe(SITE.registryName);
    expect(manifest.name).toMatch(REGISTRY_NAME_PATTERN);
    expect(manifest.description).toBe(SITE.registryDescription);
    expect(manifest.description.length).toBeLessThanOrEqual(REGISTRY_DESCRIPTION_MAX);
  });
});

describe("description kit", () => {
  it.each<readonly [string, string]>([
    ["name", SITE.name],
    ["one-sentence description", SITE.oneLine],
    ["registry description", SITE.registryDescription],
    ["short description", SITE.shortDescription],
    ["long description", SITE.longDescription],
    ...SITE.keywords.map((keyword): readonly [string, string] => ["keyword", keyword]),
  ])("contains the %s", (_label, text) => {
    expect(descriptions).toContain(text);
  });

  it.each(LOGOS)("lists the logo %s with its size", (path, size) => {
    expect(descriptions).toContain(`${origin}${path}`);
    expect(descriptions).toContain(size);
  });
});

describe("registry checklist", () => {
  const rows = tableRows(registries);

  it("has the agreed columns", () => {
    expect(rows[0]).toEqual(LISTING_COLUMNS);
  });

  it.each(REQUIRED_LISTINGS)("has %s marked not submitted", (listing) => {
    const row = rows.find((cells) => cells[0] === listing);
    expect(row?.[STATUS_COLUMN]).toBe(STATUS_NOT_SUBMITTED);
  });
});

describe("listing kit privacy", () => {
  it.each([
    ["server.json", serverJson],
    ["descriptions.md", descriptions],
    ["registries.md", registries],
  ])("%s names no person and no email", (_label, text) => {
    PERSON_PATTERNS.forEach((pattern) => expect(text).not.toMatch(pattern));
  });
});
