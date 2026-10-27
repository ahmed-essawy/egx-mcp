# Implementation Plan: Home page redesign

**Branch**: `003-home-page` (delivered as one squash commit from `pipeline/claude-home-page`) | **Date**: 2026-10-28 | **Spec**: [spec.md](spec.md)

## Summary

`landingView` becomes `landingView(serverUrl: string)` and renders six sections (hero, examples, connect, tools, sources, notice) from constants in `src/http/views.ts`; the footer stays in `page()`. The `GET /` route builds the server URL with the exported `mcpUrl(origin)` from a new shared `resolvePublicOrigin(request, env)` in `src/config.ts`, which replaces the private copy in `src/index.ts`. `STYLESHEET` moves its colors to custom properties with a `prefers-color-scheme: dark` override and gains the hero, button, list, tools grid and notice rules.

## Technical Context

- Stack: TypeScript 7.0.2, Cloudflare Workers, vitest 4.1.12. No new dependency, binding, migration, KV or D1 access.
- Data access: none. `loadConfig` is cached per `env` (WeakMap), so the route adds no I/O. No query, so no tracking, projection, N+1, pagination or index risk.
- Tests (HARD RULES): never run `npm test`, any vitest on the Workers pool, `wrangler dev` or any Cloudflare call. Node-pool unit run only:
  `node node_modules/vitest/vitest.mjs run --config C:/Users/Essawy/AppData/Local/Temp/claude/D--Work-EGX-MCP/83ca69ec-9763-4ab8-bce8-190b3596b11e/scratchpad/vitest.unit.home-page.config.mjs --root "D:/Work/egx-mcp.pipeline/home-page"`
  (the config copy and its shim `cftest-shim.home-page.mjs` already point at this worktree; the shim sets `PUBLIC_ORIGIN` to `""`). Plus `npm run typecheck`.
- Baseline at BASE aff0f69 (run by the planner): typecheck PASS; Node pool 263 pass, 8 fail, all in `tests/unit/usage-store.test.ts` (Workers-only D1). `npm test` (Workers pool): NOT RUN (forbidden). Only failures beyond those 8 count.
- Writing rules: no em or en dashes, no AI attribution, no comments in code, stage by explicit path, never stage `logo.png`.

## Design (exact)

### `src/config.ts`

Add after `parseOrigin`:

```ts
export function resolvePublicOrigin(request: Request, env: Env): string | null {
  const configured = loadConfig(env).publicOrigin;
  return configured === "" ? new URL(request.url).origin : parseOrigin(configured);
}
```

### `src/index.ts`

Delete the private `resolveOrigin` and the `MCP_ROUTE` constant. Import `resolvePublicOrigin` from `./config` (drop the now unused `loadConfig`, `parseOrigin` imports) and `MCP_PATH` from `./http/views`. `providerFor` calls `resolvePublicOrigin(request, env)`; `createProvider` uses `MCP_PATH` for `apiRoute` and `mcpUrl(origin)` (exported from `views.ts`, also used by the `/` route). Behavior identical.

### `src/http/views.ts`

- Remove `README_URL`. Add `export const MCP_PATH = "/mcp";`, `export const DASHBOARD_PATH = "/dashboard";` (the private copy in `dashboard.ts` is deleted and imported from `views.ts`), private, `const CONNECT_ID = "connect";`, `const BEARER_HEADER = "Authorization: Bearer <your key>";`, `const PRODUCT_NAME = "EGX MCP";`, `const VALUE_LINE = "Ask your AI assistant about Egyptian Exchange stocks and indices, with delayed data through the Model Context Protocol.";`. `DISCLAIMER` stays (consent uses it).
- `import type { ToolName } from "../mcp/tool-names";`
- `export const EXAMPLE_PROMPTS = [ "Find the ticker for Talaat Moustafa.", "What is the price of CIB and Talaat Moustafa?", "How is the EGX market doing today?", "What are EGX30 and EGX70 at?", "Give me a summary of the last session." ];`
- `export const COVERED_TOOLS: { name: ToolName; summary: string }[]` in this order:
  - `search`: "Find Egyptian stocks by ticker, ISIN, or Arabic or English name. Mutual funds are coming later."
  - `get_quotes`: "Delayed quotes for up to {MAX_SYMBOLS} Egyptian stocks by ticker, ISIN, or Arabic or English name." (`MAX_SYMBOLS` exported from `src/mcp/tools/quotes.ts` and interpolated)
  - `get_market_overview`: "The delayed EGX market overview: indices, breadth, top movers, most active stocks and totals."
  - `get_indices`: "Delayed EGX index values by name or code."
  - `get_daily_summary`: "A summary of the last completed session: indices, breadth, top movers and totals."
- `export const NOTICE_SENTENCES = [DISCLAIMER, "It is not real-time and can be late, wrong or missing. Check an official source before acting.", "Nothing here is financial advice or a buy, sell or hold recommendation.", "EGX MCP is not affiliated with, endorsed by or sponsored by the Egyptian Exchange."];`
- `landingView(serverUrl: string): string` returns `page(PRODUCT_NAME, [heroSection(), examplesSection(), connectSection(serverUrl), toolsSection(), sourcesSection(), noticeSection()].join("\n"))`.
- Private helpers (each one job):
  - `listItems(items: string[]): string` returns `items.map((item) => \`<li>${escapeHtml(item)}</li>\`).join("\n")`.
  - `contentSection(id: string, title: string, bodyHtml: string): string` returns
    `<section id="${id}" aria-labelledby="${id}-title">\n<h2 id="${id}-title">${title}</h2>\n${bodyHtml}\n</section>`.
  - `heroSection()`: `<section class="hero" aria-labelledby="hero-title">\n<h1 id="hero-title">EGX MCP</h1>\n<p class="lead">${VALUE_LINE}</p>\n<p class="actions"><a class="button button-primary" href="/dashboard">Sign in</a> <a class="button" href="#connect">Read the docs</a></p>\n${agreementNotice("signing in")}\n</section>` (hrefs from `DASHBOARD_PATH` and `CONNECT_ID`, text from the constants, escaped).
  - `examplesSection()`: `contentSection("examples", "What you can ask", \`<ul class="examples">\n${listItems(EXAMPLE_PROMPTS)}\n</ul>\`)`.
  - `connectSection(serverUrl)`: `contentSection(CONNECT_ID, "Connect in 3 steps", ...)` with
    `<ol class="steps">`
    `<li><a href="/dashboard">Sign in</a> with your Google account.</li>`
    `<li>Create an API key in the dashboard and copy it. It is shown only once.</li>`
    `<li>Add the server to an MCP client that lets you set a request header, such as Claude Code or Cursor.<br>Server URL: <code>${escapeHtml(serverUrl)}</code><br>Header: <code>${escapeHtml(BEARER_HEADER)}</code></li>`
    `</ol>`
    `<p>Claude.ai and Claude Desktop custom connectors cannot send a header. Sign-in from AI assistants is coming later.</p>`
  - `toolsSection()`: `contentSection("tools", "What is covered", ...)` with `<p>This build has these ${COVERED_TOOLS.length} tools.</p>` then `<ul class="tools">` and one `<li><code>${tool.name}</code> ${escapeHtml(tool.summary)}</li>` per tool.
  - `sourcesSection()`: `contentSection("sources", "Data sources", ...)` with `<p>Data comes, or will come, from these free public sources. The Egyptian Exchange has not given permission to redistribute it.</p>` and `<ul>\n${listItems(DATA_SOURCES)}\n</ul>`.
  - `noticeSection()`: `contentSection("notice", "Important notice", NOTICE_SENTENCES.map((sentence) => \`<p>${escapeHtml(sentence)}</p>\`).join("\n"))`; the notice box style targets `#notice`.
- `STYLESHEET` (whole value, replacing today's):

```css
:root { color-scheme: light dark; --text: #1a1a1a; --background: #ffffff; --surface: #f2f4f7; --border: #767676; --link: #0b4f9c; --on-link: #ffffff; --error: #9b1c1c; }
@media (prefers-color-scheme: dark) { :root { --text: #e8e8e8; --background: #121212; --surface: #1e2329; --border: #8a8a8a; --link: #8ab4f8; --on-link: #121212; --error: #ff8a80; } }
body { font-family: system-ui, sans-serif; line-height: 1.5; margin: 0; color: var(--text); background: var(--background); }
main, footer { max-width: 48rem; margin: 0 auto; padding: 1rem; }
footer { border-top: 1px solid var(--border); }
footer nav { display: flex; flex-wrap: wrap; gap: 1rem; }
a { color: var(--link); }
.skip-link { position: absolute; left: -999px; }
.skip-link:focus { left: 1rem; top: 1rem; background: var(--background); padding: 0.5rem; }
a:focus-visible, button:focus-visible, input:focus-visible { outline: 3px solid var(--link); outline-offset: 2px; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid var(--border); }
.error { color: var(--error); }
#new-key { width: 100%; font-family: monospace; }
code { font-family: monospace; overflow-wrap: anywhere; }
.hero, section[id] { margin-block: 2rem; }
.hero h1 { font-size: 2.5rem; line-height: 1.2; margin-block: 1rem; }
.lead { font-size: 1.25rem; }
.actions { display: flex; flex-wrap: wrap; gap: 0.75rem; }
.button { display: inline-block; padding: 0.75rem 1.25rem; border: 2px solid var(--link); border-radius: 0.5rem; font-weight: 600; text-decoration: none; }
.button-primary { background: var(--link); color: var(--on-link); }
.steps li, .examples li { margin-block: 0.5rem; }
.tools { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: 1rem; padding: 0; list-style: none; }
.tools li { padding: 1rem; border: 1px solid var(--border); border-radius: 0.5rem; }
#notice { padding: 1rem; border-left: 4px solid var(--link); background: var(--surface); }
```

  Contrast (WCAG 2.2 AA, computed by the planner): light text 17.4:1 on white, 15.8:1 on surface, link 8.0:1, link on surface 7.3:1, button text 8.0:1, error 8.2:1, border 4.5:1; dark text 15.3:1, 12.9:1 on surface, link 8.9:1, link on surface 7.5:1, button text 8.9:1, error 8.2:1, border 5.4:1. Light values equal today's. The `footer nav` flex rule is a shared-footer change: it applies on every page, including the dashboard and legal pages. Section margins are limited to the home page (`.hero`, `section[id]`).

### `src/http/routes.ts`

Add private `landingResponse(request: Request, env: Env): Response`: `const origin = resolvePublicOrigin(request, env); if (origin === null) return internalErrorResponse(); return htmlResponse(landingView(mcpUrl(origin)), STATUS_OK);`. The `/` route uses `handler: landingResponse`. Imports: `resolvePublicOrigin` from `../config`, `mcpUrl` from `./views`.

### `specs/001-egx-mcp-server/contracts/http-endpoints.md`

Row `GET /` amended by the planner in this plan run (already in the diff).

## Render check (FR-H09, SC-H05)

`wrangler dev` is forbidden. Safe local render (no Worker, no Cloudflare): bundle a scratch entry with the repo's esbuild into the scratchpad, write `index.html` (stylesheet href rewritten to `styles.css`) and `styles.css`, open the file in Chrome through the claude-in-chrome tools at 375, 1024 and 1440 px, and check `document.documentElement.scrollWidth <= window.innerWidth`. Dark mode is checked from the CSS only. If Chrome tools are not available, record all three widths as NOT RENDERED. Exact steps in tasks.md T007.

## Constitution Check (2.1.0)

| Principle | Result |
|---|---|
| I Honest delayed data | Value line and notice say delayed; no real-time claim. PASS |
| II Cache-only reads | No upstream or storage read. PASS |
| III Data integrity | Not touched. PASS |
| IV Zero cost | One cheap route, no storage. PASS |
| V Secure access | Same headers and CSP, no script, no cookies, URL escaped. PASS |
| VI Informational scope | Notice states no advice and no buy, sell or hold. PASS |
| Workflow | Traces to spec 003; tests first; README unchanged and still names every source. PASS |

## Analysis

- A1 (resolved): the old page links a guessed GitHub README; the owner says the URL is unknown. Removed; "Read the docs" targets `#connect`.
- A2 (resolved): origin logic existed only privately in `src/index.ts`; moved to `config.ts` and shared, so the home page and the OAuth resource use the same rule.
- A3 (resolved): owner asked for "Claude, ChatGPT or Cursor"; Claude.ai and Desktop connectors take no headers (README). Page names Claude Code and Cursor and states the limit.
- A4 (resolved): the 001 contract row `GET /` mentioned a README link; amended.
- A5 (resolved): `routes.test.ts` calls `/` with `{} as Env`; the route now reads config, so the `/` tests pass a full env built from `cloudflare:test`.
- No Critical, High or Medium issue open.

## Deviations noted

- `src/http/legal.ts` has its own private `section` helper with a different shape (no `id` on `<section>`, paragraphs only). Kept separate; merging both is a later cleanup (one shared helper in `views.ts`, about 15 lines).
- `LANDING_PATH` in `dashboard.ts` duplicates `HOME_PATH`; out of scope, unchanged.

## Amendment 1: very simple home page

The owner asked for a much simpler page. `landingView(serverUrl)` now renders only the product name, one sentence, one Sign in button with the terms and privacy agreement line, a "Connect your assistant" block (server URL and Authorization header in monospace boxes with one note), one independence and data notice, and a footer with the privacy policy, terms and GitHub. The examples, three step guide, tool list and data source sections, the "Read the docs" button and `EXAMPLE_PROMPTS`, `COVERED_TOOLS`, `NOTICE_SENTENCES` are removed, with the `MAX_SYMBOLS` export. The false claim that Claude custom connectors cannot send a header is removed: Claude custom connectors take a request header and are named as supported. The stylesheet takes the new tokens (lapis accent, 38rem column, serif title and sentence, system fonts only). The shared footer gains the GitHub link on every page. The sign-in agreement keeps the shared sentence ("agree to the Terms of use and acknowledge the Privacy policy") so the home, consent and legal pages stay consistent.
