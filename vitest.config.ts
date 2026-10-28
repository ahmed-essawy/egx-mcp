import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { configDefaults, defineConfig } from "vitest/config";

const NODE_TEST_FILES = [
  "tests/unit/backfill.test.ts",
  "tests/unit/fundamentals-store.test.ts",
  "tests/unit/funds-store.test.ts",
  "tests/unit/oauth-guard.test.ts",
  "tests/unit/sign-in.test.ts",
  "tests/unit/server.test.ts",
];

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
  return {
    test: {
      passWithNoTests: true,
      projects: [
        {
          extends: true,
          plugins: [
            cloudflareTest({
              wrangler: { configPath: "./wrangler.jsonc" },
              miniflare: {
                compatibilityDate: "2026-08-22",
                bindings: { TEST_MIGRATIONS: migrations, PUBLIC_ORIGIN: "" },
              },
            }),
          ],
          test: {
            name: "workers",
            setupFiles: ["tests/setup.ts"],
            exclude: [...configDefaults.exclude, ...NODE_TEST_FILES],
          },
        },
        {
          test: {
            name: "node",
            environment: "node",
            include: NODE_TEST_FILES,
          },
        },
      ],
    },
  };
});
