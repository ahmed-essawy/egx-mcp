# Tasks: Privacy policy and terms of use pages

**Input**: [spec.md](spec.md), [plan.md](plan.md). Repo: `D:/Work/egx-mcp.pipeline/legal-pages` for every task (one repo, so no `[P]`). Order is strict: each test task is written and seen failing before its code task. No code comments (project rule). Verify per task: `npm run typecheck` and the Node-pool unit run from plan.md.

## Phase 1: Shared footer and agreement notice (US1, US2)

- [x] T001 [US2] Tests in `tests/unit/views.test.ts` (extend the existing `page`, `landingView` and `consentView` blocks; import the new path constants):
  - `page()` output contains `<footer>` after `</main>` with `<nav aria-label="Site">` and links `href="/"`, `href="/privacy"`, `href="/terms"` with texts Home, Privacy policy, Terms of use.
  - `landingView()` contains "By signing in you agree to the" with `href="/terms"` and `href="/privacy"` inside that paragraph, placed after `href="/dashboard"`.
  - `consentView(...)` contains "By authorizing you agree to the" with both links.
  - `STYLESHEET` contains `main, footer {` and `footer { border-top`.
  - `PRIVACY_PATH === "/privacy"`, `TERMS_PATH === "/terms"`, `HOME_PATH === "/"`.
  Acceptance: these tests fail; all existing tests in the file still pass.
- [x] T002 [US2] Implement in `src/http/views.ts` per plan.md Design (path constants, private `siteFooter()`, private `agreementNotice(action)`, `landingView` and `consentView` use it, stylesheet selectors, export `DATA_SOURCES`). Acceptance: T001 tests pass; `dashboard.test.ts`, `routes.test.ts` unchanged and passing; typecheck clean.

## Phase 2: Legal views (US1, US2)

- [x] T003 [US1] Tests in new `tests/unit/legal.test.ts` (style of `views.test.ts`: constants at top, `describe` per view):
  - `privacyView()`: `<h1>Privacy policy</h1>`; "Last updated: 2026-10-28" (from `LEGAL_LAST_UPDATED`); the twelve `<h2>` texts of spec FR-L03 in that order (extract with a regex over `<h2[^>]*>([^<]+)</h2>` and compare with `toEqual`); contains `Ahmed M. Essawy`, `href="mailto:ahm.elessawy@gmail.com"`, "Google account identifier", "email address", "display name", "SHA-256", "90 days", "12 hours", "Cloudflare", "__Host-egx_session", "under 18", "30 days"; links `href="/terms"`.
  - `termsView()`: `<h1>Terms of use</h1>`; last-updated line; the twelve `<h2>` texts of FR-L04 in order; contains "delayed", "unofficial", "informational only", every entry of `DATA_SOURCES`, "buy, sell or hold", "as is", the `GOVERNING_LAW_TEXT` value, the mailto link, `href="/privacy"`.
  - Both: no `<script`, no `<style`, no `style=`, no `<form`; contain the footer nav (from `page()`); every `<section>` has `aria-labelledby` matching an `<h2 id>`.
  Acceptance: fails (module missing).
- [x] T004 [US1] Create `src/http/legal.ts` per plan.md Design with the section facts of spec FR-L03 and FR-L04 (plain short sentences, no em or en dashes). Acceptance: T003 passes; typecheck clean; every statement checks against spec 001, data-model.md and the code (reviewer confirms).

## Phase 3: Routes (US1, US2)

- [x] T005 [US1] Tests in `tests/unit/routes.test.ts`: `it.each(["/privacy", "/terms"])` GET with `{} as Env`: status 200; headers `content-type` contains `text/html`, `content-security-policy` `default-src 'self'; frame-ancestors 'none'`, `x-content-type-options` `nosniff`, `referrer-policy` `same-origin`, `cache-control` `no-store`; `set-cookie` is null; body contains the page `<h1>`. Add `["POST", "/privacy"]` and `["POST", "/terms"]` to the existing 404 table. Acceptance: GET cases fail before T006.
- [x] T006 [US1] Register both routes in `ROUTES` in `src/http/routes.ts` after `/styles.css` (plan.md Design). Acceptance: T005 passes; the empty `Env` proves no binding read.

## Phase 4: README (US3)

- [x] T007 [US3] Edit `README.md` (no em or en dashes; no code change; no claim beyond the build):
  - In the top "Current build (MVP)" paragraph area or "Connect from Claude" intro: the public server is at `https://egx-mcp.essawy.workers.dev/` (home page, linked), MCP address `https://egx-mcp.essawy.workers.dev/mcp`; people who deploy their own copy use their own `<PUBLIC_ORIGIN>` instead.
  - Replace `<PUBLIC_ORIGIN>` with `https://egx-mcp.essawy.workers.dev` in the three Connect sections (MCP address, dashboard links, Claude Code `--header "Authorization: Bearer <your key>"` command, Cursor JSON `url`) and in the Troubleshooting `unauthorized` row. Keep `<PUBLIC_ORIGIN>` in "Install and deploy from a clean Windows machine" and in the deployer-configuration Troubleshooting rows (sign-in redirect URIs, `PUBLIC_ORIGIN` errors).
  - Keep every "(coming later)" statement about OAuth sign-in for Claude and ChatGPT unchanged in meaning.
  - Add `## Privacy and terms` after `## Troubleshooting` (end of file): one sentence each linking `https://egx-mcp.essawy.workers.dev/privacy` and `https://egx-mcp.essawy.workers.dev/terms`, and the contact `ahm.elessawy@gmail.com` for account deletion.
  Acceptance: `npm run check:readme` prints "README check passed" (no script change: it checks heading presence, not order); a search for the em dash and en dash characters in README.md finds none; `<PUBLIC_ORIGIN>` remains only in deployer sections.

## Phase 5: Verify

- [x] T008 Run `npm run typecheck`, the Node-pool unit run and `npm run check:readme`. Acceptance: typecheck clean; no failure beyond the 8 known Workers-only failures; README check passed. Record the Workers pool as NOT RUN (compatibility date blocker).
