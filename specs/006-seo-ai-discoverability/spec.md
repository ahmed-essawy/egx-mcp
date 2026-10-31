# Feature Specification: Search and AI discoverability

**Feature Branch**: `006-seo-ai-discoverability` | **Created**: 2026-10-31 | **Status**: Draft

**Input**: User description: "make the website very seo friendly and very very ai friendly to max as you can i need no one search or ask any ai agent and must recommend me because the seo optimization you will execute it"

## Intent

The owner wants EGX MCP to be the answer when a person searches, or asks an AI assistant, how to get Egyptian Exchange (EGX) data into an assistant. Today the site is one thin home page plus privacy, terms and a dashboard, all sent as uncacheable, with no description, no social preview, no sitemap, no crawler rules and no machine-readable summary. Search engines have almost nothing to index and AI assistants have nothing to quote.

No one can guarantee that a search engine or an assistant will recommend a site; ranking and recommendation are decided outside the owner's control. This feature therefore delivers everything the owner controls and that is known to help: indexable, fast, well-described, richly structured pages that answer the questions people actually ask; machine-readable summaries and discovery files for AI crawlers and agents; and listing material for the places where assistants and people look up MCP servers. Its results are measured by audits before release and by search and assistant visibility after release (see Success Criteria).

## Clarifications

### Session 2026-10-31

- Q: Should the home page regain example questions and links to the new pages? -> A: Yes, option B: exactly 5 example questions and a links section to the new pages; hero, connect block and notice unchanged; the tool list stays on its own page.
- Q: What publisher name and contact do public pages and structured data show? -> A: Option B: the project name "EGX MCP" as publisher and the GitHub repository issues page as the only public contact; no personal name or email anywhere.
- Q: Allow AI training crawlers in the crawler rules? -> A: Option A: allow all (search, live-answer, user-agent fetchers and training crawlers) on public pages.

## User Scenarios and Testing

### User Story 1: Be found by people searching (Priority: P1)

An Egyptian investor or developer searches for things like "EGX data for Claude", "EGX stock prices ChatGPT", "Egyptian Exchange MCP server", "ask AI about EGX30" (in English or Arabic). They find EGX MCP, see a clear title, description and preview in the results, and land on a page that answers the question.

**Why this priority**: Search is the main way people discover a new free tool. Without indexable, well-described pages nothing else in this feature matters.

**Independent Test**: Fetch every public page and check it against the page checklist (unique title, description, canonical address, preview image, one heading, correct language, structured data that validates, status 200, cacheable). Fetch the sitemap and the crawler rules and check them. All can be done without any third-party account.

**Acceptance Scenarios**:

1. **Given** a search engine crawler, **When** it requests the crawler rules file, **Then** it receives rules that allow every public page, exclude private pages (sign-in, dashboard, authorization) and name the sitemap.
2. **Given** a crawler that reads the sitemap, **When** it requests each listed address, **Then** every one answers 200, is the canonical version of its page and carries a last-modified date that is true.
3. **Given** a person shares any public page link in a chat or social app, **When** the app builds a preview, **Then** it shows the site name, a page-specific title, a page-specific description and the logo image.
4. **Given** a person searches the brand name "EGX MCP", **When** results load after the site is indexed, **Then** the official site is the first result and shows its site name and logo.

---

### User Story 2: Be quotable by AI assistants (Priority: P1)

A person asks an assistant "How can I get EGX stock prices in Claude?" or "Is there an MCP server for the Egyptian Exchange?". The assistant, using search or by fetching the site, finds a short, accurate, self-contained description of EGX MCP (what it is, what it covers, how to connect, its limits) and can quote it correctly with a link.

**Why this priority**: The owner's goal is to be recommended by assistants. Assistants recommend what they can read, verify and summarize without guessing.

**Independent Test**: Fetch the machine-readable summary, the full-content file and the plain-text version of each public page, and check that they exist, are current, match the human pages, name the data limits, and contain no claim the human pages do not make. Ask a fresh assistant with web access the benchmark questions (see Success Criteria) and record the answers.

**Acceptance Scenarios**:

1. **Given** an AI crawler or agent, **When** it requests the site summary file at the root, **Then** it receives a short plain-text description: what EGX MCP is, who it is for, the server address, how to connect, the list of public pages, and the data limits (delayed, unofficial, informational only).
2. **Given** an agent that wants everything in one fetch, **When** it requests the full-content file, **Then** it receives the content of every public page, the complete tool list with descriptions and the question and answer pairs, in plain text.
3. **Given** an agent that fetches any public page and asks for a plain-text version, **When** the request is made, **Then** it receives the same content without layout, with the canonical link and the last-updated date.
4. **Given** an AI crawler listed in the crawler rules, **When** it requests a public page, **Then** it is allowed, and the rules state this explicitly instead of relying on silence.
5. **Given** an MCP client or agent looking for how to connect, **When** it requests the standard discovery location for MCP servers, **Then** it finds the server address, transport, authentication methods and the tool list.

---

### User Story 3: Answer the real questions with real pages (Priority: P1)

A visitor who is not yet a user finds pages that answer, in plain language, what they want to know before they sign in: what the server does, every tool and what it returns, how to connect from each assistant, what the data is and how late it is, and common questions with straight answers.

**Why this priority**: Search engines and assistants rank and quote pages that fully answer a question. One thin home page cannot rank for many queries. Several focused pages can.

**Independent Test**: Request each content page and check that it has a unique topic, a one-sentence answer near the top, step lists or tables where useful, the data notice, links to related pages, and that its facts equal the facts in the code (tool list equals registered tools, limits equal configured limits).

**Acceptance Scenarios**:

1. **Given** the tool catalog page, **When** it is compared with the tools the server registers, **Then** both lists are identical in names and descriptions, and a test fails when they drift apart.
2. **Given** a person using Claude, ChatGPT, Claude Code or Cursor, **When** they open that assistant's connection guide, **Then** they see numbered steps, the exact server address, the sign-in or key method that works in that assistant and a note on what to do if it fails.
3. **Given** a visitor asks "is the data real-time?" or "is this financial advice?", **When** they read the questions page, **Then** each is answered directly and honestly (delayed about 15 minutes, unofficial, informational only, not advice, not affiliated with the Egyptian Exchange).
4. **Given** any content page, **When** it is read, **Then** it carries the delayed-data and informational-only notice and never presents data as real-time.

---

### User Story 4: Rich results and clear identity (Priority: P2)

Search engines and assistants understand what the site is without guessing: its name, logo, owner, the software it offers, its pages' question and answer pairs and step lists, and how pages relate to each other.

**Why this priority**: Structured identity and rich results improve how the listing looks and how reliably assistants attribute facts. It builds on the pages of stories 1 to 3.

**Independent Test**: Run every public page through a structured-data validator and a rich-results check and confirm zero errors; confirm the structured data restates only what is visible on the page.

**Acceptance Scenarios**:

1. **Given** the home page, **When** its structured data is read, **Then** it declares the organization, the website and the software application with name, description, logo, address and price (free).
2. **Given** the questions page and the connection guides, **When** their structured data is read, **Then** the questions and answers and the steps match the visible text exactly.
3. **Given** every public page except the home page, **When** it is read, **Then** it exposes a breadcrumb path to the home page.

---

### User Story 5: Arabic audience (Priority: P2)

An Arabic-speaking investor searches in Arabic ("بيانات البورصة المصرية للذكاء الاصطناعي", "أسعار الأسهم المصرية في كلود") and finds the Arabic version of the key pages, right-to-left, linked to the English version so each audience gets the right one.

**Why this priority**: EGX investors search in Arabic at least as much as in English, and few competitors answer in Arabic. It is a large share of the reachable audience, but it depends on the English pages existing first.

**Independent Test**: Request the Arabic version of each translated page and check language, direction, title, description, canonical address, language alternates in both directions, and sitemap entries.

**Acceptance Scenarios**:

1. **Given** an Arabic page, **When** it is read, **Then** it declares Arabic and right-to-left, has an Arabic title and description, and links to its English equivalent and back.
2. **Given** a crawler reads the sitemap, **When** it reads an entry that has a translation, **Then** the entry names both language versions.
3. **Given** an Arabic page quotes the data notice, **When** it is read, **Then** the notice says the same as the English one (delayed, unofficial, informational only, not advice, not affiliated).

---

### User Story 6: Listed where assistants and people look (Priority: P2)

EGX MCP is described, ready to submit, in the places people and assistants use to find MCP servers (public MCP registries and directories, the code repository page, and curated lists), with the same name, description and logo everywhere.

**Why this priority**: Registries and the repository page are heavily crawled and often quoted by assistants. Consistent listings multiply the reach of the site pages. Submitting them is an outward-facing act that needs the owner's go-ahead, so this story delivers the ready material and a tracked checklist, not the submissions themselves.

**Independent Test**: Open the listing kit and check that it holds a registry manifest, a short and a long description, the logo set, keywords, and a checklist of registries with the status of each; check that the repository front page and its description match the site wording.

**Acceptance Scenarios**:

1. **Given** the listing kit, **When** the owner approves, **Then** each registry entry can be submitted without further writing.
2. **Given** the repository front page, **When** it is read, **Then** it opens with the same one-sentence description as the site and links to the site pages.

---

### User Story 7: Fast, safe and private by design (Priority: P1)

Public pages load quickly everywhere, stay within the free hosting limits even when crawlers and assistants fetch them heavily, and private pages are never indexed.

**Why this priority**: Page speed and clean crawling are ranking signals and crawler budget limits. Free-tier limits are a hard rule of this project, and a crawler spike must not break the service or the signed-in users.

**Independent Test**: Measure the public pages with a standard audit and with a repeated-request load check; confirm cacheability headers, page weight, and that crawler traffic touches neither the database nor the key-value store nor the user quotas; confirm private pages carry a do-not-index signal.

**Acceptance Scenarios**:

1. **Given** a public content page, **When** it is requested repeatedly, **Then** it is served as cacheable content without reading the database or the key-value store, and does not count against any user's or the global call quota.
2. **Given** the sign-in, dashboard, authorization and callback pages, **When** a crawler fetches them, **Then** they signal do-not-index and are excluded from the sitemap and the summary files.
3. **Given** a page that does not exist, **When** it is requested, **Then** the answer is a real "not found" status, not a 200 page.
4. **Given** the same page requested with and without a trailing slash, in upper case, or with tracking parameters, **When** it is fetched, **Then** one canonical version is indexed and the others redirect or declare it.

### Edge Cases

- A page changes (a tool is added): the tool catalog, the summary files, the full-content file, the structured data and the sitemap dates update together from one source, so none can be stale.
- The public address changes (custom domain later): every canonical address, sitemap entry, structured-data address, discovery file and summary file follows the configured public address; nothing hard-codes the current address.
- A crawler requests a very large number of pages or the same page very often: responses stay cacheable and cheap; no database, key-value or upstream access happens for public pages.
- An assistant quotes outdated text: every summary file and page shows a last-updated date so assistants can judge freshness.
- A visitor with scripts disabled or a text-only crawler: all content is in the delivered HTML; nothing depends on scripts.
- Content must not contradict the constitution: no page claims real-time data, no page recommends buying, selling or holding, no page implies EGX endorsement, and no page shows live prices or per-symbol data (permission to redistribute has not been granted).
- The logo or social image is missing or blocked: pages still render and previews fall back to the site name.
- The dashboard, sign-in and authorization pages contain account data: they must never be cached by shared caches and never appear in a sitemap or summary file.
- Search engines treat a workers.dev address as lower trust than a custom domain: this feature must work correctly on the current address and must move to a custom domain with no content change.

## Requirements

### Functional Requirements

**Crawling and indexing**

- **FR-S01 Crawler rules**: The site MUST publish crawler rules at the standard root location. They MUST allow all public pages, name the sitemap, exclude private paths, and explicitly allow the major search and AI crawlers (search engines, assistant answer crawlers, assistant training crawlers and assistant user-agent fetchers) by name. Training crawlers are allowed on public pages (owner decision, Clarifications 2026-10-31).
- **FR-S02 Sitemap**: The site MUST publish a sitemap listing every public page once, at its canonical address, with a truthful last-modified date, and language alternates for translated pages. A test MUST fail if a public page is missing from it or a listed address does not answer 200.
- **FR-S03 Canonical addresses**: Every public page MUST declare one canonical address; variants (trailing slash, case, tracking parameters) MUST resolve to it. Unknown addresses MUST answer a real not-found status.
- **FR-S04 Private pages**: Sign-in, dashboard, key management, authorization, callbacks and error pages MUST signal do-not-index (by header and by page tag), MUST stay out of the sitemap and summary files, and MUST NOT be shared-cacheable.
- **FR-S05 Change notification**: Where a free mechanism exists to tell search engines that pages changed, the site MUST support it, without adding a paid service or a scheduled job beyond the free limits.

**Page quality**

- **FR-S06 Page essentials**: Every public page MUST have a unique title of 50 to 60 characters or fewer that starts with the page topic, a unique description of 70 to 160 characters, one top-level heading, a logical heading order, a language declaration, and descriptive link text.
- **FR-S07 Social previews**: Every public page MUST carry the open-graph and short-card tags (site name, title, description, canonical address, type, locale) and a 1200 by 630 preview image that includes the logo, plus text alternatives for images.
- **FR-S08 Structured data**: Public pages MUST carry structured data that validates with zero errors and only restates visible content: organization, website with site name, software application (free) on the home page; question and answer on the questions page; steps on each connection guide; breadcrumb on every page except home.
- **FR-S09 Internal linking**: Every public page MUST be reachable from the home page within two clicks, MUST link to its related pages, and the footer MUST link to all main pages. No public page may be an orphan.
- **FR-S10 Performance**: Public pages MUST be fast on a mid-range phone on a slow connection: the main content paints in under 2.5 seconds, layout does not shift, input responds immediately, each page's delivered HTML plus assets stays under 100 KB, with no external fonts, scripts or trackers.
- **FR-S11 Cacheability**: Public pages and assets MUST be served with cache headers that let browsers and edge caches reuse them, with a validator so unchanged pages answer cheaply. Private pages keep no-store.
- **FR-S12 Accessibility and mobile**: Public pages MUST keep the existing accessibility level (WCAG 2.2 AA contrast, keyboard use, skip link, visible focus) and work at phone width without horizontal scrolling.

**Content**

- **FR-S13 Page set**: The site MUST provide these public pages in English: home, tool catalog, one connection guide each for Claude, ChatGPT, Claude Code and Cursor, questions and answers, data sources and limits. The home page MUST state what the service is in its first sentence, show exactly 5 example questions to ask, and link to every other page in one links section. The hero, connect block and notice stay unchanged, and the tool list is not repeated on the home page.
- **FR-S14 Tool catalog**: The tool catalog MUST list every registered tool with its name, a plain description, example questions and what it returns. It MUST be generated from the tool registry so it cannot drift.
- **FR-S15 Questions and answers**: The questions page MUST answer at least 15 real questions in natural-language form, including: what EGX MCP is, whether it is free, whether the data is real-time, which sources it uses, which assistants it works with, how to connect, whether it gives investment advice, whether the Egyptian Exchange is affiliated, how the data is kept private, how to delete an account, and how it differs from searching the web.
- **FR-S16 Data honesty**: Every public page and every machine-readable file MUST state, where data is mentioned, that it is delayed (about 15 minutes), unofficial and for information only; MUST NOT say or imply real-time data, investment advice or Egyptian Exchange affiliation; and MUST NOT show live prices or per-symbol data.
- **FR-S17 Freshness**: Every public page and summary file MUST show a last-updated date that changes only when its content changes.
- **FR-S18 Arabic pages**: The home page, tool catalog, questions page and data page MUST exist in Arabic, right-to-left, with the language alternates of FR-S02 and in-page language links, and the same facts as the English pages.

**AI discoverability**

- **FR-S19 Site summary file**: The site MUST publish a plain-text summary at the root (the llms.txt convention): name, one-sentence description, who it is for, server address, connection methods, a list of every public page with a one-line description, and the data limits.
- **FR-S20 Full-content file**: The site MUST publish a second plain-text file with the full content of every content page (the privacy policy and terms are linked, not copied, see FR-S22a), the complete tool list and the questions and answers, generated from the same source as the pages.
- **FR-S21 Plain-text pages**: Every public page MUST be available as plain text (the same content, no layout) through a predictable address and through a request for the plain-text type, and each page MUST advertise it.
- **FR-S22 MCP discovery**: The site MUST publish the standard discovery information for the MCP server at the well-known location: server address, transport, authentication methods, name, description, icon and tool list, generated from the live registry.
- **FR-S22a Publisher identity**: The publisher in structured data, the summary files, the discovery information and the listing kit MUST be the project name "EGX MCP", with the GitHub repository issues page as the only public contact. No personal name or email address may appear in any page, file or listing this feature adds, nor in structured data. The privacy policy and terms keep the operator identity and contact they already show (spec 002, needed as the legal contact), and their text is not copied into the summary files (planner change 2026-10-31, to be confirmed by the owner; see plan.md, Open questions).
- **FR-S23 Entity consistency**: The same name ("EGX MCP"), one-sentence description, logo and keyword set MUST be used on every page, file, listing and structured-data block, taken from one definition.
- **FR-S24 Citation-ready writing**: Each content page MUST open with a direct one or two sentence answer, use short sections with question headings where natural, tables and numbered steps where useful, and state facts with their limits, so an assistant can quote a section on its own.

**Listings**

- **FR-S25 Listing kit**: The repository MUST contain a listing kit: the MCP registry manifest, a 160-character and a long description, the keyword set, the logo set and a checklist of registries, directories and lists with the status of each. Submissions MUST NOT be made without the owner's go-ahead.
- **FR-S26 Repository page**: The repository front page and description MUST open with the site's one-sentence description and link to the site pages.

**Safety and limits**

- **FR-S27 No cost, no load**: Public pages, text files and discovery files MUST be served without reading the database, the key-value store or any upstream provider, MUST NOT count against any per-user or global call quota, and MUST fit the free hosting limits at 10 times the current traffic.
- **FR-S28 Single source**: Names, descriptions, the tool list, the page list and dates MUST come from one source that feeds the pages, the sitemap, the summary files, the structured data and the discovery file; a test MUST fail when any output disagrees with another.
- **FR-S29 Address independence**: All absolute addresses MUST come from the configured public address, so a later custom domain needs a configuration change only.
- **FR-S30 No regression**: The existing security headers on pages that stay as they are, the home page's role, the privacy policy and terms content, the dashboard and the MCP endpoint MUST behave as before. Where this feature changes a decision in an earlier spec, the plan MUST list the amendment.

### Key Entities

- **Site identity**: the single definition of name, one-sentence description, long description, keywords, logo set, public address and owner contact used everywhere.
- **Public page**: a page with a topic, language, title, description, canonical address, last-updated date, content sections, related pages, and optional structured data.
- **Page set**: the ordered list of public pages that feeds the sitemap, the summary files, the footer and the home page links.
- **Tool entry**: a registered MCP tool with its name, description and example questions, shown in the catalog, the summary files and the discovery information.
- **Question and answer**: a natural-language question with its direct answer, shown on the questions page, in the full-content file and in structured data.
- **Listing**: one registry, directory or list entry with its text, link, status and date submitted.

## Success Criteria

### Measurable Outcomes

Release gates (checked before delivery):

- **SC-001**: 100% of public pages pass the page checklist of FR-S06, FR-S07 and FR-S09 (unique title and description, canonical address, preview, one heading, no orphan), checked by an automated test.
- **SC-002**: A standard search-quality audit scores 100 for search, 95 or more for accessibility and best practices, and 95 or more for performance on the home page and each content page on a simulated mid-range phone.
- **SC-003**: Structured data on every public page validates with zero errors and zero warnings in a standard validator (validator.schema.org), the question and answer pairs and steps match the visible text, and Google's Rich Results Test shows no error for the breadcrumb and organization items. Question and answer, step and software application items may show as not eligible there: Google retired those rich results in 2023 and 2026 and needs a rating for software, which this service cannot truthfully give (planner change 2026-10-31, research R6).
- **SC-004**: 100% of sitemap addresses answer 200 and are canonical; 100% of public pages appear in the sitemap; 0 private pages appear in the sitemap or summary files.
- **SC-005**: The tool list shown in the catalog, the summary files, the discovery information and the tool count on the home page equals the registered tools in every output (0 differences), enforced by a test.
- **SC-006**: Public pages and text files are served with 0 database reads, 0 key-value reads or writes and 0 upstream calls, and each page stays under 100 KB.
- **SC-007**: Every one of the named search and AI crawlers is allowed on every public page by the crawler rules, and every private page signals do-not-index.
- **SC-008**: No public page or file contains a claim of real-time data, a buy, sell or hold recommendation, or an implied affiliation with the Egyptian Exchange (checked by a content test), and the delayed-data notice appears on every page that mentions data.

Post-release measurements (tracked, not gates, because they depend on third parties and time):

- **SC-009**: Within 30 days of submitting the sitemap, 100% of sitemap pages are indexed by the main search engine and a search for the brand name "EGX MCP" returns the official site first.
- **SC-010**: A fixed set of 20 benchmark questions (English and Arabic, such as "how do I get EGX stock prices in Claude" and "is there an MCP server for the Egyptian Exchange") is asked of at least three major assistants with web access before release and every 30 days after; the share of answers that name or link EGX MCP is recorded, and the target is at least 50% by 90 days.
- **SC-011**: Impressions in search results for non-brand queries grow month over month for the first 3 months, and the site appears for at least 10 of the 20 benchmark queries.
- **SC-012**: Each registry in the listing kit has a recorded status, and every approved submission is live and consistent with the site wording.

## Assumptions

- The site stays on its current free address for now; a custom domain is an owner decision and a cost, so the feature is address-independent (FR-S29) and the plan notes a domain as the largest remaining ranking factor.
- The owner creates and verifies the search engine webmaster accounts and submits the sitemap, and decides which registries to submit to; the feature supplies the files and the listing kit but does not create accounts or submit anything.
- Per-company or per-symbol public pages and live prices on public pages are out of scope: permission to redistribute EGX data has not been granted, and the data is delayed and unofficial. Pages describe what the service can answer, not the answers.
- This feature extends the home page with 5 example questions and a links section (confirmed by the owner, Clarifications 2026-10-31), which reverses part of the earlier decision to remove the example prompts and tool list from the home page (spec 003 FR-H05 and Amendment). The tool list itself lives on its own page; the home page stays short. The plan must record this as an amendment.
- The home connect note (spec 003 FR-H03) changed wording with owner approval on 2026-10-31: "Claude and ChatGPT connect with Google sign-in, Claude Code with either, and Cursor with an API key header. Create your key after signing in." The home Markdown twin follows the same constant.
- Arabic text is written for this feature and reviewed by the owner before release; machine translation alone is not accepted for the Arabic pages.
- The preview image is built from the existing EGX MCP logo (spec 005) and committed as a small image asset.
- Privacy policy and terms keep their content; they gain the page essentials (description, canonical, structured breadcrumb) and appear in the sitemap.
- Free-tier rules stay in force: no paid SEO tool, paid crawler or paid directory placement, and no analytics script that sends visitor data to a third party.
- Only the main public search and AI crawlers named in the plan are listed by name; the list can be extended by editing one place.
- "Recommended by assistants" is treated as a goal measured by SC-010, not as a promise; the feature cannot control what any search engine or assistant outputs.
