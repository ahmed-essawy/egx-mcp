# Tasks: Icon and test cleanup

**Input**: [spec.md](spec.md), [plan.md](plan.md). Repo: `D:/Work/EGX MCP` (the user's folder, branch `feat/cleanup-icons-tests`) for every task. One repo, so no `[P]`. Order is strict: each test task is written and seen failing (or, for regression guards, seen passing) before its code task. Commit split: single squash commit. QA cases: [qa-cases.md](qa-cases.md).

**HARD RULES (repeat in every implementer and reviewer prompt)**:
- Stack: TypeScript 7.0.2, Cloudflare Workers, @cloudflare/vitest-plugin 1.4.11, vitest 4.1.12. Follow plan.md "Design" exactly; no other design.
- Touch only: `src/http/icons.ts`, `src/http/views.ts`, `src/http/routes.ts`, the test files listed in plan.md "Tests", `tests/unit/icons.test.ts`, `tests/unit/routes.test.ts`, new `tests/integration/icons.test.ts`, `specs/001-egx-mcp-server/contracts/http-endpoints.md` (two icon rows), `specs/007-cleanup-icons-tests/*`. Never touch `specs/006-seo-ai-discoverability/`, `.specify/feature.json`, `.claude/`, `CLAUDE.md`.
- Never change the `*_BASE64` strings; never print or read them in full (they are about 150 KB; use `cut -c1-200` or Grep).
- Verify: `npm run typecheck; npm test` in `D:/Work/EGX MCP`. Baseline at BASE: typecheck clean, 70 files, 1466 tests, 0 failures. Any failure is new.
- No `wrangler dev` left running, no deploy, no Cloudflare call, no push, no commit.
- No comments in code, no em or en dashes in any text, no AI attribution. Never stage; the pipeline stages by explicit path at delivery.

## Phase 1: Test API migration (US4)

- [x] T001 [US4] Migrate the deprecated `cloudflare:test` imports in the 33 test files listed in plan.md "Tests (`cloudflare:test` to `cloudflare:workers`)":
  - `env` imports move to `cloudflare:workers` (keeping the `env as workerEnv` alias in `tests/unit/authorize.test.ts` and `tests/unit/authorize-charge.test.ts`).
  - `tests/setup.ts` becomes two imports: `applyD1Migrations` from `cloudflare:test`, `env` from `cloudflare:workers`.
  - `tests/helpers/mcp.ts`, `tests/integration/api-keys.test.ts`, `tests/integration/oauth.test.ts`: `exports` from `cloudflare:workers`; replace all 20 `SELF.fetch(` with `exports.default.fetch(` (1, 2, 17), arguments unchanged.
  - `tests/env.d.ts` unchanged.
  - Acceptance: `Grep` for `import \{[^}]*\b(SELF|env)\b[^}]*\} from "cloudflare:test"` over `tests/` returns 0 matches; `Grep` for `SELF` over `tests/` returns 0; `npm run typecheck` clean; `npm test` 70 files, 1466 tests pass. Implements QA-009, QA-010.

## Phase 2: Single icon table (US3)

- [x] T002 [US3] Tests in `tests/unit/icons.test.ts` (keep both existing `mcpIcons` cases unchanged):
  - Import `ICONS` and `PAGE_ICONS` from `../../src/http/icons`.
  - `describe("PAGE_ICONS")`, `it("lists the head icons in page order")`: `expect(PAGE_ICONS).toEqual([{ rel: "icon", path: "/favicon-32.png", sizes: "32x32", contentType: "image/png" }, { rel: "icon", path: "/icon-192.png", sizes: "192x192", contentType: "image/png" }, { rel: "apple-touch-icon", path: "/apple-touch-icon.png", sizes: "180x180", contentType: "image/png" }])`.
  - `describe("ICONS")`, `it("serves every image path with its type")`: `expect(new Map([...ICONS].map(([path, icon]) => [path, icon.contentType]))).toEqual(new Map([["/favicon-32.png", "image/png"], ["/icon-192.png", "image/png"], ["/apple-touch-icon.png", "image/png"], ["/icon-512.png", "image/png"], ["/favicon.ico", "image/x-icon"], ["/logo-96.png", "image/png"]]))`.
  - Use named constants for repeated literals as the file does (`ORIGIN` exists; add `const PNG = "image/png";`).
  - Acceptance: `npm run typecheck` fails on the missing `PAGE_ICONS` export (expected red before T003). Implements QA-007 (with the existing cases).

- [x] T003 [US3] Implement the table per plan.md "Design" in `src/http/icons.ts` and `src/http/views.ts`:
  - `icons.ts`: drop the `./views` import; add `PageIconRel`, `PageIcon`, `ImageSource`, `ListedIconSource`, `LOGO_PATH`, `LISTED_ICONS` (order 32, 192, 180, 512), `UNLISTED_IMAGES` (ico, logo), `squareSizes`, and derive `ICONS`, `PAGE_ICONS` (via `flatMap`) and `mcpIcons` from them; delete `MCP_ICON_SIZES` and `pngAsset`.
  - `views.ts`: delete `FAVICON_PATH`, `ICON_PATH`, `APPLE_TOUCH_ICON_PATH`, `LARGE_ICON_PATH`, `LOGO_PATH`; import `LOGO_PATH, PAGE_ICONS, type PageIcon` from `./icons`; `iconLink(icon)` and `iconLinks()` as in the plan.
  - Acceptance: T002 passes; `tests/unit/views.test.ts` (`ICON_LINKS` lines 101 and 413), `tests/contract/server-info.test.ts`, and `tests/unit/routes.test.ts` artwork SHA-256 and PNG size cases pass unchanged; `Grep` over `src/` for `favicon-32.png|icon-192.png|icon-512.png|apple-touch-icon.png|192x192|32x32|180x180` finds only `src/http/icons.ts`; `Grep` for `from "./views"` in `src/http/icons.ts` finds nothing. Implements QA-006, QA-007, QA-008, QA-002.

## Phase 3: Image headers and CORS (US1, US2)

- [x] T004 [US1][US2] Tests:
  - `tests/unit/routes.test.ts`: add constants `const ANY_ORIGIN = "*";`, `const HTML_CSP = "default-src 'self'; frame-ancestors 'none'";`, `const CSS_CACHE_CONTROL = "public, max-age=300";`. In the PNG `it.each` ("serves %s as a %i px PNG with a cache header") and in "serves /favicon.ico as a 16, 32 and 48 px icon", add: `access-control-allow-origin` is `ANY_ORIGIN`; `content-security-policy` is `null`; `referrer-policy` is `null`. In "serves the stylesheet as CSS with the security headers" add: `content-security-policy` is `HTML_CSP`; `cache-control` is `CSS_CACHE_CONTROL`; `access-control-allow-origin` is `null` (regression guard, passes before T005). Replace the existing landing page CSP literal with `HTML_CSP` only if it is the same string (it is, line 56).
  - New `tests/integration/icons.test.ts` (Workers pool), using `import { exports } from "cloudflare:workers";` and `describe, expect, it` from `vitest`:
    - `const ORIGIN = "https://egx.test";`, `const CLIENT_ORIGIN = "https://client.example";`, `const IMAGES: [string, string][] = [["/favicon-32.png", "image/png"], ["/favicon.ico", "image/x-icon"], ["/apple-touch-icon.png", "image/png"], ["/icon-192.png", "image/png"], ["/icon-512.png", "image/png"], ["/logo-96.png", "image/png"]];`
    - helper `function fetchFrom(path: string): Promise<Response>` returning `exports.default.fetch(`${ORIGIN}${path}`, { headers: { origin: CLIENT_ORIGIN } })`.
    - `it.each(IMAGES)("lets other origins read %s through the full Worker", ...)`: status 200; `content-type` equals the type; `access-control-allow-origin` is `"*"`; `set-cookie` is null.
    - `it("adds no CORS header to the landing page")`: `fetchFrom("/")` status 200 and `access-control-allow-origin` null.
  - Acceptance: the new icon header assertions and the integration `it.each` fail before T005 (red); the stylesheet and landing cases pass (green regression guards). Implements QA-001, QA-003, QA-004, QA-005.

- [x] T005 [US1][US2] Implement in `src/http/routes.ts` per plan.md: `IMAGE_HEADERS` next to `ICON_CACHE_CONTROL`; `iconResponse` spreads `IMAGE_HEADERS` then sets `content-type`; `HTML_HEADERS` import stays (used by `stylesheetResponse`). Acceptance: T004 passes; all other `tests/unit/routes.test.ts` cases (POST to icon paths 404, artwork hashes) pass. Implements QA-001, QA-003, QA-012.

## Phase 4: Docs and verify

- [x] T006 Update `specs/001-egx-mcp-server/contracts/http-endpoints.md` lines 28 and 29 to exactly these two rows (no other line changes):
  - `` | `GET /favicon-32.png`, `/apple-touch-icon.png`, `/icon-192.png`, `/icon-512.png`, `/logo-96.png` | PNG 32, 180, 192, 512, 96 px, `image/png`, `public, max-age=86400`, `nosniff`, `Access-Control-Allow-Origin: *`, no HTML CSP, no cookie, no D1 or KV read. Other methods 404 (spec 005, Amendment 1; image headers per spec 007) | ``
  - `` | `GET /favicon.ico` | ICO with 16, 32, 48 px, `image/x-icon`, same cache and image headers, no cookie, no D1 or KV read. Other methods 404 (spec 005, Amendment 1; image headers per spec 007) | ``
  - Acceptance: the two rows match FR-004; no em or en dash.

- [x] T007 Final verify: `npm run typecheck; npm test` (no failures; file and test counts at least 71 and 1466 plus the new cases); the Grep checks from T001 and T003 return 0 extra matches; `Grep` for `[\u2013\u2014]` over the changed files returns nothing; `git status --short` shows only the planned paths plus the untracked `specs/006-seo-ai-discoverability/` of the other session. Record the run file list for the state file.

## Dependencies

T001 first (new tests use the new API). T002 before T003. T004 before T005. T003 and T005 both before T006 and T007. Single commit at delivery.
