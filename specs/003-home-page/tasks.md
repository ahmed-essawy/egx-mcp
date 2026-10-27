# Tasks: Home page redesign

**Input**: [spec.md](spec.md), [plan.md](plan.md). Repo: `D:/Work/egx-mcp.pipeline/home-page` for every task (one repo, so no `[P]`). Order is strict: each test task is written and seen failing before its code task. Commit split: single squash commit.

**HARD RULES (repeat in every implementer and reviewer prompt)**:
- Never run `npm test`, any vitest on the Workers pool, `wrangler dev`, or any Cloudflare call.
- Verify with `npm run typecheck` and the Node-pool unit run only:
  `node node_modules/vitest/vitest.mjs run --config C:/Users/Essawy/AppData/Local/Temp/claude/D--Work-EGX-MCP/83ca69ec-9763-4ab8-bce8-190b3596b11e/scratchpad/vitest.unit.home-page.config.mjs --root "D:/Work/egx-mcp.pipeline/home-page"`
  Baseline: 8 known failures in `tests/unit/usage-store.test.ts`; any other failure is new.
- No em or en dashes anywhere, no AI attribution anywhere, no comments in code, stage by explicit path, never stage the untracked `logo.png` in `D:/Work/EGX MCP`.

## Phase 1: Shared origin rule (US2)

- [x] T001 [US2] Tests in `tests/unit/config.test.ts` (import `resolvePublicOrigin`; reuse the file's `envWith`), new `describe("resolvePublicOrigin")`:
  - `PUBLIC_ORIGIN: ""` with `new Request("https://req.example.com/any")` returns `"https://req.example.com"`.
  - `PUBLIC_ORIGIN: "https://egx.example.com/path"` returns `"https://egx.example.com"`.
  - `PUBLIC_ORIGIN: "ftp://egx.example.com"` returns `null`.
  Acceptance: fails (export missing); all other config tests unchanged.
- [x] T002 [US2] Add `resolvePublicOrigin` to `src/config.ts` and switch `src/index.ts` to it (plan.md Design: delete private `resolveOrigin`, drop unused imports). Do not touch `MCP_ROUTE` yet (T005 moves it). Acceptance: T001 passes; typecheck clean; no other behavior change.

## Phase 2: Home view and stylesheet (US1, US2, US3)

- [x] T003 [US1] Tests in `tests/unit/views.test.ts`. Replace the `landingView` block (drop the `#readme` test) with `const MCP_URL = "https://egx.example.com/mcp"; const html = landingView(MCP_URL);` and:
  - exactly one `<h1`, `<h1 id="hero-title">EGX MCP</h1>`, the value line of FR-H02, `<a class="button button-primary" href="/dashboard">Sign in</a>`, `<a class="button" href="#connect">Read the docs</a>`.
  - keep the existing agreement test (notice after `href="/dashboard"`, both policy links).
  - `<h2>` texts in order equal `["What you can ask", "Connect in 3 steps", "What is covered", "Data sources", "Important notice"]` (regex `/<h2[^>]*>([^<]+)<\/h2>/g`).
  - `<section id="...">` ids in order equal `["examples", "connect", "tools", "sources", "notice"]`; every `aria-labelledby="X"` value has a matching `id="X"` on an `<h1>` or `<h2>`.
  - every `EXAMPLE_PROMPTS` entry appears (escaped with `escapeHtml`).
  - the `connect` section contains an `<ol class="steps">` with exactly 3 `<li>`, `<code>https://egx.example.com/mcp</code>`, `<code>Authorization: Bearer &lt;your key&gt;</code>`, "Claude Code", "Cursor".
  - `landingView('https://x.test/"><script>')` contains no `<script` and contains `&quot;&gt;&lt;script&gt;`.
  - `COVERED_TOOLS.map((tool) => tool.name)` equals `["search", "get_quotes", "get_market_overview", "get_indices", "get_daily_summary"]`; each appears as `<code>name</code>`; for every name in `TOOL_NAMES` (from `src/mcp/tool-names`) not covered, `<code>name</code>` does not appear.
  - every `DATA_SOURCES` entry appears escaped; "has not given permission to redistribute" appears.
  - every `NOTICE_SENTENCES` entry appears inside the `notice` section; the list includes "Data is delayed, unofficial and informational only." and "Nothing here is financial advice or a buy, sell or hold recommendation."
  - no match for `/github/i`, no `#readme`, no `href="http`, no `<script`, no `<style`, no `style=`.
  - `STYLESHEET` block: keep both existing checks; add: contains `color-scheme: light dark` and `@media (prefers-color-scheme: dark)`; contains no `@import` and no `url(`; every match of `/([\w-]+):[^;{}]*#[0-9a-f]{3,8}\b/gi` has a property name starting with `--`.
  - `MCP_PATH === "/mcp"` in the path constants block.
  Acceptance: these fail; the `page`, `consentView`, `dashboardView` blocks still pass.
- [x] T004 [US2] Route and tool drift guard tests:
  - `tests/unit/routes.test.ts`: import `env` from `cloudflare:test`; add `function envWith(origin: string): Env { return { ...env, PUBLIC_ORIGIN: origin } as unknown as Env; }` and let `call` take an optional `bindings: Env = {} as Env`. Replace "serves the landing page as HTML" with: (a) `PUBLIC_ORIGIN "https://egx.configured.test"`: status 200, `content-type` contains `text/html`, CSP `default-src 'self'; frame-ancestors 'none'`, `cache-control` `no-store`, `set-cookie` null, body contains `<code>https://egx.configured.test/mcp</code>`; (b) `PUBLIC_ORIGIN ""`: body contains `<code>https://egx.example.com/mcp</code>`; (c) `PUBLIC_ORIGIN "ftp://egx.example.com"`: status 500. `["POST", "/"]` stays in the 404 table with the empty env.
  - `tests/unit/server.test.ts`: in "advertises tools and lists every registered tool" add `expect(tools.map((tool) => tool.name)).toEqual(COVERED_TOOLS.map((tool) => tool.name));` (import `COVERED_TOOLS` from `../../src/http/views`); keep the literal list.
  Acceptance: routes cases (a) and (b) fail, and `server.test.ts` fails to compile on the missing `COVERED_TOOLS` export.
- [x] T005 [US1] Implement per plan.md Design in one task (the signature change of `landingView` needs all three files together):
  - `src/http/views.ts`: constants, `landingView(serverUrl)`, private helpers `listItems`, `contentSection`, `heroSection`, `examplesSection`, `connectSection`, `toolsSection`, `sourcesSection`, `noticeSection`, the whole `STYLESHEET`, remove `README_URL`.
  - `src/http/routes.ts`: private `landingResponse(request, env)` used by the `/` route.
  - `src/index.ts`: replace `MCP_ROUTE` with the imported `MCP_PATH` and build the resource URL with `mcpUrl(origin)`.
  - `src/http/views.ts` also exports `DASHBOARD_PATH` and `mcpUrl(origin)`; `src/http/dashboard.ts` imports `DASHBOARD_PATH` instead of its private copy; `src/mcp/tools/quotes.ts` exports `MAX_SYMBOLS`, used in the `get_quotes` summary.
  Acceptance: T003 and T004 pass; typecheck clean; full Node-pool run shows only the 8 baseline failures.

## Phase 3: Verify

- [x] T006 Verify: `npm run typecheck` (PASS); Node-pool unit run (only the 8 baseline failures). `npm test` NOT RUN (forbidden). Grep the added lines of the diff: no em dash (U+2014), no en dash (U+2013), no `Co-Authored`, and no comment line in `.ts` files (added lines matching `^\+\s*(//|/\*)`). Confirm `git status` shows only: `src/config.ts`, `src/index.ts`, `src/http/views.ts`, `src/http/routes.ts`, `src/http/dashboard.ts`, `src/mcp/tools/quotes.ts`, `tests/unit/config.test.ts`, `tests/unit/views.test.ts`, `tests/unit/routes.test.ts`, `tests/unit/server.test.ts`, `specs/003-home-page/*`, `specs/001-egx-mcp-server/contracts/http-endpoints.md`.
- [x] T007 Render check (orchestrator or reviewer, not the implementer; scratch files only, nothing in the repo):
  1. Write `C:/Users/Essawy/AppData/Local/Temp/claude/D--Work-EGX-MCP/83ca69ec-9763-4ab8-bce8-190b3596b11e/scratchpad/render-home/entry.ts` that imports `landingView` and `STYLESHEET` from `D:/Work/egx-mcp.pipeline/home-page/src/http/views.ts`, writes `index.html` = `landingView("https://egx-mcp.essawy.workers.dev/mcp")` with `href="/styles.css"` replaced by `href="styles.css"`, and `styles.css` = `STYLESHEET`, into the same folder.
  2. `cd "D:/Work/egx-mcp.pipeline/home-page"; node_modules/.bin/esbuild <entry.ts> --bundle --platform=node --format=esm --outfile=<render-home>/render.mjs; node <render-home>/render.mjs`.
  3. Open `file:///.../render-home/index.html` in Chrome (claude-in-chrome), resize to 375, 1024, 1440 wide; at each, `document.documentElement.scrollWidth <= window.innerWidth` is true and the hero buttons, steps and tool cards are readable. Dark mode: checked from the CSS (T003 test plus contrast table in plan.md).
  4. If Chrome tools are unavailable, record 375, 1024 and 1440 as NOT RENDERED. Delete `render-home` afterwards.
