import { describe, expect, it } from "vitest";
import { BEARER_HEADER, CONNECT_NOTE, VALUE_LINE } from "../../src/http/views";
import { serverCard } from "../../src/site/discovery";
import { LOCALIZED, SITE } from "../../src/site/identity";
import { legalSectionsOf, newestUpdated, PAGES, type PublicPage } from "../../src/site/pages";
import { llmsTxt } from "../../src/site/render-markdown";
import { TEST_CONTEXT } from "../helpers/site";

type ContentPin = readonly [path: string, updated: string, sha256: string];

const CTX = TEST_CONTEXT;
const ENCODER = new TextEncoder();
const HEX_RADIX = 16;
const HEX_BYTE_WIDTH = 2;
const LAST_UPDATED_PATTERN = /^Last updated: (\d{4}-\d{2}-\d{2})$/m;
const UPDATED_KEY = `${SITE.registryName.split("/")[0]}/updated`;

const CONTENT_PINS: readonly ContentPin[] = [
  ["/", "2026-10-31", "356e9182be9f7c36a824e540660c8ba9ce22511f9e4974eaa4b0898cd53a6114"],
  ["/tools", "2026-10-31", "69681109cbbeb2bceea09944b3c4d78e983be047d2545d33d3d7f46b7f9a1928"],
  ["/connect/claude", "2026-10-31", "7ed69b405335bba2a18b93d743c3d73b55d26a403f145b2f8a0e16a23e8e4b53"],
  ["/connect/chatgpt", "2026-10-31", "d64b3724990e8ac603b98945f504141c35b7e5fd163d89161df63335911d45db"],
  ["/connect/claude-code", "2026-10-31", "75ed4e8a07cc7d6ea17a91748adab27e554870e2531bbbde20f2d625e6d91174"],
  ["/connect/cursor", "2026-10-31", "5843b88da4c430f8a6ea6a9fa5812094ef561f29734566ae4f6d05f8872e9395"],
  ["/faq", "2026-10-31", "655fd7f2729686e212aced867e0354e83dd2d0865d7503d20b636b20dc8fe808"],
  ["/data", "2026-10-31", "21fed6b59780573fd746bcac46b4bfeec05f959e0d25f65b03c04d32b1a39848"],
  ["/privacy", "2026-10-28", "6c58ee9a0b387eb4e992d69d8662a83a0df66e93573c2a6fab6b7885b77396de"],
  ["/terms", "2026-10-28", "f7a9b4473a3046533111ab6a22538bd09146fe8909ae73f3f499117bad2f4d3a"],
];

function visibleText(page: PublicPage): object {
  if (page.kind === "legal") return { content: legalSectionsOf(page) };
  const text = { content: page.content(CTX), notice: LOCALIZED.en.notice };
  if (page.kind !== "home") return text;
  return { ...text, valueLine: VALUE_LINE, connectNote: CONNECT_NOTE, bearerHeader: BEARER_HEADER };
}

async function contentHash(page: PublicPage): Promise<string> {
  const payload = JSON.stringify({ title: page.title(CTX), description: page.description, ...visibleText(page) });
  const digest = await crypto.subtle.digest("SHA-256", ENCODER.encode(payload));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(HEX_RADIX).padStart(HEX_BYTE_WIDTH, "0")).join("");
}

describe("content freshness pins", () => {
  it("pins every page once", () => {
    expect(CONTENT_PINS.map(([path]) => path).sort()).toEqual(PAGES.map((page) => page.path).sort());
  });

  it.each(PAGES.map((page) => [page.path, page] as const))("%s keeps its pinned text and date", async (path, page) => {
    const pin = CONTENT_PINS.find(([pinned]) => pinned === path);
    const hash = await contentHash(page);
    const message = `${path}: text hash is now ${hash}; bump updated in src/site/pages.ts and this pin together`;
    expect(pin?.[1], message).toBe(page.updated);
    expect(pin?.[2], message).toBe(hash);
  });

  it("dates the summary files and the server card with the newest page", () => {
    const newest = newestUpdated();
    expect(LAST_UPDATED_PATTERN.exec(llmsTxt(CTX))?.[1]).toBe(newest);
    expect((serverCard(CTX)._meta as Record<string, unknown>)[UPDATED_KEY]).toBe(newest);
  });
});
