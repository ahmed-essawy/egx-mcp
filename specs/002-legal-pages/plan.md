# Implementation Plan: Privacy policy and terms of use pages

**Branch**: `002-legal-pages` (delivered as one squash commit on `feat/egx-mcp-server-mvp`) | **Date**: 2026-10-28 | **Spec**: [spec.md](spec.md)

## Summary

Two static, public HTML pages (`/privacy`, `/terms`) built with the existing `page()` helper in a new `src/http/legal.ts`, registered in the `ROUTES` table of `src/http/routes.ts` (not `src/index.ts`: it only wraps `defaultHandler` in the OAuth provider, and non-OAuth paths already fall through to it). One footer navigation added once inside `page()` links Home, Privacy and Terms on every page, plus an agreement sentence next to the sign-in link (home) and in the consent view. README gets the live address and a "Privacy and terms" section.

## Technical Context

- Stack: TypeScript 7.0.2, Cloudflare Workers, vitest 4.1.12. No new dependency, no binding, no migration, no KV or D1 access.
- Tests: Node-pool unit run (Workers pool is blocked by the compatibility date, NOT RUN). Command: copy `C:/Users/Essawy/AppData/Local/Temp/claude/D--Work-EGX-MCP/0bf8197e-b844-4583-96ca-87ebbf96f43f/scratchpad/vitest.unit.config.mjs` and its `cftest-shim.mjs` into this session's scratchpad, set `root` to `D:/Work/egx-mcp.pipeline/legal-pages`, run `npx vitest run --config <copy>`. Baseline at BASE 74317af: typecheck clean; the earlier run recorded Node pool 220 pass / 8 expected fail (Workers-only tests); only failures beyond those 8 count.
- Performance: pages are constant strings built per request from constants; no data access, so no query risk. `cache-control: no-store` is kept (existing contract: all HTML is `no-store`); caching would save nothing measurable.

## Design (exact)

- `src/http/views.ts`
  - Export `HOME_PATH = "/"`, `PRIVACY_PATH = "/privacy"`, `TERMS_PATH = "/terms"`.
  - `page()` appends after `</main>`: `<footer><nav aria-label="Site"><a href="/">Home</a> <a href="/privacy">Privacy policy</a> <a href="/terms">Terms of use</a></nav></footer>` built by a private `siteFooter()` from the path constants.
  - Private `agreementNotice(action: string): string` returns `<p>By ${action} you agree to the <a href="/terms">Terms of use</a> and acknowledge the <a href="/privacy">Privacy policy</a>.</p>`; `landingView()` uses `agreementNotice("signing in")` directly after the dashboard link paragraph; `consentView()` uses `agreementNotice("authorizing")` directly after the disclaimer paragraph.
  - `STYLESHEET`: change `main { ... }` selector to `main, footer { ... }` and add `footer { border-top: 1px solid #767676; }`.
  - `LANDING_PATH` in `dashboard.ts` stays (out of scope; noted as a cleanup candidate).
- `src/http/legal.ts` (new): imports `DATA_SOURCES`, `PRIVACY_LINK`, `TERMS_LINK` and `page` from `./views`. Exports `LEGAL_LAST_UPDATED = "2026-10-28"`, `OPERATOR_NAME = "Ahmed M. Essawy"`, `CONTACT_EMAIL = "ahm.elessawy@gmail.com"`, `GOVERNING_LAW_TEXT` (spec FR-L04 item 10 default), `privacyView(): string`, `termsView(): string`. Each view is a `LegalSection[]` constant of data objects (`id`, `title`, `paragraphs`) with explicit ids. Private helpers: `section(LegalSection)` renders `<section aria-labelledby>` with an `<h2 id>` and one `<p>` per paragraph, `legalPage(title, sections)` renders `page(title, h1 + last updated line + sections)`, `contactSection()` builds the shared Contact section, and `CONTACT_LINK` is the mailto anchor. `views.ts` exports `TERMS_LINK`, `PRIVACY_LINK` and `DATA_SOURCES`, and `siteFooter()` and `agreementNotice()` use the same links. Paragraph text is trusted constant HTML, so there is no `escapeHtml` import.
- `src/http/routes.ts`: two `ROUTES` entries after `/styles.css`: `{ method: "GET", pattern: /^\/privacy$/, handler: () => htmlResponse(privacyView(), STATUS_OK) }` and the same for `/terms` with `termsView`.
- `specs/001-egx-mcp-server/contracts/http-endpoints.md`: amended by the planner (rows for `/privacy`, `/terms`, footer and agreement rule).
- `README.md`: see T007.

## Constitution Check (2.1.0)

| Principle | Result |
|---|---|
| I Honest delayed data | Terms state delayed, unofficial, informational only; no real-time claim. PASS |
| II Cache-only reads | No upstream or storage read. PASS |
| III Data integrity | Not touched. PASS |
| IV Zero cost | Two cheap routes, no storage. PASS |
| V Secure access | Same CSP and headers, no cookies, no forms, no secrets; text states hashing truthfully. PASS |
| VI Informational scope | Terms state no buy, sell or hold advice. PASS |
| Workflow | Traces to spec 002; tests first; README rule (names every source, delayed, unofficial, informational) kept by `check:readme`. PASS |

No complexity tracking entries.

## Analysis (spec, plan, tasks vs constitution and contracts)

- A1 (resolved): the request named `src/index.ts` for routes; the real route table is `src/http/routes.ts`. Plan uses `routes.ts`.
- A2 (resolved): there is no separate sign-in page; `/dashboard/login` redirects straight to Google. The sign-in entry is the home page link, and the sign-in result pages use `messageView` -> `page()`, so the footer covers them. `consentView` exists but is not routed yet (`/authorize` answers 501); it still gets the notice so it is ready for MCP sign-in.
- A3 (resolved): contract says every HTML response is `no-store`; the legal pages follow it rather than adding a cached variant.
- A4 (resolved): data-model `users` stores `google_sub`, `email`, `display_name` (confirmed in `src/store/d1/users.ts` and migration 0001); the policy states exactly these.
- A5 (resolved): portfolio, price levels, MCP sign-in and T110 are not built; text is conditional so it stays true after they ship.
- A6 (resolved): `check:readme` checks presence of ten headings (not order), tool examples and source texts; a new "Privacy and terms" heading needs no script change.
- No Critical, High or Medium issue open.

## Planner questions (defaults used until the owner answers)

- Q1 Governing law: (a) Egypt, (b) none named, (c) other. Recommended: (a) Egypt, but it is the owner's call; until answered, ship (b) with the neutral sentence in `GOVERNING_LAW_TEXT`.
- Q2 Deletion response time: (a) 30 days, (b) 14 days. Recommended: (a) 30 days.
- Q3 Minimum age: (a) 18, (b) 13 (Google minimum), (c) 16. Recommended: (a) 18, because it is a financial data service.
- Q4 Usage and log retention wording: (a) 90 days for daily usage as the intended retention (no purge job yet), Cloudflare logs under its policy, (b) also promise a fixed log retention. Recommended: (a).
