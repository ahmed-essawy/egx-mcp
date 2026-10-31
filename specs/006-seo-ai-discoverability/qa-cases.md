# QA cases: Search and AI discoverability

Written from spec.md (with the planner changes of 2026-10-31) before implementation. Workspace: `D:/Work/EGX MCP`, branch `feat/seo-ai-discoverability`.

How to run the manual cases locally: `npm run dev` (wrangler dev, local simulation only, never `--remote`), address as wrangler prints (usually `http://localhost:8787`); for canonical URLs on the local origin start with `npx wrangler dev --var PUBLIC_ORIGIN:http://localhost:8787` (quickstart.md section 2). Use `curl.exe`. Never deploy, never write to the live Worker, never submit to a registry, a search engine or IndexNow. Cases marked `manual (external)` need the deployed site, a third-party account or time; QA records them NOT RUN with that reason unless the owner has done them.

Priority: 1 must pass to deliver, 2 should, 3 nice. Arabic cases (QA-021 to QA-024) apply only when Phase 7 ran; otherwise NOT RUN with "Phase 7 pending owner approval of arabic-copy.md".

## Cases

### QA-001 Crawler rules allow public pages, exclude private paths, name the sitemap
- Traces to: US1 A1, FR-S01, SC-007
- Type: automated (T018 `tests/unit/crawl.test.ts`) and manual check
- Priority: 1
- Preconditions and data: local Worker running.
- Steps: 1. Run `npm test` and find the crawl cases. 2. `curl.exe -s http://localhost:8787/robots.txt`.
- Expected: tests pass. The file has a `User-agent: *` group and one named group listing every token of research.md R1 (Googlebot, Bingbot, Applebot, DuckDuckBot, YandexBot, Amzn-SearchBot, OAI-SearchBot, Claude-SearchBot, PerplexityBot, DuckAssistBot, GoogleOther, GPTBot, ClaudeBot, Google-Extended, Applebot-Extended, CCBot, Meta-ExternalAgent, Amazonbot, Bytespider, cohere-ai, MistralAI-Training, ChatGPT-User, Claude-User, Perplexity-User, Meta-ExternalFetcher, MistralAI-User, Amzn-User); both groups `Allow: /` and disallow `/dashboard`, `/authorize`, `/callback/`, `/token`, `/register`, `/mcp`; last line `Sitemap: <origin>/sitemap.xml`.

### QA-002 Every sitemap address answers 200 and is canonical with a true date
- Traces to: US1 A2, FR-S02, SC-004
- Type: automated (T018, T013) and manual
- Priority: 1
- Steps: 1. `npm test`. 2. Fetch `/sitemap.xml`; for each `<loc>` run `curl.exe -s -o NUL -w "%{http_code}"` and read the page's `<link rel="canonical">` and its visible "Last updated".
- Expected: every `loc` answers 200, equals its own canonical link, and its `lastmod` equals the page's visible updated date; 10 English entries (14 after Phase 7), no `.md`, no private path.

### QA-003 Shared link previews show site name, page title, description and logo image
- Traces to: US1 A3, FR-S07
- Type: automated (T011, T013, T015) plus manual (external) preview
- Priority: 1 (automated part), 3 (external part)
- Steps: 1. `npm test`. 2. `curl.exe -s <origin>/faq` and read the `og:*` and `twitter:*` tags. 3. `curl.exe -s -o og.png <origin>/og-image.png` and open the file. 4. External: after deploy, paste a page URL into a WhatsApp or Slack chat to self, or the LinkedIn Post Inspector.
- Expected: tags per contracts/html-page.md with page-specific title and description, `og:site_name` EGX MCP, `og:image` absolute `<origin>/og-image.png` 1200 by 630 with alt text; the image shows the EGX MCP logo and text; the external preview shows the same.

### QA-004 Brand search returns the official site first (post-release)
- Traces to: US1 A4, SC-009
- Type: manual (external)
- Priority: 3
- Preconditions: sitemap submitted in Search Console at least 30 days earlier (owner task).
- Steps: 1. Search Google and Bing for "EGX MCP" in a private window. 2. In Search Console, open Pages and compare indexed pages with the sitemap.
- Expected: the official site is the first result with its site name and logo; 100% of sitemap pages indexed. Record date and result in `docs/listing/registries.md` notes.

### QA-005 Site summary file
- Traces to: US2 A1, FR-S19, FR-S22a
- Type: automated (T016) and manual
- Priority: 1
- Steps: 1. `npm test`. 2. `curl.exe -s <origin>/llms.txt`.
- Expected: `text/plain`; H1 EGX MCP, blockquote one-sentence description, paragraph naming the audience, `<origin>/mcp`, Streamable HTTP, Google sign-in or API key, and "delayed", "unofficial", "information only", "not investment advice", "not affiliated"; `Last updated:` date; `## Pages` with every English page linking its `.md`; `## Tools` with all 30 tools; `## Optional`; no personal name or email.

### QA-006 Full-content file in one fetch
- Traces to: US2 A2, FR-S20
- Type: automated (T016)
- Priority: 1
- Steps: 1. `npm test`. 2. `curl.exe -s <origin>/llms-full.txt` and search for each content page title, a tool name from each group and FAQ question 13.
- Expected: every content page body appears once with its `Source:` and `Last updated:` lines; all 30 tools; all FAQ pairs; legal pages only as links.

### QA-007 Plain-text version of any public page by address and by type
- Traces to: US2 A3, FR-S21
- Type: automated (T016, T022) and manual
- Priority: 1
- Steps: 1. `curl.exe -s <origin>/connect/cursor.md`. 2. `curl.exe -s -H "Accept: text/markdown" <origin>/connect/cursor`. 3. `curl.exe -sI <origin>/connect/cursor` and look for the `link` header; view the HTML head for `rel="alternate" type="text/markdown"`.
- Expected: steps 1 and 2 return the same Markdown (`text/markdown`), with the numbered steps, the JSON block, `Canonical: <origin>/connect/cursor` and `Last updated:`; step 3 advertises the twin; a browser `Accept` still gets HTML.

### QA-008 AI crawlers are explicitly allowed
- Traces to: US2 A4, FR-S01, SC-007
- Type: automated (T018 matcher test over every named token)
- Priority: 1
- Steps: `npm test`, crawl cases.
- Expected: for every named token, every public page, twin and summary file is allowed by an explicit named group (not only by `*`).

### QA-009 MCP discovery at the standard locations
- Traces to: US2 A5, FR-S22
- Type: automated (T020, T022) and manual
- Priority: 1
- Steps: 1. `curl.exe -s <origin>/.well-known/ai-catalog.json`. 2. `curl.exe -si <origin>/mcp/server-card`. 3. `curl.exe -s -o NUL -w "%{http_code}" -X POST <origin>/mcp`.
- Expected: catalog with one entry holding the card inline; card answers 200 `application/mcp-server-card+json` with `access-control-allow-origin: *`, name `io.github.ahmed-essawy/egx-mcp`, the remote `streamable-http` `<origin>/mcp`, the optional secret `Authorization` header, `_meta` OAuth and API key details, all 30 tools and the icons; step 3 still answers 401.

### QA-010 Tool catalog equals the registered tools and a test guards drift
- Traces to: US3 A1, FR-S14, SC-005, FR-S28
- Type: automated (T002, T007, T031)
- Priority: 1
- Steps: 1. `npm test`, find `site-drift` and `tool-descriptions`. 2. Open `/tools` and count the tool headings.
- Expected: tests pass; 30 tools with the registered descriptions; the summary files and the server card list the same 30.

### QA-011 Each assistant's connection guide is complete
- Traces to: US3 A2, FR-S13, FR-S24
- Type: manual
- Priority: 1
- Steps: open `/connect/claude`, `/connect/chatgpt`, `/connect/claude-code`, `/connect/cursor`.
- Expected: each opens with a one or two sentence answer, has 4 numbered steps with the exact server address `<origin>/mcp`, names the sign-in or key method for that assistant, and has an "If it does not work" list; Claude Code shows the `claude mcp add` command; Cursor shows the `mcp.json` block.

### QA-012 Questions page answers real-time and advice questions honestly
- Traces to: US3 A3, FR-S15, FR-S16
- Type: manual plus automated (T009)
- Priority: 1
- Steps: open `/faq`; read questions 3, 8 and 9; count the pairs.
- Expected: at least 15 pairs including every topic of FR-S15; question 3 says delayed about 15 minutes; question 8 says not advice and no buy, sell or hold recommendation; question 9 says not affiliated with the Egyptian Exchange; question 4 says unofficial.

### QA-013 Every content page carries the notice and never claims real-time data
- Traces to: US3 A4, FR-S16, SC-008, constitution I and VI
- Type: automated (T030)
- Priority: 1
- Steps: `npm test`, `site-content` cases.
- Expected: pass: no banned pattern after the allowlist on any page, twin, summary, discovery or listing file; the notice on every home, content, guide and FAQ page.

### QA-014 Home structured data declares organization, website and software
- Traces to: US4 A1, FR-S08
- Type: automated (T024) plus manual validator
- Priority: 1
- Steps: 1. `npm test`. 2. View source of `/`, copy the JSON-LD, paste it into validator.schema.org (code snippet tab).
- Expected: Organization (name, url, logo, sameAs, contactPoint url), WebSite (name, url), SoftwareApplication (name, description, url, image, offers price 0) and WebPage; validator 0 errors, 0 warnings.

### QA-015 FAQ and steps structured data match the visible text
- Traces to: US4 A2, SC-003
- Type: automated (T024)
- Priority: 1
- Steps: `npm test`, structured-data cases.
- Expected: FAQPage question and answer texts equal the visible questions and answers; HowTo step texts equal the visible steps, on all four guides.

### QA-016 Breadcrumbs on every page except home
- Traces to: US4 A3, FR-S08
- Type: automated (T024) and manual
- Priority: 2
- Steps: open `/data` and `/privacy`; view the breadcrumb nav and the JSON-LD.
- Expected: visible trail Home then the page label with `aria-current="page"`; BreadcrumbList with the same two names and URLs; the home page has no breadcrumb.

### QA-017 Public pages do not touch D1, KV, upstream or quotas
- Traces to: US7 A1, FR-S27, SC-006
- Type: automated (T028 `tests/integration/public-no-io.test.ts`)
- Priority: 1
- Steps: `npm test`, find the no-IO case.
- Expected: pass: every public route (GET, HEAD, conditional, negotiated, redirect, server card) through the real `src/index.ts` with recording proxies for DB, DATA, OAUTH_KV and RATE_LIMITER and a throwing `fetch`: zero recorded accesses, no cookie.

### QA-018 Private pages signal do-not-index and stay out of sitemap and summaries
- Traces to: US7 A2, FR-S04, SC-004, SC-007
- Type: automated (T013, T016, T018) and manual
- Priority: 1
- Steps: 1. `curl.exe -sI <origin>/no-such-page`. 2. Through the browser, sign in locally if a local Google client is configured, else use the dashboard test in the suite; check `/dashboard` headers. 3. Search `sitemap.xml`, `llms.txt`, `llms-full.txt` for `dashboard`, `authorize`, `callback`.
- Expected: private HTML responses carry `x-robots-tag: noindex, nofollow`, `cache-control: no-store` and the robots meta; none of the private paths appears in the sitemap or summary files except the dashboard URL as the place to create a key (a link in text, not a listed page).

### QA-019 Unknown address answers a real 404
- Traces to: US7 A3, FR-S03
- Type: automated (T013) and manual
- Priority: 1
- Steps: `curl.exe -s -o NUL -w "%{http_code}" <origin>/tool`; also `/connect`, `/faq/x`.
- Expected: 404 each, with the not found page and `noindex`.

### QA-020 One canonical version per page
- Traces to: US7 A4, FR-S03
- Type: automated (T013) and manual
- Priority: 1
- Steps: `curl.exe -s -o NUL -w "%{http_code} %{redirect_url}" <origin>/Tools/`; `<origin>/FAQ`; `<origin>/tools?utm_source=test` (read the canonical link).
- Expected: `301` to `<origin>/tools` and `<origin>/faq`; the tracking URL answers 200 with canonical `<origin>/tools`.

### QA-021 Arabic pages declare Arabic, RTL and link both ways
- Traces to: US5 A1, FR-S18
- Type: automated (T037) and manual
- Priority: 1 when Phase 7 ran
- Steps: open `/ar`, `/ar/tools`, `/ar/faq`, `/ar/data`; read `<html>`, the title, description and the alternate links; follow the English link and back.
- Expected: `lang="ar" dir="rtl"`, Arabic title and description equal arabic-copy.md, `hreflang` en, ar and x-default on both versions, visible language links both ways.

### QA-022 Sitemap names both language versions
- Traces to: US5 A2, FR-S02
- Type: automated (T037)
- Priority: 1 when Phase 7 ran
- Steps: fetch `/sitemap.xml`, read the entries for `/`, `/ar`, `/tools`, `/ar/tools`.
- Expected: each of the 8 entries has three `xhtml:link` lines (en, ar, x-default to English).

### QA-023 Arabic notice says the same as the English one
- Traces to: US5 A3, FR-S16, FR-S18
- Type: automated (T037) and manual (owner reading)
- Priority: 1 when Phase 7 ran
- Steps: read the notice on each Arabic page.
- Expected: it says delayed, unofficial, information only, not advice and (with the header) not affiliated; text equals arabic-copy.md section 1, approved by the owner.

### QA-024 Arabic pages render right-to-left at every width
- Traces to: US5, FR-S12
- Type: manual
- Priority: 2 when Phase 7 ran
- Steps: open the four Arabic pages at 375, 1024 and 1440 px in light and dark.
- Expected: text and tables right-aligned, code and URLs left-to-right inside their boxes, no horizontal scroll, focus visible.

### QA-025 Listing kit is ready to submit without further writing
- Traces to: US6 A1, FR-S25
- Type: automated (T034) and manual
- Priority: 1
- Steps: open `docs/listing/server.json`, `descriptions.md`, `registries.md`.
- Expected: manifest valid for the registry schema (name, title, description of 100 chars or fewer, version, remote), descriptions and keywords equal the site identity, logos listed with URLs and sizes, every registry row with method, text and status `not submitted`; nothing has been submitted.

### QA-026 Repository front page opens with the site sentence and links the pages
- Traces to: US6 A2, FR-S26
- Type: automated (T034, `npm run check:readme`) and manual
- Priority: 1
- Steps: `npm run check:readme`; read the first paragraph of `README.md`.
- Expected: PASS; the paragraph starts with the one-sentence description and links home, tools, the four guides, FAQ and data.

### QA-027 SC-001 page checklist on every public page
- Traces to: SC-001, FR-S06, FR-S07, FR-S09
- Type: automated (T009, T011)
- Priority: 1
- Steps: `npm test`, `site-pages` and `site-html`.
- Expected: unique titles of 60 characters or fewer starting with the topic, unique descriptions of 70 to 160 characters, canonical, preview tags, one h1, logical heading order, language, descriptive links, reachable from home within two clicks, no orphan.

### QA-028 SC-002 Lighthouse scores on a simulated mid-range phone
- Traces to: SC-002, FR-S10, FR-S12
- Type: manual (quickstart.md section 5)
- Priority: 1
- Steps: run the Lighthouse loop for the 10 English pages (14 after Phase 7).
- Expected: seo 1.00, accessibility, best practices and performance at least 0.95 on every page; LCP under 2.5 s, CLS 0.

### QA-029 SC-003 structured data validates
- Traces to: SC-003
- Type: automated (T024) plus manual (quickstart.md section 6)
- Priority: 1 (offline and test parts), 2 (validator.schema.org on the deployed site, manual (external))
- Steps: run the `structured-data-testing-tool` pass on saved pages; after deploy, validator.schema.org and the Rich Results Test for `/`, `/faq`, `/connect/claude`, `/data`.
- Expected: no parse error offline; validator.schema.org 0 errors, 0 warnings; Rich Results Test no error on Breadcrumb and Organization (FAQ, HowTo, Software app may show not eligible).

### QA-030 Deployed site headers and crawlability
- Traces to: SC-002, SC-007, FR-S11
- Type: manual (external), after the owner deploys
- Priority: 2
- Steps: `curl.exe -sI https://egx-mcp.essawy.workers.dev/tools`, `/robots.txt`, `/dashboard`; Lighthouse once against the deployed home.
- Expected: same headers as locally; HTTPS; the deployed home scores as QA-028.

### QA-031 SC-004 sitemap and summary membership
- Traces to: SC-004
- Type: automated (T018, T016, T031)
- Priority: 1
- Steps: `npm test`.
- Expected: 100% of public pages in the sitemap and summary file, 0 private pages, every `loc` 200 and canonical.

### QA-032 SC-006 zero I/O and page weight
- Traces to: SC-006, FR-S10
- Type: automated (T028, T029) and manual (quickstart.md section 4)
- Priority: 1
- Steps: `npm test`; run the page weight loop.
- Expected: tests pass; every page's HTML plus CSS plus logo under 100 KB.

### QA-033 Cacheable public pages with a validator; private pages no-store
- Traces to: FR-S11, US7 A1
- Type: automated (T013, T026) and manual
- Priority: 1
- Steps: fetch `/faq` headers, then repeat with `If-None-Match` set to the `etag`; `HEAD /llms.txt`; `curl.exe -sI <origin>/no-such-page`.
- Expected: `public, max-age=3600` with `etag`; 304 on the second request; HEAD returns headers and no body; private page `no-store`.

### QA-034 Single source: one change updates every output
- Traces to: Edge case "a page changes", FR-S28, FR-S17
- Type: automated (T031, T032) plus a manual mutation check
- Priority: 2
- Steps: in a scratch copy only (never committed), change one tool description in `src/mcp/tool-descriptions.ts` and run `npm test`.
- Expected: `site-freshness` fails naming `/tools` (and the summary files' date via the newest page), telling to bump `updated`; no drift test fails, because catalog, summary files and card all show the new text. Revert the scratch change.

### QA-035 Address independence
- Traces to: Edge case "public address changes", FR-S29
- Type: automated (T006, T013) and manual
- Priority: 1
- Steps: start `npx wrangler dev --var PUBLIC_ORIGIN:https://egx.example.org`; fetch `/`, `/sitemap.xml`, `/llms.txt`, `/mcp/server-card`.
- Expected: every absolute URL uses `https://egx.example.org`; no `workers.dev` anywhere except `docs/listing/server.json` (by design, test-tied to `wrangler.jsonc`).

### QA-036 No script dependence and no external resources
- Traces to: Edge case "scripts disabled", FR-S10
- Type: automated (T011, T024) and manual
- Priority: 2
- Steps: open `/tools` with JavaScript disabled in Chrome DevTools; view source.
- Expected: all content present; the only `<script>` is the JSON-LD data block; no external font, script or tracker; browser console shows no CSP violation.

### QA-037 Preview image missing or blocked
- Traces to: Edge case "logo or social image missing"
- Type: manual
- Priority: 3
- Steps: block `/og-image.png` in DevTools request blocking and reload `/`.
- Expected: the page renders fully; the brand text EGX MCP is still in the header.

### QA-038 Existing behavior unchanged
- Traces to: FR-S30
- Type: automated (full `npm test`, T002 unchanged descriptions, T011 legal body byte equality and hero, connect and notice markup) and manual
- Priority: 1
- Steps: `npm test`; sign in locally if possible; call one MCP tool through an existing contract test.
- Expected: all pre-existing tests pass (with only the planned header assertion changes); legal text unchanged; dashboard, OAuth, `/mcp` behave as before.

### QA-039 No personal name or email in anything this feature adds
- Traces to: FR-S22a
- Type: automated (T004, T016, T024, T034) and manual grep
- Priority: 1
- Steps: `git diff main --name-only`; grep the added lines for `Essawy` and `gmail`.
- Expected: none, except the unchanged legal pages and README's existing privacy line.

### QA-040 Benchmark questions to assistants (post-release tracking)
- Traces to: SC-010, SC-011
- Type: manual (external)
- Priority: 3
- Preconditions: a fresh session in each of at least three assistants with web access (for example Claude, ChatGPT, Perplexity), not connected to EGX MCP.
- Test data (the fixed 20 questions):
  1. How do I get EGX stock prices in Claude?
  2. Is there an MCP server for the Egyptian Exchange?
  3. How can I ask ChatGPT about Egyptian stocks?
  4. What is the best way to get EGX30 data into an AI assistant?
  5. Egyptian Exchange MCP server
  6. How do I connect Cursor to Egyptian stock market data?
  7. Is there a free API for Egyptian Exchange prices for AI agents?
  8. Can Claude Code read EGX market data?
  9. How do I get Egyptian mutual fund NAVs in an AI assistant?
  10. Where can an AI assistant get the gold price in Egypt?
  11. MCP server for Egyptian stocks with delayed quotes
  12. How do I ask an AI about EGX dividends?
  13. كيف أحصل على أسعار الأسهم المصرية في Claude؟
  14. هل يوجد خادم MCP للبورصة المصرية؟
  15. بيانات البورصة المصرية للذكاء الاصطناعي
  16. كيف أسأل ChatGPT عن مؤشر EGX30؟
  17. أسعار الأسهم المصرية في كلود
  18. كيف أربط Cursor ببيانات البورصة المصرية؟
  19. صناديق الاستثمار المصرية في مساعد ذكاء اصطناعي
  20. سعر الذهب في مصر عبر مساعد ذكاء اصطناعي
- Steps: before release and every 30 days, ask each question in each assistant; record per answer whether it names or links EGX MCP.
- Expected: results recorded in `docs/listing/benchmark.md` with date and assistant; target at least 50% of answers by 90 days, and the site in search results for at least 10 of the 20 queries (SC-011).

### QA-041 Search impressions grow (post-release tracking)
- Traces to: SC-011
- Type: manual (external)
- Priority: 3
- Steps: monthly, Search Console Performance, filter queries not containing "egx mcp".
- Expected: impressions grow month over month for the first 3 months; recorded with the benchmark results.

### QA-042 Registry statuses recorded and consistent (post-release tracking)
- Traces to: SC-012, US6
- Type: manual (external)
- Priority: 3
- Steps: after each owner-approved submission, open the live listing and compare name, description and logo with `docs/listing/descriptions.md`; update the status column.
- Expected: every row has a status; every approved submission is live with the site wording.

### QA-043 Change notification is supported without a job
- Traces to: FR-S05
- Type: automated (T022 key file) and manual (external, owner)
- Priority: 2
- Steps: `curl.exe -s <origin>/c60c57998197b5e5b4a9fc2f935a3c44.txt`; after a deploy, the owner runs quickstart.md section 8.
- Expected: the key file returns the key; the IndexNow POST answers 200 or 202; no cron was added (`wrangler.jsonc` `triggers` unchanged).

## Coverage

| Scenario or criterion | Cases |
|---|---|
| US1 A1 | QA-001 |
| US1 A2 | QA-002 |
| US1 A3 | QA-003 |
| US1 A4 | QA-004 |
| US2 A1 | QA-005 |
| US2 A2 | QA-006 |
| US2 A3 | QA-007 |
| US2 A4 | QA-008 |
| US2 A5 | QA-009 |
| US3 A1 | QA-010 |
| US3 A2 | QA-011 |
| US3 A3 | QA-012 |
| US3 A4 | QA-013 |
| US4 A1 | QA-014 |
| US4 A2 | QA-015 |
| US4 A3 | QA-016 |
| US5 A1 | QA-021 |
| US5 A2 | QA-022 |
| US5 A3 | QA-023 |
| US6 A1 | QA-025 |
| US6 A2 | QA-026 |
| US7 A1 | QA-017, QA-033 |
| US7 A2 | QA-018 |
| US7 A3 | QA-019 |
| US7 A4 | QA-020 |
| SC-001 | QA-027 |
| SC-002 | QA-028, QA-030 |
| SC-003 | QA-015, QA-029 |
| SC-004 | QA-002, QA-031 |
| SC-005 | QA-010 |
| SC-006 | QA-017, QA-032 |
| SC-007 | QA-001, QA-008, QA-018 |
| SC-008 | QA-013 |
| SC-009 | QA-004 |
| SC-010 | QA-040 |
| SC-011 | QA-040, QA-041 |
| SC-012 | QA-042 |
| Edge cases | QA-034, QA-035, QA-036, QA-037, QA-024 |
| FR-S05, FR-S22a, FR-S30 | QA-043, QA-039, QA-038 |
