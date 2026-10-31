# Tasks: Search and AI discoverability

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [content-en.md](content-en.md), [arabic-copy.md](arabic-copy.md), [quickstart.md](quickstart.md), [qa-cases.md](qa-cases.md).

**Repo**: `D:/Work/EGX MCP` (the user's folder) for every task; one repo, so no `[P]`. Branch `feat/seo-ai-discoverability` from `main` after spec 007 is delivered (plan.md, Preconditions). Commit split: single squash commit (profile `deliver: squash-local`, `commit-split: single`).

**Dispatch**: each Phase below is one implementer dispatch (Sonnet, superpowers subagent-driven-development), in order. Inside a phase, every test task is written and seen failing before its code task.

**Rules for every implementer and reviewer prompt (repeat them)**:
- Verify with `npm run typecheck` and `npm test` (profile `verify`). Only failures beyond the baseline recorded in T001 count.
- Never run `wrangler deploy`, `wrangler dev --remote`, any Cloudflare API call, any write to the live Worker, an IndexNow POST, a registry or directory submission, or a Search Console action.
- Never touch `.claude/`, `CLAUDE.md`, the user's own uncommitted files, or any spec folder other than `specs/006-seo-ai-discoverability/`, except the amendment files named in Phase 8.
- No comments in code, no em dashes, en dashes or double hyphens in any text, no AI attribution. Stage by explicit path; never stage an image file or anything under `.git/pipeline/`.
- New tests import `env` and `exports` from `cloudflare:workers` (spec 007 style), never from `cloudflare:test`.
- Copy text verbatim from content-en.md and arabic-copy.md; do not reword.
- Re-read `src/http/views.ts`, `src/http/icons.ts`, `src/http/routes.ts` and the test helpers at the start of each phase (other work may have landed).

## Phase 1: Foundation (single source modules and tool descriptions)

- [x] T001 Setup: `git fetch`; confirm spec 007 is in `origin/main` (`git log origin/main --oneline -5` shows its squash commit); `git switch main`, `git pull --ff-only`, `git switch -c feat/seo-ai-discoverability`. Run `npm run typecheck` and `npm test`; record PASS or the failing test ids in `D:/Work/EGX MCP/.git/pipeline/seo-ai-discoverability/baseline.md` (not committed). Re-read `src/http/views.ts`, `src/http/icons.ts`, `src/http/routes.ts`, `tests/helpers/html.ts`, `tests/unit/routes.test.ts`, `tests/unit/views.test.ts`. Acceptance: branch created; baseline file written; if 007 is not in `origin/main`, stop and report BLOCKED.
- [x] T002 [US3] Tests in new `tests/unit/tool-descriptions.test.ts` (Node pool: add it to `NODE_TEST_FILES` in `vitest.config.ts`):
  - "has one description per tool name": `Object.keys(TOOL_DESCRIPTIONS).sort()` equals `[...TOOL_NAMES].sort()`.
  - "registers every tool with its shared description and the notice": for each tool from `listNodeTools(createNodeStores().env)`, `tool.description` equals `` `${TOOL_DESCRIPTIONS[tool.name as ToolName]} ${NOTICE}` `` (`NOTICE` from `src/mcp/envelope.ts`).
  - "keeps the registered descriptions unchanged": a `REGISTERED_BEFORE: Record<string, string>` constant holding today's 30 registered description strings, captured by running `listNodeTools` once at BASE before the code change (paste the output), equals the registered descriptions after.
  Acceptance: the first two fail (module missing); the third passes at BASE.
- [x] T003 [US3] Implement: new `src/mcp/tool-descriptions.ts` exporting `TOOL_DESCRIPTIONS` (`Readonly<Record<ToolName, string>>`, each value the exact string now in the tool files, template literals kept); export `MAX_SINCE_AGE_DAYS = 30` from `src/store/d1/events.ts` and import it in `src/mcp/tools/personal.ts` (remove the local constant); remove `description` from `ToolDefinition` in `src/mcp/define-tool.ts` and register `` `${TOOL_DESCRIPTIONS[tool.name]} ${NOTICE}` ``; delete the `description:` property from every `defineTool` call in `src/mcp/tools/*.ts`; export `SERVER_VERSION` from `src/mcp/server.ts`. Acceptance: T002 passes; typecheck clean; `npm test` no new failure.
- [x] T004 [US1, US2, US3] Tests in new `tests/unit/site-identity.test.ts` (Workers pool):
  - `SITE` values equal content-en.md section 1 (spot check `name`, `oneLine`, `registryDescription`, `issuesUrl`, `registryName`, `indexNowKey`, `PREVIEW_IMAGE_PATH`, 1200, 630).
  - limits: `registryDescription.length <= 100`, `shortDescription.length <= 160`, `oneLine.length <= 160`; `registryName` matches `^[a-zA-Z0-9.-]+/[a-zA-Z0-9._-]+$`; `indexNowKey` matches `^[a-f0-9]{32}$`.
  - "names no person": for every string field except `repositoryUrl`, `issuesUrl`, `registryName`, no `Essawy`, no `gmail`, no `@`.
  - `markdownPath("/")` is `/index.md`, `markdownPath("/tools")` is `/tools.md`, `markdownPath("/ar")` is `/ar.md`.
  - `FOOTER_LINKS.en` labels and hrefs equal content-en.md section 1 in order, last item GitHub with `SITE.repositoryUrl`.
  - `RATE_LIMIT_PER_MINUTE` equals `ratelimits[0].simple.limit` of `wrangler.jsonc` (import `../../wrangler.jsonc?raw`, `JSON.parse`).
  - `LOCALIZED.en` equals `{ affiliation: "Independent service, not affiliated with the Egyptian Exchange.", skipLink: "Skip to main content", notice: <today's views NOTICE>, homeLabel: "Home", relatedHeading: "Related pages", lastUpdated: "Last updated" }`.
  Acceptance: fails (modules missing).
- [x] T005 [US1, US2, US3] Implement `src/site/identity.ts` (`Lang = "en"` for now, `SITE`, `RATE_LIMIT_PER_MINUTE = 10`, `LOCALIZED: Readonly<Record<Lang, LocalizedText>>`, `INDEXNOW_KEY_PATH` = `` `/${SITE.indexNowKey}.txt` ``) and `src/site/paths.ts` (data-model.md, Paths; English footer only), `src/site/content-model.ts` (data-model.md types; `Lang` imported from identity). In `src/http/views.ts`: import `HOME_PATH`, `PRIVACY_PATH`, `TERMS_PATH` from `../site/paths` (remove the local constants and update importers), replace `PRODUCT_NAME` with `SITE.name`, `GITHUB_URL` with `SITE.repositoryUrl`, and the local `AFFILIATION` and `NOTICE` constants with `LOCALIZED.en.affiliation` and `LOCALIZED.en.notice` (same strings, so every page is byte-identical). Acceptance: T004 passes; every existing views and routes test passes unchanged (same HTML).
- [x] T006 [US3] Tests in new `tests/unit/site-isolation.test.ts`: read every file under `src/site/` with `import.meta.glob("../../src/site/**/*.ts", { query: "?raw", import: "default", eager: true })`; fail on an import from `store/kv`, `limits/`, `providers/`, `jobs/`, `auth/`, or a named import from `store/d1/` other than `MAX_ITEMS_PER_USER`, `MAX_ACTIVE_KEYS`, `MAX_SINCE_AGE_DAYS`; fail on the text `workers.dev`. Acceptance: passes now and stays in the suite (guard test; seen failing by temporarily adding a forbidden import locally, then removed).

## Phase 2: English pages (US1, US3, US7)

- [x] T007 [US3] Tests in new `tests/unit/site-catalog.test.ts` (Workers pool): `toolEntries()` names equal `TOOL_NAMES` as a set, no duplicates, in `TOOL_GROUPS` order then content-en.md section 4 order; every entry `description === TOOL_DESCRIPTIONS[name]`; examples and returns equal content-en.md section 4 for `search`, `get_metals`, `admin` (spot check); group labels and intros equal content-en.md. Acceptance: fails.
- [x] T008 [US3] Implement `src/site/tool-catalog.ts` (data-model.md, Tool entry) with the text of content-en.md section 4. Acceptance: T007 passes.
- [x] T009 [US1, US3] Tests in new `tests/unit/site-pages.test.ts` (Workers pool), with `TEST_CONTEXT` = `{ origin: "https://egx.example.com", mcpUrl: "https://egx.example.com/mcp", dashboardUrl: "https://egx.example.com/dashboard", limits: { userDailyCalls: 100, globalDailyCalls: 15000 } }`:
  - `PAGES` ids and paths equal content-en.md section 2 in order; ids, paths, titles, headings, descriptions unique; `title(ctx).length <= 60`; `70 <= description.length <= 160`; paths match `^/[a-z0-9/-]*$` with no trailing slash except `/`; every `related` id exists; `kind` per content-en.md (home, content for tools and data, guide for the four connect pages, faq, legal for privacy and terms).
  - The tools title is "Tool catalog: the 30 EGX MCP tools and what they return" (count from `TOOL_NAMES.length`).
  - Home content: exactly 5 example items equal to content-en.md section 3; the `learn-more` links cover every other page id exactly once.
  - FAQ content: at least 15 pairs; the questions equal content-en.md section 6 in order; answers with placeholders filled (`{mcpUrl}` becomes the context URL, `{userDailyCalls}` 100, `{globalDailyCalls}` "15,000", `{perMinute}` 10, `{maxKeys}` 3).
  - Each guide has exactly one `steps` block with 4 items equal to content-en.md section 5; `connect-cursor` has the `json` code block with the context MCP URL.
  - Data content: sources table rows equal content-en.md section 7; limits list uses the context limits and `MAX_ITEMS_PER_USER`, `MAX_ACTIVE_KEYS`.
  - Reachability: from the home page, every page is reachable within two hops over `learn-more`, `related` and `FOOTER_LINKS.en`.
  Acceptance: fails.
- [x] T010 [US1, US3] Implement `src/site/content/en.ts` (builders `homeContent`, `toolsContent`, `guideContent(assistant)`, `faqContent`, `dataContent`, each `(ctx: SiteContext) => PageContent`, text from content-en.md sections 3 to 7) and `src/site/pages.ts` (data-model.md, Public page; `updated` = the UTC date of this task for every new page; legal pages `LEGAL_LAST_UPDATED`; legal `content` from the exported `PRIVACY_SECTIONS` and `TERMS_SECTIONS` through `legalParagraphToText`). Export `PRIVACY_SECTIONS` and `TERMS_SECTIONS` from `src/http/legal.ts` (no text change). Acceptance: T009 passes.
- [x] T011 [US1, US3, US7] Tests in new `tests/unit/site-html.test.ts` (Workers pool) for every page of `PAGES` rendered by `renderPageHtml(page, TEST_CONTEXT)`, without the JSON-LD assertions (Phase 4):
  - `<html lang="en" dir="ltr">`; exactly one `<h1>` equal to the page `heading` (home: "EGX MCP" in the hero); headings never skip a level; the title, `meta description`, canonical `https://egx.example.com{path}`, the Markdown alternate link, and all `og:*` and `twitter:*` tags of contracts/html-page.md with the page values.
  - Home: contains the hero, connect block and notice markup exactly as produced today by `heroSection()`, `connectSection(mcpUrl)` and the notice paragraph (compare against the strings the current `landingView` tests assert, moved here), then the `examples` and `learn-more` sections, in that order.
  - Content, guide and faq pages: the lead first in `<main>` after the h1, the related section, the notice paragraph, the `Last updated` line with `<time datetime>`.
  - Legal pages: the `<main>` inner HTML after the breadcrumb equals today's legal body (h1, Last updated, sections) byte for byte.
  - No `style=`, no `<style`, no `<script` other than nothing in this phase (Phase 4 adds the JSON-LD block and updates this assertion to "exactly one, of type application/ld+json").
  - Footer: `FOOTER_LINKS.en` in order inside `<nav aria-label="Site">`.
  - Escaping: a context origin containing `"` is escaped in attributes (`&quot;`).
  Acceptance: fails.
- [x] T012 [US1, US3, US7] Implement `src/site/render-html.ts` per contracts/html-page.md (without JSON-LD and without the breadcrumb nav, both Phase 4). In `src/http/views.ts`: add `htmlDocument({ lang, dir, head, body })` used by both `page()` and `renderPageHtml`; export `escapeHtml`, `iconLinks`, `siteHeader(lang)`, `siteFooter(lang, languageLink?)`, `heroSection`, `connectSection`, `VALUE_LINE`, `CONNECT_NOTE`, `BEARER_HEADER`; numbers in content use `new Intl.NumberFormat("en-US").format(n)`; `page()` adds `<meta name="robots" content="noindex, nofollow">` after the viewport meta; `HTML_HEADERS` gains `"x-robots-tag": "noindex, nofollow"`; remove `landingView` and `noticeSection` (the layout renders the notice); add the CSS of contracts/html-page.md to `STYLESHEET` (except `.breadcrumb`, Phase 4). `legal.ts` becomes data plus one body renderer, to avoid an import cycle with `pages.ts`: export `PRIVACY_SECTIONS`, `TERMS_SECTIONS` and `legalBody(title, sections)` (today's `legalPage` body: h1, Last updated, sections, unchanged markup), and remove `privacyView`, `termsView` and `legalPage`; `render-html.ts` renders kind `legal` with `legalBody`. Update `tests/unit/legal.test.ts` and `tests/unit/routes.test.ts` to render through `renderPageHtml(pageByPath("/privacy")!, ctx)` with the same assertions. Move the `landingView` tests of `tests/unit/views.test.ts` to `site-html.test.ts` (same assertions); update `tests/helpers/html.ts` `FOOTER_NAV` to the new footer. Acceptance: T011 passes; all other tests pass except those T013 changes.
- [x] T013 [US1, US7] Tests in new `tests/unit/public-routes.test.ts` (Workers pool, calling `defaultHandler.fetch` like `routes.test.ts`):
  - Every `PAGES` path answers `200` `text/html; charset=utf-8` with `cache-control: public, max-age=3600`, the CSP, `nosniff`, `referrer-policy: same-origin`, `vary: Accept`, the Markdown `link` header, no `set-cookie`, no `x-robots-tag`; body equals `renderPageHtml` for the configured origin.
  - `/tools?utm_source=x` answers 200 with canonical `https://egx.configured.test/tools`.
  - Redirects: `/Tools`, `/tools/`, `/TOOLS/`, `/connect/Claude`, `/PRIVACY` answer `301` with `location` `{origin}{canonical}` and no body; `/tool`, `/connect`, `/connect/claude/x` answer 404; `POST /tools` answers 404.
  - Private pages: the 404 page, `GET /dashboard` without a session (redirect unchanged: status and `location` as before), the consent page path used by existing authorize tests, and an OAuth guard refusal page carry `x-robots-tag: noindex, nofollow` and `cache-control: no-store`; the 404 body contains `<meta name="robots" content="noindex, nofollow">`.
  - `/og-image.png` answers 200 `image/png` with the spec 007 image headers; the body is a 1200 by 630 PNG (`pngSize`), at most 61,440 bytes, SHA-256 equal to the pinned value (`OG_IMAGE_SHA256`, filled by T015).
  - The existing `routes.test.ts` assertions that `/`, `/privacy` and `/terms` carry `no-store` change to the public header set (amendment, plan.md); every other existing assertion stays.
  Acceptance: fails.
- [x] T014 [US1, US7] Implement `src/http/public.ts`: `siteContext(request, env)`, `PUBLIC_HTML_HEADERS`, `htmlPageResponse`, `PUBLIC_ROUTES` (HTML routes for `PAGES`, `GET` only in this phase), `canonicalRedirect`; `STATUS_MOVED_PERMANENTLY = 301` in `src/http/status.ts`; `src/http/routes.ts` spreads `PUBLIC_ROUTES` in place of the `/`, `/privacy` and `/terms` entries and calls `canonicalRedirect` before the 404. Acceptance: T013 passes except the image case (T015).
- [x] T015 [US1] Build the preview image per plan.md Design 4: write `D:/Work/EGX MCP/.git/pipeline/seo-ai-discoverability/og/build_og.py`, run it with `python`, check the output is 1200 by 630 and at most 61,440 bytes; add `PREVIEW_IMAGE_PATH` with its base64 constant to the unlisted images of `src/http/icons.ts` (generated with `node -e` reading the file, as spec 005); set `OG_IMAGE_SHA256` in `public-routes.test.ts` to the file's SHA-256. Acceptance: T013 passes fully; `git status --short` shows no image file; `npm test` no new failure.

## Phase 3: Machine-readable files (US2, US1)

- [x] T016 [US2] Tests in new `tests/unit/site-markdown.test.ts`: `renderPageMarkdown` for every page matches contracts/text-files.md (H1 = heading, lead, sections, block forms, related, notice, `Canonical:` and `Last updated:` lines); FAQ pairs as `## question`; guides numbered; legal twins with `[text](href)` links and no notice; home twin first section "Connect your assistant" with fenced `text` blocks of the MCP URL and the header. `llmsTxt(TEST_CONTEXT)` equals the contract layout: H1, blockquote `SITE.oneLine`, paragraph, `Last updated:` = newest `updated`, `## Pages` with every English page of kind home, content, guide, faq in order linking its `.md`, `## Tools` with every `toolEntries()` item, no `## Arabic` section yet, `## Optional` with the five items. `llmsFullTxt` contains every content page twin body once in order and the legal pages only as links; neither file contains `Essawy` or `@gmail`. Acceptance: fails.
- [x] T017 [US2] Implement `src/site/render-markdown.ts`. Acceptance: T016 passes.
- [x] T018 [US1, US2] Tests in new `tests/unit/crawl.test.ts`: `robotsTxt` equals contracts/text-files.md for `TEST_CONTEXT` (every `CRAWLERS` token once, in research R1 order); with an RFC 9309 matcher written in the test (longest path match, `Allow` wins ties), every public HTML path, twin, `/llms.txt`, `/llms-full.txt`, `/sitemap.xml`, `/.well-known/ai-catalog.json`, `/mcp/server-card` is allowed and `/dashboard`, `/dashboard/login`, `/authorize`, `/callback/google`, `/token`, `/register`, `/mcp` are disallowed for `*` and every named token; the last line is `Sitemap: https://egx.example.com/sitemap.xml`. `sitemapXml` lists every `PAGES` path once with `lastmod` = `updated`, no `.md`, no private path, no `xhtml:link` yet, and parses as XML (`DOMParser` is not in workerd: check with a strict regex of the contract shape per `<url>` instead). Acceptance: fails.
- [x] T019 [US1, US2] Implement `src/site/crawl.ts`. Acceptance: T018 passes.
- [x] T020 [US2] Tests in new `tests/unit/discovery.test.ts`: `serverCard(TEST_CONTEXT)` equals contracts/discovery.md (every field; `_meta` tools equal `toolEntries()` name and description; `icons` equal `mcpIcons(origin)`; `version` equals `SERVER_VERSION`); `aiCatalog` holds exactly one entry with `data` deep-equal to the card; the card's `$schema`, `name` (one slash) and `description.length <= 100`. Acceptance: fails.
- [x] T021 [US2] Implement `src/site/discovery.ts`. Acceptance: T020 passes.
- [x] T022 [US1, US2] Tests, extend `tests/unit/public-routes.test.ts`: every twin path (`/index.md`, `/tools.md`, ..., `/privacy.md`, `/terms.md`) answers 200 `text/markdown; charset=utf-8` with `link: <{origin}{path}>; rel="canonical"`, `nosniff`, `public, max-age=3600`, no CSP, no cookie; `GET /data` with `Accept: text/markdown` and with `text/markdown, text/html;q=0.9` answers the twin with `vary: Accept`; with a Chrome `Accept`, `*/*`, `text/plain;q=0.5, text/html` and no `Accept` answers HTML; `/robots.txt`, `/llms.txt`, `/llms-full.txt` `text/plain; charset=utf-8`; `/sitemap.xml` `application/xml; charset=utf-8`; `/.well-known/ai-catalog.json` `application/ai-catalog+json` with the four CORS headers; the IndexNow key path answers the key with no trailing newline. In new `tests/integration/server-card.test.ts` (Workers pool) through the real worker (`import worker from "../../src/index"`, call `worker.fetch`): `GET /mcp/server-card` answers 200 `application/mcp-server-card+json` with the CORS headers and the card body; `POST /mcp` without a bearer still answers 401; `GET /.well-known/oauth-protected-resource/mcp` and `GET /.well-known/oauth-authorization-server` answer 200 (the URLs in the card `_meta`). Acceptance: fails.
- [x] T023 [US1, US2] Implement in `src/http/public.ts`: `prefersMarkdown`, twin routes, text and discovery routes, `serverCardResponse(request, env)`; in `src/index.ts` call `serverCardResponse` before `guardedResponse` (plan.md Design 3), inside a `try` that logs `server_card_failed` and returns `internalErrorResponse()` on error, as `guardedResponse` does. Acceptance: T022 passes; all tests pass.

## Phase 4: Structured data (US4)

- [x] T024 [US4] Tests in new `tests/unit/structured-data.test.ts` and in `site-html.test.ts`: for every page, exactly one `<script` and it is `<script type="application/ld+json">`; its text parses; the graph equals contracts/html-page.md for the page kind (home: Organization, WebSite, SoftwareApplication, WebPage with the listed fields; others: WebPage plus BreadcrumbList with two items equal to the visible breadcrumb nav; faq: FAQPage whose `name` and `text` equal the visible `<h2>` and `<p>` text after stripping tags and decoding entities, and `WebPage.mainEntity`; guides: HowTo whose step texts equal the visible `<li>` texts); `dateModified` equals the visible `<time datetime>`; the visible breadcrumb `<nav aria-label="Breadcrumb">` exists on every page except home with `aria-current="page"` on the last item; a context whose description holds `</script>` is serialized with `\u003c`; no person name or email in any graph. Acceptance: fails.
- [x] T025 [US4] Implement `src/site/structured-data.ts`, the breadcrumb nav and `.breadcrumb` CSS in `render-html.ts` and `STYLESHEET`. Acceptance: T024 passes; all tests pass.

## Phase 5: Performance, cache and safety gates (US7, SC-001 to SC-008)

- [x] T026 [US7] Tests, extend `tests/unit/public-routes.test.ts`: every route of `PUBLIC_ROUTES` and `/mcp/server-card` (not the image routes, which keep the spec 007 headers) sets `etag` equal to `"` + first 32 hex of the SHA-256 of the body; a request with that value in `If-None-Match` (also as `W/"..."`, inside a list, and `*`) answers 304 with no body and the same `etag`, `cache-control`, `vary`, `link` and CORS headers; a different value answers 200; `HEAD` on every public route answers the GET status and headers with an empty body; `HEAD /dashboard` still answers 404 as before. Acceptance: fails.
- [x] T027 [US7] Implement `publicResponse` (ETag, 304, HEAD) in `src/http/public.ts` and register `HEAD` for every public route through `getAndHead`. Acceptance: T026 passes.
- [x] T028 [US7] Test in new `tests/integration/public-no-io.test.ts` (Workers pool): build `trappedEnv` = `{ ...env, PUBLIC_ORIGIN: "https://egx.example.com", DB: trap("DB"), DATA: trap("DATA"), OAUTH_KV: trap("OAUTH_KV"), RATE_LIMITER: trap("RATE_LIMITER") }` where `trap(name)` is a `Proxy` whose `get` records `name.property` in an array and returns a function that throws; stub `globalThis.fetch` with `vi.spyOn` to throw. Call the default export of `src/index.ts` for: every public HTML path (GET and HEAD), every twin, every text and discovery path, `/og-image.png`, `/mcp/server-card`, a conditional GET with the right ETag, `GET /data` with `Accept: text/markdown`, `/Tools/`, `/no-such-page`. Assert the expected status for each, no `set-cookie`, the recorded access list is empty and `fetch` was never called. Acceptance: passes once Phases 2 to 5 are in (seen failing first by running it before T027 for the HEAD cases, or by a temporary KV read in a handler, then removed).
- [x] T029 [US7] Test in `site-html.test.ts`: for every page, `TextEncoder` byte length of the HTML plus `STYLESHEET` plus the `/logo-96.png` bytes is under 102,400. Acceptance: passes (gate test).
- [x] T030 [US3] Gate tests in new `tests/unit/site-content.test.ts` (SC-008): collect every public HTML body, twin, `robotsTxt`, `sitemapXml`, `llmsTxt`, `llmsFullTxt`, `JSON.stringify(serverCard)` and `JSON.stringify(aiCatalog)` (T034 adds `docs/listing/descriptions.md` and `server.json` to the same checker); strip HTML tags and decode entities; remove the allowed phrases of content-en.md section 9; assert no banned pattern matches; assert every content, guide, faq and home HTML page contains the notice paragraph and every summary and discovery file contains `SITE.dataLimits` or `NOTICE`. Acceptance: passes; seen failing by a temporary banned word in a test fixture string passed to the same checker function.
- [x] T031 [US3] Gate test in new `tests/unit/site-drift.test.ts` (Node pool; add to `NODE_TEST_FILES`) (SC-005, FR-S28): with `listNodeTools`, the registered tool names equal, as ordered sets: the tool names in the rendered `/tools` HTML (`<h3><code>name</code>`), the `## Tools` lines of `llmsTxt`, the `_meta` tools of `serverCard`, the tool sections of the `/tools` twin; each registered description equals the catalog description plus `NOTICE`; the home page "Learn more" text holds `TOOL_NAMES.length`; every page title and description in `sitemapXml`, `llmsTxt` and the HTML head agree with `PAGES`. Acceptance: passes; seen failing by a temporary extra catalog entry.
- [x] T032 [US1] Gate test in new `tests/unit/site-freshness.test.ts` (FR-S17): `CONTENT_PINS` per data-model.md, one per page; for each, `updated` equals the pin date and the SHA-256 of `JSON.stringify({ title, description, content })` for `TEST_CONTEXT` equals the pin hash; the failure message names the path, the new hash and "bump updated in src/site/pages.ts and this pin together". Fill the pins from the first failing run. Also assert `llmsTxt` and the server card `_meta` updated value equal the newest page date. Acceptance: passes with the pins.
- [x] T033 [US7] Run quickstart.md sections 2 to 7 against `npm run dev` with `PUBLIC_ORIGIN` set to the local address: curl table, page weight, Lighthouse for all 10 English pages, structured-data tool pass, render check at 375, 1024, 1440 in light and dark. Save outputs under `D:/Work/EGX MCP/.git/pipeline/seo-ai-discoverability/` (not committed). Fix any audit item below the SC-002 thresholds within the plan's design (for example contrast or tap target size in the new CSS); a fix that needs a design change is reported, not made. Acceptance: every page seo 1.00, accessibility, best practices and performance at least 0.95; results summarized in the dispatch report.

## Phase 6: Listing kit and README (US6)

- [x] T034 [US6] Tests: new `tests/unit/listing.test.ts` per contracts/discovery.md (reads `docs/listing/server.json` with `?raw`; equality with the server card for the `wrangler.jsonc` `PUBLIC_ORIGIN`; registry pattern and length); `docs/listing/descriptions.md` contains `SITE.name`, `SITE.oneLine`, `SITE.registryDescription`, `SITE.shortDescription`, `SITE.longDescription` and every keyword; `docs/listing/registries.md` has a table row for each of: Official MCP Registry, Smithery, PulseMCP, mcp.so, Glama, awesome-remote-mcp-servers, GitHub repository description and topics, Google Search Console, Bing Webmaster Tools, IndexNow, each with status `not submitted`; add the `descriptions.md` case to the T030 content checker. Extend `scripts/check-readme.ts`: the first paragraph after the H1 starts with `SITE.oneLine` and links the site home, tools, the four guides, FAQ and data pages. Acceptance: fails.
- [x] T035 [US6] Write `docs/listing/server.json` (contracts/discovery.md), `docs/listing/descriptions.md` (plan.md Design 6; logos listed by URL and size: `/icon-512.png` 512, `/icon-192.png` 192, `/favicon-32.png` 32, `/og-image.png` 1200 by 630), `docs/listing/registries.md` (research R5 rows plus the search-engine rows, columns: Listing, URL, Method, Text to use, Status, Date, Notes; an owner steps section repeating plan.md Owner-only tasks 3 to 8), and change `README.md`'s first paragraph to `SITE.oneLine` followed by the page links (the rest of the README unchanged). Acceptance: T034 passes; `npm run check:readme` PASS; content test passes.

## Phase 7: Arabic pages (US5), gated on owner approval

- [ ] T036 Gate: read `arabic-copy.md`; if its status line is not `**Status**: APPROVED YYYY-MM-DD`, stop and report BLOCKED (the run delivers Phases 1 to 6 and 8 without this phase). Otherwise continue.
- [ ] T037 [US5] Tests: new `tests/unit/site-arabic.test.ts`: status APPROVED; every Arabic string literal in `src/site/content/ar.ts` and in the Arabic values of `LOCALIZED`, `FOOTER_LINKS.ar` and `TOOL_GUIDE_AR` appears verbatim in `arabic-copy.md` (read with `?raw`; placeholders compared before substitution); the four Arabic pages render with `<html lang="ar" dir="rtl">`, Arabic title, description and h1 per arabic-copy.md, the Arabic header affiliation, Arabic footer and an `English` link with `hreflang="en"`; every English page with a translation links `العربية` with `hreflang="ar"`; `hreflang` `en`, `ar` and `x-default` links on both versions, reciprocal; the Arabic notice on every Arabic page; `TOOL_GUIDE_AR` keys equal `TOOL_NAMES`; the Arabic FAQ has the same number of pairs as the English one. Extend `site-pages.test.ts` (Arabic records and lengths: titles at most 60 characters, descriptions 70 to 160), `crawl.test.ts` (sitemap `xhtml:link` triples on the four English and four Arabic entries, Arabic paths allowed in robots), `site-markdown.test.ts` (`## Arabic` in `llms.txt`, Arabic twins in `llms-full.txt`), `structured-data.test.ts` (Arabic breadcrumb names, `WebSite.inLanguage` `["en", "ar"]`), `site-content.test.ts` (Arabic banned patterns and allowed phrases of arabic-copy.md section 9), `site-freshness.test.ts` (four new pins), `public-routes.test.ts` and `public-no-io.test.ts` (Arabic paths and twins, `/AR/` redirect). Acceptance: fails.
- [ ] T038 [US5] Implement: widen `Lang` to `"en" | "ar"`; `LOCALIZED.ar` and `FOOTER_LINKS.ar` from arabic-copy.md; `src/site/content/ar.ts` (Arabic builders and `TOOL_GUIDE_AR`, `TOOL_GROUPS_AR`); the four Arabic records appended to `PAGES` with their `topic`; language links in `render-html.ts` (re-add `LinkItem.hreflang`, `FooterLink.lang` and the `languageLink` parameter of `documentBody` and `siteFooter` in `src/http/views.ts`, removed in the round 1 review until this phase); `hreflang` alternates in the head and sitemap; the `## Arabic` section; `[dir="rtl"]` CSS already added in T012. Acceptance: T037 passes; all tests pass.
- [ ] T039 [US5] Run quickstart.md sections 5 and 7 for `/ar`, `/ar/tools`, `/ar/faq`, `/ar/data` (Lighthouse and RTL render at 375, 1024, 1440, light and dark). Acceptance: same thresholds as T033.

## Phase 8: Docs and contract updates (final)

- [x] T040 Amend earlier specs per plan.md "Amendments to earlier specs": append a dated "Amendment (spec 006)" section to `specs/002-legal-pages/spec.md` (FR-L01), `specs/003-home-page/spec.md` (FR-H01, FR-H05, FR-H06, FR-H08, FR-H09, title), `specs/005-logo-favicon/spec.md` (preview image, header link per language); edit `specs/001-egx-mcp-server/contracts/http-endpoints.md` (new rows for every route of contracts/routes.md, the `GET /`, `/privacy`, `/terms` rows, the headers paragraph split into public and private pages, the footer sentence, the `/mcp/server-card` note). If Phase 7 did not run, write the Arabic rows as "(spec 006 Phase 7, pending)". Acceptance: no em or en dash in the added lines; every new route of contracts/routes.md appears in http-endpoints.md.
- [x] T041 Update `specs/006-seo-ai-discoverability/tasks.md` checkboxes and add a "Delivered" note under plan.md Summary (date, phases delivered, Phase 7 status). Run `npm run typecheck`, `npm test`, `npm run check:readme`; grep the added lines of `git diff` for U+2014, U+2013, `--` in prose, `Co-Authored`, comment lines in `.ts` (`^\+\s*(//|/\*)`), `Essawy` or `gmail` outside `src/http/legal.ts` and README's existing privacy line. `git status --short` lists only files named in this tasks.md. Acceptance: all PASS; report the file list.

## Dependencies

Phase 1 before all. Phase 2 before 3, 4, 5. Phase 3 before 5 (T028, T030, T031 cover its outputs). Phase 4 before 5 (T029 size includes JSON-LD). Phase 6 after 5. Phase 7 after 6 and only with approval. Phase 8 last.

## Coverage map

| Requirement | Tasks |
|---|---|
| FR-S01 | T018, T019 |
| FR-S02 | T018, T019, T037 |
| FR-S03 | T011, T013, T014 |
| FR-S04 | T012, T013, T018 |
| FR-S05 | T022, T023 (key file), plan Owner task 5 |
| FR-S06 | T009, T011 |
| FR-S07 | T011, T013, T015 |
| FR-S08 | T024, T025 |
| FR-S09 | T009, T011, T012 |
| FR-S10 | T029, T033 |
| FR-S11 | T013, T026, T027 |
| FR-S12 | T012, T033, T039 |
| FR-S13 | T009, T010, T011 |
| FR-S14 | T002, T003, T007, T008, T031 |
| FR-S15 | T009, T010 |
| FR-S16 | T030 |
| FR-S17 | T011, T032 |
| FR-S18 | T036 to T039 |
| FR-S19 | T016, T017 |
| FR-S20 | T016, T017 |
| FR-S21 | T016, T022, T023 |
| FR-S22 | T020 to T023 |
| FR-S22a | T004, T016, T024, T034 |
| FR-S23 | T004, T031, T034 |
| FR-S24 | T009, T010 |
| FR-S25 | T034, T035 |
| FR-S26 | T034, T035 |
| FR-S27 | T006, T028 |
| FR-S28 | T003, T031, T032 |
| FR-S29 | T006, T013, T034 |
| FR-S30 | T002, T011, T013, T022, T040 |
| SC-001 | T009, T011 |
| SC-002 | T033, T039 |
| SC-003 | T024, T025, T033 |
| SC-004 | T013, T018 |
| SC-005 | T002, T031 |
| SC-006 | T028, T029 |
| SC-007 | T013, T018 |
| SC-008 | T030, T037 |
| SC-009 to SC-012 | post-release, owner and QA (qa-cases.md QA-004, QA-040 to QA-042) |
