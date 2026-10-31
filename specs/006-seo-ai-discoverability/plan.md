# Implementation Plan: Search and AI discoverability

**Branch**: `feat/seo-ai-discoverability` (spec folder `006-seo-ai-discoverability`, delivered squash-local into `main`) | **Date**: 2026-10-31 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/006-seo-ai-discoverability/spec.md` (Clarifications 2026-10-31). Supporting files: [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [content-en.md](content-en.md) (exact English copy), [arabic-copy.md](arabic-copy.md) (Arabic draft for owner review), [quickstart.md](quickstart.md), [tasks.md](tasks.md), [qa-cases.md](qa-cases.md).

## Summary

A new `src/site/` layer holds one source of truth (site identity, page set, tool guide, Q&A, dates) and pure renderers that turn it into HTML pages, Markdown twins, `robots.txt`, `sitemap.xml`, `llms.txt`, `llms-full.txt`, JSON-LD and the MCP discovery files. `src/http/public.ts` serves them with cache headers, ETag and `304`, `HEAD`, `Accept` negotiation and canonical redirects; `src/index.ts` answers `/mcp/server-card` before the OAuth provider. Tool descriptions move to one `TOOL_DESCRIPTIONS` constant read by both `defineTool` and the catalog. Private pages gain `noindex`. Nothing reads D1, KV or an upstream. A preview image is built once from the logo. Arabic pages ship as a separate group after the owner approves `arabic-copy.md`. The listing kit lives in `docs/listing/`.

**Delivered (2026-10-31)**: Phases 1 to 6 and Phase 8 are implemented in the working tree on `feat/seo-ai-discoverability` (uncommitted): single source modules and tool descriptions, English pages, Markdown twins and text files, structured data, discovery files and the MCP server card, public routes with cache headers, ETag, `HEAD`, negotiation and canonical redirects, `noindex` on private pages, the listing kit in `docs/listing/`, and the amendments to specs 001 (http-endpoints contract), 002, 003 and 005. Phase 7 (Arabic, T036 to T039) is pending: it waits for the owner to approve `arabic-copy.md`, and the Arabic rows in the amended contract are marked pending. Final verification: `npm run typecheck` clean, `npm test` 88 files and 2341 tests passing, `npm run check:readme` passing.

## Preconditions

- **Spec 007 first.** The user's folder has spec 007 (`feat/cleanup-icons-tests`) in progress: uncommitted changes in `src/http/icons.ts`, `src/http/views.ts` and 30+ test files (test API moved to `cloudflare:workers`, icon table `PAGE_ICONS`, image headers). This feature edits the same files. Implementation of 006 starts only after 007 is delivered to `main`; then `git fetch`, `git pull --ff-only` on `main`, create `feat/seo-ai-discoverability`, and re-read `src/http/icons.ts`, `src/http/views.ts`, `src/http/routes.ts`, `tests/helpers/*.ts` and `tests/unit/routes.test.ts` before the first task (global rule 8). New tests import `env` and `exports` from `cloudflare:workers` as 007 does, never from `cloudflare:test`.
- **Baseline** (planner, 2026-10-31, at BASE `6683d29` plus the uncommitted 007 work): `npm run typecheck` PASS; `npm test` 70 files, 1468 tests, 1 failure: `tests/unit/icons.test.ts` "PAGE_ICONS lists the head icons in page order" (007 mid-edit, `PAGE_ICONS` undefined in that run). NOT RUN: none. The implementer re-runs the baseline at the new BASE after 007 lands; the 007 failure is expected to be gone, and any failure at that BASE is recorded before Phase 1.

## Technical Context

**Language/Version**: TypeScript 7.0.2, Node 24 for local scripts.

**Primary Dependencies**: Cloudflare Workers (wrangler 4.156.0, compatibility date 2026-10-01), `@cloudflare/workers-oauth-provider` 1.2.4, `@modelcontextprotocol/server` 2.3.1, `agents` 0.30.1, zod 4.6.7. No new dependency. Audit tools run through `npx` only (Lighthouse 13.x, `structured-data-testing-tool`), never added to `package.json`.

**Storage**: none added. No D1 table, KV key, migration or binding. The preview image is a base64 constant in `src/http/icons.ts` (as spec 005).

**Data access**: none on any public route. No query, so no tracking, projection, N+1, pagination or index risk. The only `env` read is `loadConfig(env)` (parsed vars) and `resolvePublicOrigin`.

**Testing**: vitest 4.1.12 with `@cloudflare/vitest-plugin` 1.4.11 (Workers pool by default; the drift test runs in the Node pool through `listNodeTools` and is added to `NODE_TEST_FILES` in `vitest.config.ts`). Verify: `npm run typecheck; npm test` (profile `verify`).

**Target Platform**: Cloudflare Workers Free plan at `https://egx-mcp.essawy.workers.dev` (Workers Builds deploys `main` on push).

**Project Type**: single web service (one Worker).

**Performance Goals**: Lighthouse mobile: SEO 100, accessibility 95 or more, best practices 95 or more, performance 95 or more on every public page (SC-002); every page's HTML plus `/styles.css` plus the header logo under 100 KB (SC-006); CPU per public request well under 1 ms of the 10 ms limit (string building plus one SHA-256 of under 100 KB).

**Constraints**: 0 USD (constitution IV); zero D1, KV and upstream access and zero quota use for public routes (FR-S27); CSP `default-src 'self'; frame-ancestors 'none'` unchanged (JSON-LD data blocks are not scripts, research R6); no external font, script or tracker; no comments in code; no em or en dashes in any text.

**Scale/Scope**: 10 English pages, 4 Arabic pages, 14 Markdown twins, 7 text and discovery files, 1 image; about 12 new source modules and 12 new test files.

## Constitution Check (before design)

| Principle | Gate | Result |
|---|---|---|
| I. Honest Delayed Data | No page or file presents data as real-time; delayed label wherever data is mentioned | PASS: content-en.md section 9 content test bans real-time and advice words with an allowlist for negations; the notice is part of the layout of every content page and of every summary and discovery file |
| II. Cache-Only Reads | No request triggers an upstream call | PASS: public routes read no store and no upstream; a test traps `fetch`, D1, KV and the rate limiter |
| III. Data Integrity | Not touched | PASS (no data written or changed) |
| IV. Zero-Cost Operation | Free tier only, refusal over billing, plan shows the budget | PASS: budget below; no paid tool, directory placement or analytics |
| V. Secure Multi-User Access | Auth unchanged, no secret in code or responses | PASS: OAuth and keys untouched; the IndexNow key is public by design (research R8); private pages gain `noindex` and keep `no-store` |
| VI. Informational Scope Only | No buy, sell or hold recommendation | PASS: content test; FAQ and data page state it plainly |
| Data usage rights | No redistribution of EGX data on public pages | PASS: no live price, no per-symbol page; pages describe what can be asked (spec Assumptions); README keeps naming every source |
| Workflow | Spec Kit, code-quality, fresh reviewer, free-tier budget in plan | PASS |

## Free-tier budget

Current daily requests (spec 001 research R1, at the full caps): 31,485 of 100,000. Public traffic today is not measured (no analytics by design); the estimate below assumes, after this feature, about 50 public URLs (14 HTML pages, 14 twins, 7 text and discovery files, the image, CSS and 6 icons), 28 named crawlers plus unnamed bots fetching each URL at most once a day, and 200 human visits a day of 5 requests each (page, CSS, logo, favicon, preview).

| Resource (Free limit) | Today at caps | Added by this feature (estimate) | At 10 times that | Total at 10 times | Share |
|---|---|---|---|---|---|
| Worker requests (100,000 per day) | 31,485 | crawlers 1,400 + humans 1,000 = 2,400 | 24,000 | 55,485 | 55% |
| CPU (10 ms per request) | unchanged | under 1 ms per public request | same per request | n/a | n/a |
| D1 rows read / written | unchanged | 0 | 0 | unchanged | unchanged |
| KV reads / writes | unchanged | 0 | 0 | unchanged | unchanged |
| Rate limiter calls | unchanged | 0 (oauth guard cost 0 for every public path) | 0 | unchanged | unchanged |
| User and global call quotas | unchanged | 0 (no MCP call) | 0 | unchanged | unchanged |
| Worker bundle (64 MiB uncompressed) | about 0.6 MB | about 200 KB of source text plus the 60 KB image | n/a | under 1 MB | 1.5% |

Browser `max-age=3600` removes most repeat human requests; a `304` still counts as a request but costs no body. Past 100,000 requests a day Cloudflare refuses with error 1027 (never billed). Trigger to move public pages to static assets (free, outside the request quota): public requests above 20,000 a day or any day above 70,000 total (research R7). No new cron and no new subrequest, so the scheduled-job budget is unchanged.

Proof that the wrapper adds no KV write or quota use: `src/index.ts` calls `guardOauthEntry`, which returns `null` before touching `RATE_LIMITER` or D1 when `oauthWriteCost(request)` is 0, and the cost is 0 for every method and path except `POST /register`, `POST /token`, `GET /authorize`, `POST /authorize` and `GET /callback/google` (`src/limits/oauth-guard.ts`). The provider passes every path outside `/mcp`, `/mcp/...`, `/token`, `/register` and `/.well-known/oauth-*` to `defaultHandler`, only setting `env.OAUTH_PROVIDER` helpers (no KV call). `tests/integration/public-no-io.test.ts` calls the real `src/index.ts` default export with `DB`, `DATA`, `OAUTH_KV` and `RATE_LIMITER` replaced by recording proxies and `fetch` stubbed to throw, requests every public route (GET, HEAD, conditional GET, Markdown negotiation, a redirect variant and `/mcp/server-card`), and asserts the expected statuses, no `set-cookie` and zero recorded accesses.

## Design

### 1. One source of truth (`src/site/`)

Modules, types and imports: data-model.md. Copy: content-en.md and arabic-copy.md. Key rules:

- `SITE` (identity) is the only place for name, descriptions, keywords, publisher, repository and issues URLs, registry name, preview image facts and the IndexNow key. `views.ts` drops `PRODUCT_NAME` and `GITHUB_URL` and imports `SITE`.
- `PAGES` is the only page list. Sitemap, `llms.txt`, `llms-full.txt`, footer, home "Learn more", related sections, routes, the canonical redirect set and the freshness pins all iterate it.
- `TOOL_DESCRIPTIONS` (`src/mcp/tool-descriptions.ts`) is the only description text; `ToolDefinition.description` is removed and `defineTool` registers `` `${TOOL_DESCRIPTIONS[tool.name]} ${NOTICE}` `` (identical registered strings). `TOOL_GUIDE` is typed `Record<ToolName, ToolGuide>` so a new tool without catalog text fails the typecheck.
- Dates: `updated` per page plus the freshness pin test (research R12). Summary and discovery files use the newest page date.
- Address independence: every absolute URL is built from `ctx.origin` (`resolvePublicOrigin`); nothing in `src/site/` holds `workers.dev` (test: grep of the `?raw` sources). `docs/listing/server.json` is the one static file with the production address, test-tied to `wrangler.jsonc` `PUBLIC_ORIGIN`.

### 2. Rendering

- `render-html.ts`: `renderPageHtml(page, ctx)` builds the document of contracts/html-page.md. It reuses `escapeHtml`, `iconLinks`, `siteHeader`, `siteFooter` (now taking `lang` and the language link), `heroSection`, `connectSection` and `NOTICE` exported from `views.ts`. Private pages keep `page(title, body)`, which now emits `<meta name="robots" content="noindex, nofollow">`; the shared low-level `htmlDocument(head, body, lang, dir)` in `views.ts` is used by both so the skeleton is written once.
- `landingView` is removed; `GET /` renders `renderPageHtml(homePage, ctx)`, whose hero, connect block and notice are the same functions, so that markup is byte-identical to today. The current tests of `landingView` move to the home page tests with the same assertions.
- `legal.ts` keeps the legal data and exports `PRIVACY_SECTIONS`, `TERMS_SECTIONS` and `legalBody(title, sections)` (today's body markup); `privacyView`, `termsView` and `legalPage` are removed and the legal pages are served through `renderPageHtml` like every other page (this also avoids a `legal.ts` and `pages.ts` import cycle). Text and order unchanged.
- `render-markdown.ts`: twins, `llms.txt`, `llms-full.txt` (contracts/text-files.md).
- `structured-data.ts`: graphs of contracts/html-page.md; `jsonLdScript` escapes `<`, `>` and `&`.
- `crawl.ts`: `CRAWLERS` (research R1 order), `ROBOTS_RULES`, `robotsTxt`, `sitemapXml`.
- `discovery.ts`: `serverCard`, `aiCatalog` (contracts/discovery.md). `SERVER_VERSION` becomes an export of `src/mcp/server.ts`.

### 3. Serving (`src/http/public.ts`, `routes.ts`, `index.ts`)

- `siteContext(request, env): SiteContext | null` from `resolvePublicOrigin` and `loadConfig`.
- `publicResponse(request, body, headers)`: computes the ETag (`crypto.subtle.digest("SHA-256", bytes)`, first 32 hex), answers `304` on a matching `If-None-Match`, drops the body for `HEAD`.
- `PUBLIC_ROUTES: Route[]` built from `PAGES` (HTML and twin per page) plus the fixed text and discovery files; each entry registered for `GET` and `HEAD`. `Route` keeps its shape; `HEAD` entries are separate `Route` objects created by one helper `getAndHead(pattern, handler)` so private `GET` routes never answer `HEAD`.
- `prefersMarkdown(accept)` per contracts/routes.md.
- `canonicalRedirect(request, ctx)`: lower-case and trailing-slash variants of public paths, `301`.
- `routes.ts`: `ROUTES` spreads `PUBLIC_ROUTES` first (they replace today's `/`, `/privacy` and `/terms` entries); after the loop, `canonicalRedirect` then the `404` page. `HTML_HEADERS` stays for private pages and gains `x-robots-tag: noindex, nofollow`; a new `PUBLIC_HTML_HEADERS` in `public.ts` is `HTML_HEADERS` without `cache-control` and `x-robots-tag`, plus `cache-control: public, max-age=3600`.
- `src/index.ts`: before `guardedResponse`, `const card = await serverCardResponse(request, env); if (card !== null) return card;` where `serverCardResponse` returns `null` unless the method is `GET` or `HEAD` and the pathname is `/mcp/server-card`. `OPTIONS` on `/mcp/server-card` and `/.well-known/ai-catalog.json` is answered `204` by the site itself with the discovery CORS header set, not left to the provider; other methods on these paths get `404`.
- Preview image: `PREVIEW_IMAGE_PATH` added to the unlisted image table of `src/http/icons.ts` with its base64 constant; it is served by the existing icon routes with the image headers spec 007 defines.

### 4. Preview image

Built once by the implementer with Python 3.14 and Pillow 13 (installed) from `D:/Work/EGX MCP/.git/pipeline/q09-new-logo/assets/egx-mcp-logo-1024.png`; the script and output live in `D:/Work/EGX MCP/.git/pipeline/seo-ai-discoverability/og/` (never committed). Exact design: canvas 1200 by 630, background navy `#032853`; the logo resized to 360 by 360 with Lanczos and pasted at (100, 135); text in gold `#D6A814`, font `C:/Windows/Fonts/segoeuib.ttf`: "EGX MCP" at size 96 with its top-left at (520, 190); then in white `#FFFFFF`, `C:/Windows/Fonts/segoeui.ttf` size 40: "Egyptian Exchange data" at (520, 320) and "for AI assistants" at (520, 372); then in `#9AA8B5`, size 28: "Delayed data. Not investment advice." at (520, 450). Save as PNG with `quantize(colors=64, method=Image.Quantize.MEDIANCUT)` and `optimize=True`. Acceptance: 1200 by 630, at most 60 KB; the test pins its SHA-256 and size. Base64 line generated with the `node -e` pattern of spec 005.

### 5. Arabic pages (separate group, after owner approval)

`arabic-copy.md` is the reviewable source. The Arabic group (tasks.md Phase 7) starts only when its status line reads APPROVED. It adds `src/site/content/ar.ts`, the four Arabic records to `PAGES` (`dir="rtl"`, `lang="ar"`), `FOOTER_LINKS.ar`, the language links, hreflang alternates (pages and sitemap) and the `Arabic` sections of the summary files. `tests/unit/site-arabic.test.ts` fails when the status is not APPROVED or when any Arabic string in `ar.ts` is not found verbatim in `arabic-copy.md`. The English groups ship without it; if approval is pending when the English groups pass review, the run is delivered without Phase 7 and Phase 7 runs later as its own run on this spec.

### 6. Listing kit and README

- `docs/listing/` (outside `src/`, committed): `server.json` (contracts/discovery.md), `descriptions.md` (name, the 96-character registry description, the 146-character short description, the long description, the one-sentence description, the keyword set, the logo files by URL and size), `registries.md` (checklist table of research R5 with status `not submitted` for every row, the submission method, and owner steps), and nothing else. Logos are referenced by their public URLs; no image file is added to the repo.
- `README.md`: the first paragraph becomes `SITE.oneLine` followed by links to the site pages (home, tools, guides, FAQ, data); the "Privacy and terms" section keeps its text. `scripts/check-readme.ts` gains a check that the README's first paragraph starts with `SITE.oneLine` (imported from `src/site/identity.ts`).
- The GitHub repository description and topics are an owner action (listed below), with the text in `docs/listing/descriptions.md`.

### 7. Performance and accessibility

No new asset beyond the preview image. CSS additions are listed in contracts/html-page.md. Pages are server-rendered HTML with no script, so LCP is the first paint of text; `img` tags keep `width` and `height` (no layout shift). Lighthouse and render checks run in Phase 5, T033, and for Arabic in Phase 7, T039 (quickstart.md).

## Spec changes made by the planner (spec.md)

1. **FR-S22a** (contradiction with the Assumption "Privacy policy and terms keep their content" and with FR-S30): the privacy policy and terms name the operator and his email as the legal contact (spec 002, owner approved). Changed to: no personal name or email in any page, file or listing this feature adds, nor in structured data; the privacy policy and terms keep their operator identity and contact, and their full text is not copied into `llms-full.txt` (linked instead). Open owner question 1 below confirms this default.
2. **FR-S20**: "the full content of every public page" now reads "the full content of every content page, with the legal pages linked" (follows from change 1).
3. **SC-003**: Google retired FAQPage and HowTo rich results and requires a rating for SoftwareApplication rich results (research R6). Changed to: zero errors and zero warnings at validator.schema.org; Google's Rich Results Test shows no error for the breadcrumb and organization items; FAQPage, HowTo and SoftwareApplication are expected as "not eligible" there, not as errors in the schema validator.
4. **SC-005**: "and the home page" now reads "and the tool count on the home page", because FR-S13 keeps the tool list off the home page.

## Amendments to earlier specs (edited in Phase 8, T040)

- **Spec 002 (legal pages), FR-L01**: `/privacy` and `/terms` now answer with the public header set (`cache-control: public, max-age=3600`, `etag`, `vary: Accept`, Markdown `link`) instead of `HTML_HEADERS` with `no-store`; they gain a meta description, canonical link, social tags, breadcrumb and JSON-LD, the titles become "Privacy policy: EGX MCP" and "Terms of use: EGX MCP", and they appear in the sitemap. Body text, sections and dates unchanged.
- **Spec 003 (home page)**: FR-H03 connect note reworded with owner approval (2026-10-31) to "Claude and ChatGPT connect with Google sign-in, Claude Code with either, and Cursor with an API key header. Create your key after signing in."; FR-H01 `no-store` becomes the public header set; FR-H05 (Amendment 1, "Removed") now allows exactly 5 example questions and a "Learn more" links section (owner decision, spec 006 Clarifications); the tool list stays off the home page; FR-H06 footer now links every main page (spec 006 FR-S09) and GitHub; FR-H09 "no `<script>`" now allows exactly one `<script type="application/ld+json">` data block and still forbids executable script; FR-H08 applies to every section. The `<title>` becomes the home title of content-en.md.
- **Spec 005 (logo)**: the image table gains `/og-image.png` (1200 by 630, unlisted, not in head links or MCP icons); the header brand links to the home of the page language.
- **Spec 001 contract** `specs/001-egx-mcp-server/contracts/http-endpoints.md`: new rows for every route in contracts/routes.md; `GET /`, `/privacy`, `/terms` rows updated (headers, content); the "All HTML responses carry ... `Cache-Control: no-store`" paragraph narrowed to private pages, which also carry `X-Robots-Tag: noindex, nofollow`; the footer sentence lists the new links; a note that `GET /mcp/server-card` is answered before the provider.

## Owner-only tasks (never done by the pipeline)

1. Review and approve `arabic-copy.md` (status line), before Phase 7.
2. Answer open question 1 (legal pages identity) if the default is not wanted.
3. Google Search Console: add the property for `https://egx-mcp.essawy.workers.dev/` (URL-prefix property; a domain property is impossible on workers.dev), verify with the HTML tag or file method the owner chooses (a verification file route is a one-line follow-up), submit `/sitemap.xml`, request indexing of the home page.
4. Bing Webmaster Tools: import from Search Console or verify, submit the sitemap; this also feeds Copilot and DuckDuckGo.
5. After each deploy that changes pages: run the IndexNow command in quickstart.md (Bing, Yandex, Seznam, Naver, Yep).
6. Custom domain: the largest remaining ranking and trust factor (research R7, spec Assumptions). Buying one is a cost and the owner's decision; when added, set `PUBLIC_ORIGIN`, update `docs/listing/server.json`, add the new Search Console property, and keep the workers.dev address redirecting or declaring the canonical.
7. Registry and directory submissions from `docs/listing/registries.md`, one at a time, after go-ahead: official MCP Registry (`mcp-publisher login github`, `mcp-publisher publish docs/listing/server.json`), Smithery, PulseMCP, mcp.so (free option only), Glama claim, awesome-remote-mcp-servers pull request; update the status column each time.
8. GitHub repository: set the description to `SITE.shortDescription` and the website to the site URL; add topics from the keyword set.
9. Post-release tracking (SC-009 to SC-012): run the 20 benchmark questions (qa-cases.md QA-040) before release and every 30 days; record results in `docs/listing/benchmark.md` (created by the owner run of QA-040, not by this feature's code tasks).

## Open questions for the owner (non-blocking)

1. **Legal pages identity.** FR-S22a says no personal name or email anywhere, but the privacy policy and terms name the operator and his email (legally the data controller contact). Options: A) keep them on the legal pages only and keep legal text out of `llms-full.txt` and structured data (recommended; plan default); B) replace the operator name and email on the legal pages with "the EGX MCP project" and the GitHub issues page (changes spec 002 content and weakens the legal contact for account deletion by email). The plan proceeds with A; B would add one small task in Phase 8.

## Project Structure

### Documentation (this feature)

```text
specs/006-seo-ai-discoverability/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── content-en.md
├── arabic-copy.md
├── quickstart.md
├── contracts/
│   ├── routes.md
│   ├── text-files.md
│   ├── html-page.md
│   └── discovery.md
├── tasks.md
├── qa-cases.md
└── checklists/requirements.md
```

### Source Code (repository root)

```text
src/
├── index.ts                         (server card before the guard)
├── mcp/
│   ├── tool-descriptions.ts         (new)
│   ├── define-tool.ts               (reads TOOL_DESCRIPTIONS)
│   ├── server.ts                    (exports SERVER_VERSION)
│   └── tools/*.ts                   (description fields removed)
├── store/d1/events.ts               (MAX_SINCE_AGE_DAYS moved here)
├── site/                            (new)
│   ├── identity.ts
│   ├── paths.ts
│   ├── content-model.ts
│   ├── tool-catalog.ts
│   ├── pages.ts
│   ├── render-html.ts
│   ├── render-markdown.ts
│   ├── structured-data.ts
│   ├── crawl.ts
│   ├── discovery.ts
│   └── content/
│       ├── en.ts
│       └── ar.ts                    (Arabic group)
└── http/
    ├── public.ts                    (new)
    ├── routes.ts, views.ts, legal.ts, icons.ts, status.ts (changed)
tests/
├── unit/ (new) site-identity, site-isolation, site-catalog, site-pages, site-html, site-markdown,
│        site-content, site-drift, site-freshness, site-arabic, tool-descriptions, crawl, discovery,
│        structured-data, public-routes, listing (.test.ts each); routes, views tests updated
├── integration/ (new) public-no-io.test.ts, server-card.test.ts
vitest.config.ts                     (tool-descriptions and site-drift added to NODE_TEST_FILES)
docs/listing/                        (new: server.json, descriptions.md, registries.md)
README.md, scripts/check-readme.ts   (changed)
```

**Structure Decision**: site content and renderers go in a new `src/site/` folder because they are neither HTTP plumbing nor MCP tools, and keeping them pure (no `Request`, no `Env`) makes every output testable as a function of `SiteContext`. HTTP concerns stay in `src/http/`. The listing kit is documentation, so it goes under `docs/`, outside `src/` and outside the Worker bundle.

## Constitution Check (after design)

All gates of the first check still PASS. Added evidence:
- I and VI: the content test runs over every HTML page, twin, summary and discovery file and the listing descriptions (SC-008).
- II and IV: `public-no-io.test.ts` proves zero D1, KV, rate limiter and upstream access through the real entry point (SC-006); budget at 10 times stays at 55% of requests.
- V: `/mcp/server-card` is answered before the guard but carries no secret and needs no auth; OAuth and keys are unchanged; the `Authorization` header in the card is marked `isSecret: true` with no value.
- Data rights: no live price or per-symbol page; the content test bans "live price".

## Complexity Tracking

None. No principle is violated.

## Deviations noted

- `src/http/views.ts` keeps HTML built from template strings (no templating library), as the project does; new renderers follow the same style. Cost to change: not proposed.
- Images stay base64 constants in `src/http/icons.ts` (spec 005 decision) instead of Workers static assets; the preview image follows. Cost to move: an `assets` block, a `_headers` file, untestable routes in `defaultHandler` tests (research R7 trigger).
- The tests keep pinned hashes in test files (as `ARTWORK_SHA256` in `routes.test.ts`), so the freshness pins follow that pattern instead of a fixture file.
