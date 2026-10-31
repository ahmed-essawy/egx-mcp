# Implementation Plan: Icon and test cleanup

**Branch**: `feat/cleanup-icons-tests` | **Date**: 2026-10-31 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/007-cleanup-icons-tests/spec.md`. BASE `6683d29f8327f157214482b9f884a5cdd7b9dd35` (= `origin/main` at planning time).

## Summary

Four small changes in one squash commit: one icon table in `src/http/icons.ts` drives the page head links, the MCP icon list and the icon routes; icon responses get their own image headers in `src/http/routes.ts`; those headers add `access-control-allow-origin: *` (the only behavior change); all test files move from the deprecated `env`/`SELF` of `cloudflare:test` to `env`/`exports` of `cloudflare:workers`.

## Technical Context

**Language/Version**: TypeScript 7.0.2 on Cloudflare Workers (compatibility date 2026-10-01, `nodejs_compat`)
**Primary Dependencies**: wrangler 4.156.0, @cloudflare/workers-oauth-provider 1.2.4, @modelcontextprotocol/server 2.3.1 (`Icon` type), vitest 4.1.12, @cloudflare/vitest-plugin 1.4.11
**Storage**: none touched (no D1, KV or query change, so no data-access performance risk)
**Testing**: vitest, Workers pool (`tests/setup.ts`) and Node pool (`NODE_TEST_FILES` in `vitest.config.ts`)
**Target Platform**: Cloudflare Workers
**Project Type**: single project
**Performance Goals**: unchanged; icon bytes are still decoded once at module load
**Constraints**: business behavior identical except FR-005; head links and MCP icon list byte and value identical
**Scale/Scope**: 3 source files, 1 contract doc, 33 test files touched by an import line, 1 new test file

### Research notes (verified, not guessed)

- `node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts` (1.4.11): `env` is `@deprecated Instead, use import { env } from "cloudflare:workers"`; `SELF` is `@deprecated Instead, use import { exports } from "cloudflare:workers" and exports.default.fetch()`. `applyD1Migrations` and the `D1Migration` type are not deprecated and stay on `cloudflare:test`.
- `node_modules/@cloudflare/vitest-plugin/dist/worker/lib/cloudflare/test-internal.mjs`: the plugin's own `env` is the `env` of `cloudflare:workers` (same object), and `SELF` is a proxy over `exports.default`. So the migration keeps object identity: `setBindings` mutations and `vi.spyOn(env.RATE_LIMITER, ...)` still reach the Worker under test.
- `worker-configuration.d.ts` declares `cloudflare:workers` `env: Cloudflare.Env` and `exports: Cloudflare.Exports`, with `GlobalProps.mainModule = typeof import("./src/index")`; `exports.default` is typed `Fetcher & ...`, so `exports.default.fetch(url, init)` takes the same arguments as `SELF.fetch`. `tests/env.d.ts` augments `Cloudflare.Env` with `TEST_MIGRATIONS`, so `env.TEST_MIGRATIONS` stays typed.
- Cloudflare docs "Test APIs" (developers.cloudflare.com/workers/testing/vitest-integration/test-apis/) show `import { env, exports } from "cloudflare:workers"` and `exports.default.fetch(...)`. The "Migrate to Vitest plugin" guide named in the request only covers the package rename (`vitest-pool-workers` 0.x to `vitest-plugin` 1.x, types path), already done in this repo.
- `@cloudflare/workers-oauth-provider` 1.2.4 `dist/oauth-provider.js` lines 2936 to 2940: default-handler responses are returned as is (CORS is added only to its own API, token, registration and metadata routes), so the icon header reaches the client unchanged.

## Design

### `src/http/icons.ts` (single table)

Remove the import from `./views` (it would become a cycle). Keep the six `*_BASE64` constants, `LEGACY_FAVICON_PATH`, `PNG_CONTENT_TYPE`, `ICO_CONTENT_TYPE` and `fromBase64Url` import as they are. Replace `MCP_ICON_SIZES`, `pngAsset` and the hand-written `ICONS` entries with:

```ts
export type IconAsset = { body: Uint8Array; contentType: string };
export type PageIconRel = "icon" | "apple-touch-icon";
export type PageIcon = { rel: PageIconRel; path: string; sizes: string; contentType: string };

type ImageSource = { path: string; contentType: string; base64: string };
type ListedIconSource = ImageSource & { size: number; pageRel?: PageIconRel; inMcpList: boolean };

export const LOGO_PATH = "/logo-96.png";

const LISTED_ICONS: readonly ListedIconSource[] = [
  { path: "/favicon-32.png", size: 32, contentType: PNG_CONTENT_TYPE, base64: FAVICON_PNG_BASE64, pageRel: "icon", inMcpList: true },
  { path: "/icon-192.png", size: 192, contentType: PNG_CONTENT_TYPE, base64: ICON_PNG_BASE64, pageRel: "icon", inMcpList: true },
  { path: "/apple-touch-icon.png", size: 180, contentType: PNG_CONTENT_TYPE, base64: APPLE_TOUCH_ICON_PNG_BASE64, pageRel: "apple-touch-icon", inMcpList: false },
  { path: "/icon-512.png", size: 512, contentType: PNG_CONTENT_TYPE, base64: LARGE_ICON_PNG_BASE64, inMcpList: true },
];

const UNLISTED_IMAGES: readonly ImageSource[] = [
  { path: LEGACY_FAVICON_PATH, contentType: ICO_CONTENT_TYPE, base64: FAVICON_ICO_BASE64 },
  { path: LOGO_PATH, contentType: PNG_CONTENT_TYPE, base64: LOGO_PNG_BASE64 },
];

function squareSizes(size: number): string  // returns `${size}x${size}`

export const ICONS: ReadonlyMap<string, IconAsset>
  // new Map of [...LISTED_ICONS, ...UNLISTED_IMAGES] mapped to [path, { body: fromBase64Url(base64), contentType }]

export const PAGE_ICONS: readonly PageIcon[]
  // LISTED_ICONS entries with pageRel set, in table order, mapped to { rel: pageRel, path, sizes: squareSizes(size), contentType }

export function mcpIcons(origin: string): Icon[]
  // LISTED_ICONS filtered by inMcpList, in table order, mapped to { src: new URL(path, origin).href, mimeType: contentType, sizes: [squareSizes(size)] }
```

Table order (32, 192, 180, 512) gives the head order 32, 192, 180 and the MCP order 32, 192, 512, both as today. `PAGE_ICONS` is built with `LISTED_ICONS.flatMap(({ path, size, contentType, pageRel }) => pageRel === undefined ? [] : [{ rel: pageRel, path, sizes: squareSizes(size), contentType }])`. `mcpIcons` uses `filter(({ inMcpList }) => inMcpList).map(...)`. The paths of listed icons are written only in the table (SC-004); the old exported `FAVICON_PATH`, `ICON_PATH`, `APPLE_TOUCH_ICON_PATH`, `LARGE_ICON_PATH` constants are removed (no other user, checked with grep).

### `src/http/views.ts`

- Delete lines 12 to 16 (`FAVICON_PATH` ... `LOGO_PATH`).
- Add `import { LOGO_PATH, PAGE_ICONS, type PageIcon } from "./icons";` with the other imports (sorted as the file does: by module path, so after `../store/d1/users`).
- Replace `iconLinks()` with:

```ts
function iconLink(icon: PageIcon): string  // `<link rel="${icon.rel}"${typeAttribute} sizes="${icon.sizes}" href="${icon.path}">`, typeAttribute = ` type="${icon.contentType}"` when rel is "icon", else ""
function iconLinks(): string               // PAGE_ICONS.map(iconLink).join("\n")
```

The apple touch link carries no `type` today; the rel rule keeps the output byte identical (FR-002, checked by `ICON_LINKS` in `tests/helpers/html.ts`). `siteHeader()` keeps using `LOGO_PATH`, now imported.

### `src/http/routes.ts`

- Add, next to `ICON_CACHE_CONTROL`:

```ts
const IMAGE_HEADERS: Record<string, string> = {
  "cache-control": ICON_CACHE_CONTROL,
  "x-content-type-options": "nosniff",
  "access-control-allow-origin": "*",
};
```

- `iconResponse(icon)` becomes `new Response(icon.body, { headers: { ...IMAGE_HEADERS, "content-type": icon.contentType } })`.
- `stylesheetResponse` and `HTML_HEADERS` are not changed (FR-006).

Header change summary for every icon path: added `access-control-allow-origin: *` (behavior change, FR-005); removed `content-security-policy: default-src 'self'; frame-ancestors 'none'` and `referrer-policy: same-origin` (HTML policy that does not apply to a PNG or ICO body; no client effect); `content-type`, `cache-control`, `x-content-type-options` unchanged. No `Vary` needed with a fixed `*`.

### Tests (`cloudflare:test` to `cloudflare:workers`)

Every file in the list below changes only its import line(s) and, where `SELF` was used, `SELF.fetch(` to `exports.default.fetch(`:

- `env` only, `import { env } from "cloudflare:test";` becomes `import { env } from "cloudflare:workers";`: `tests/contract/{admin,fundamentals,funds,history,movers,personal,prices,quotes,search}.test.ts`, `tests/helpers/{bindings,jobs,seed,session}.ts`, `tests/integration/{isolation,limits}.test.ts`, `tests/jobs/{discovery,end-of-day-bars,listing-sync,maintenance,metals,reference-fundamentals,reference-funds,snapshot}.test.ts`, `tests/unit/{api-keys,config,routes,usage-store}.test.ts`.
- `env as workerEnv`: `tests/unit/authorize.test.ts` (line 1) and `tests/unit/authorize-charge.test.ts` (line 2) become `import { env as workerEnv } from "cloudflare:workers";`.
- `tests/setup.ts`: `import { applyD1Migrations } from "cloudflare:test";` plus `import { env } from "cloudflare:workers";`.
- `tests/helpers/mcp.ts`: `import { exports } from "cloudflare:workers";`, `SELF.fetch(` to `exports.default.fetch(`.
- `tests/integration/api-keys.test.ts`, `tests/integration/oauth.test.ts`: `import { env, exports } from "cloudflare:workers";`, every `SELF.fetch(` to `exports.default.fetch(` (2 in api-keys, 17 in oauth).
- `tests/env.d.ts` keeps `import type { D1Migration } from "cloudflare:test";`.

Import order inside each file: keep the moved import in the same line position (first line), as the files do today.

### Data access and patterns

No query or data-access change. No new pattern: the table removes the present duplication between `iconLinks()` and `MCP_ICON_SIZES` (and the paths kept in `views.ts` only to feed `icons.ts`).

## Constitution Check

- I Honest Delayed Data, II Cache-Only Reads, III Data Integrity, VI Informational Scope: not touched (no data, tool or job change). PASS.
- IV Zero-Cost: no new binding, request or job; icon responses still read no D1 or KV. PASS.
- V Secure Multi-User Access: CORS `*` only on public, credential-free images with no cookie; OAuth, dashboard, `/mcp` unchanged; no secret involved. PASS.
- Quality gates: tests first per task, review in a fresh reviewer, nothing pushed without the owner. PASS.

## Project Structure

### Documentation (this feature)

```text
specs/007-cleanup-icons-tests/
  spec.md
  plan.md
  tasks.md
  qa-cases.md
  checklists/requirements.md
```

### Source Code (touched)

```text
src/http/icons.ts      table, PAGE_ICONS, ICONS, mcpIcons
src/http/views.ts      iconLinks from PAGE_ICONS, LOGO_PATH import
src/http/routes.ts     IMAGE_HEADERS
specs/001-egx-mcp-server/contracts/http-endpoints.md   icon rows: new header set
tests/**               import migration (33 files), new tests/integration/icons.test.ts
```

## Deviations noted

- `src/http/routes.ts` `stylesheetResponse` still spreads `HTML_HEADERS` (HTML CSP and `referrer-policy` on CSS). Kept: out of this request. Cost to fix: one small header table plus a test, a follow-up candidate.
- Header values are inline string literals in header maps (`"nosniff"`, `"*"`), as `HTML_HEADERS` does. Kept for consistency.

## Complexity Tracking

None.
