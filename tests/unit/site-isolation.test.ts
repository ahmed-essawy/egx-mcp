import { describe, expect, it } from "vitest";

const SITE_SOURCES = import.meta.glob("../../src/site/**/*.ts", { query: "?raw", import: "default", eager: true });
const FORBIDDEN_IMPORT = /from\s+"[^"]*(store\/kv|limits\/|providers\/|jobs\/|auth\/)[^"]*"/;
const D1_SPECIFIER_PATTERN = /(?:\bfrom\s*|\bimport\s*\(?\s*)["'][^"']*store\/d1\/[^"']*["']/g;
const D1_NAMED_PATTERN = /\b(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["'][^"']*store\/d1\/[^"']*["']/g;
const ALLOWED_D1_NAMES = new Set(["MAX_ITEMS_PER_USER", "MAX_ACTIVE_KEYS", "MAX_SINCE_AGE_DAYS"]);
const UNNAMED_D1_IMPORT = "non-named store/d1 import";
const FORBIDDEN_TEXT = "workers.dev";
const D1_PATH = "../../store/d1/personal";

function importedName(entry: string): string {
  return (entry.trim().split(/\s+as\s+/)[0] ?? "").replace(/^type\s+/, "").trim();
}

function d1Violations(source: string): string[] {
  const named = [...source.matchAll(D1_NAMED_PATTERN)];
  const names = named
    .flatMap((match) => (match[1] ?? "").split(","))
    .map(importedName)
    .filter((name) => name !== "");
  const unnamedCount = [...source.matchAll(D1_SPECIFIER_PATTERN)].length - named.length;
  return [
    ...names.filter((name) => !ALLOWED_D1_NAMES.has(name)),
    ...Array.from({ length: unnamedCount }, () => UNNAMED_D1_IMPORT),
  ];
}

const FORBIDDEN_D1_SAMPLES: Record<string, string> = {
  "named import of another name": `import { getUser } from "${D1_PATH}";`,
  "named type import of another name": `import type { UserRow } from "${D1_PATH}";`,
  "aliased named import of another name": `import { getUser as load } from "${D1_PATH}";`,
  "named import mixing allowed and other names": `import { MAX_ACTIVE_KEYS, getUser } from "${D1_PATH}";`,
  "multi-line named import": `import {
  MAX_ITEMS_PER_USER,
  getUser,
} from "${D1_PATH}";`,
  "namespace import": `import * as personal from "${D1_PATH}";`,
  "default import": `import personal from "${D1_PATH}";`,
  "default and named import": `import personal, { MAX_ITEMS_PER_USER } from "${D1_PATH}";`,
  "export star": `export * from "${D1_PATH}";`,
  "export namespace": `export * as personal from "${D1_PATH}";`,
  "named re-export of another name": `export { getUser } from "${D1_PATH}";`,
  "bare side-effect import": `import "${D1_PATH}";`,
  "dynamic import": `const personal = await import("${D1_PATH}");`,
  "single-quoted specifier": `import * as personal from '${D1_PATH}';`,
};

const ALLOWED_D1_SAMPLES: Record<string, string> = {
  "allowed named import": `import { MAX_ITEMS_PER_USER } from "${D1_PATH}";`,
  "allowed names across modules": `import { MAX_ACTIVE_KEYS } from "../../store/d1/users";
import { MAX_SINCE_AGE_DAYS } from "../../store/d1/events";`,
  "allowed type-qualified and aliased names": `import { type MAX_ITEMS_PER_USER, MAX_ACTIVE_KEYS as keys } from "${D1_PATH}";`,
  "unrelated import": `import { SITE } from "./identity";`,
};

describe("site module isolation", () => {
  it("finds the site sources", () => {
    expect(Object.keys(SITE_SOURCES).length).toBeGreaterThan(0);
  });

  for (const [form, sample] of Object.entries(FORBIDDEN_D1_SAMPLES)) {
    it(`catches a ${form}`, () => {
      expect(d1Violations(sample)).not.toEqual([]);
    });
  }

  for (const [form, sample] of Object.entries(ALLOWED_D1_SAMPLES)) {
    it(`accepts ${form}`, () => {
      expect(d1Violations(sample)).toEqual([]);
    });
  }

  for (const [file, source] of Object.entries(SITE_SOURCES)) {
    it(`keeps ${file} free of storage, limits, providers and live hosts`, () => {
      expect(source).not.toMatch(FORBIDDEN_IMPORT);
      expect(d1Violations(source)).toEqual([]);
      expect(source).not.toContain(FORBIDDEN_TEXT);
    });
  }
});
