# Feature Specification: Home page redesign

**Feature Branch**: `003-home-page` (delivered on `pipeline/claude-home-page`, squash-local) | **Created**: 2026-10-28 | **Status**: Planned

**Input**: Redesign the public home page `GET /` (today `landingView` in `src/http/views.ts`) with these sections in order: hero (product name, one-line value, "Sign in" and "Read the docs" buttons), what you can ask (example prompts for quotes, market overview and indices), connect in 3 steps (sign in, create a key, add the MCP address with an `Authorization: Bearer` header, using the configured public origin), what is covered (only the 5 MVP tools), data sources, a clear notice (delayed, unofficial, not financial advice), and the shared footer (Home, Privacy, Terms). No GitHub link. One shared stylesheet, accessible, light and dark through `prefers-color-scheme`, no external fonts or scripts, CSP unchanged. Out of scope: logo and favicon, the legal pages, the dashboard.

## User Scenarios and Testing

### User Story 1: Understand the product and sign in (Priority: P1)

A visitor opens the home page, understands in one sentence what EGX MCP does, and can sign in.

**Independent Test**: `GET /` returns `200` HTML with the `<h1>` "EGX MCP", the one sentence value line, a single "Sign in" link to `/dashboard`, and the agreement sentence with both policy links. There is no "Read the docs" button.

### User Story 2: Connect an AI client (Priority: P1)

A visitor finds the "Connect your assistant" block with the server URL and the `Authorization: Bearer <your key>` header, each in its own monospace box, and connects Claude (custom connector), Claude Code or Cursor after creating a key.

**Independent Test**: the "Connect your assistant" section shows the MCP address built from the configured public origin (or the request origin when none is configured) and the header line in separate boxes, followed by the one line that names Claude (custom connector, no sign-in, add the header), Claude Code and Cursor.

### User Story 3: Know how reliable the data is (Priority: P2)

A visitor reads one plain notice that the service is independent, that the data is delayed, unofficial and not financial advice, and which sources it uses.

**Independent Test**: the page shows the single notice of FR-H04 and a footer with the privacy policy, terms of use and GitHub links. It lists no tools, examples or separate data source section.

### Edge Cases

- `PUBLIC_ORIGIN` empty (local runs): the MCP address uses the request origin, the same rule the OAuth wrapper in `src/index.ts` uses.
- `PUBLIC_ORIGIN` set but not a valid http or https origin: `GET /` answers `500` with the existing "Something went wrong" page (in production the OAuth wrapper already answers `500` before the route is reached).
- `POST /`: `404` (unchanged).
- Narrow screens (375 px): no horizontal scrolling; the long MCP address wraps.
- Dark system theme: every text, link, button and border keeps WCAG 2.2 AA contrast.

## Requirements

- **FR-H01**: `GET /` MUST return `200` with `HTML_HEADERS` unchanged (CSP `default-src 'self'; frame-ancestors 'none'`, `nosniff`, `same-origin`, `no-store`) and no `set-cookie`. It MUST NOT read D1 or KV; it reads only the configuration.
- **FR-H02 Hero**: `<h1>` "EGX MCP"; one-line value "Ask your AI assistant about Egyptian Exchange stocks and indices, with delayed data through the Model Context Protocol."; a "Sign in" link to `/dashboard` and a "Read the docs" link to `#connect`, both styled as buttons; then the agreement sentence "By signing in you agree to the Terms of use and acknowledge the Privacy policy." (spec 002 FR-L02a) with both linked.
- **FR-H03 What you can ask**: `<h2>` "What you can ask" and these 5 example prompts: "Find the ticker for Talaat Moustafa.", "What is the price of CIB and Talaat Moustafa?", "How is the EGX market doing today?", "What are EGX30 and EGX70 at?", "Give me a summary of the last session."
- **FR-H04 Connect in 3 steps**: `<h2>` "Connect in 3 steps" in a section with `id="connect"`; an ordered list: (1) sign in with Google (link `/dashboard`); (2) create an API key in the dashboard and copy it, it is shown only once; (3) add the server to an MCP client that lets you set a request header, with the server URL `<origin>/mcp` and the header `Authorization: Bearer <your key>`. A note after the list states that Claude.ai and Claude Desktop custom connectors cannot send a header and that sign-in from AI assistants is coming later (same facts as the README).
- **FR-H05 What is covered**: `<h2>` "What is covered" listing exactly `search`, `get_quotes`, `get_market_overview`, `get_indices`, `get_daily_summary` with a one-line summary each, adapted from the registered tool descriptions (exact text in plan.md). The list MUST equal the tools the MCP server registers (guarded by a test).
- **FR-H06 Data sources and notice**: `<h2>` "Data sources" listing every entry of `DATA_SOURCES`, with the sentence that the Egyptian Exchange has not given permission to redistribute the data; `<h2>` "Important notice" with: "Data is delayed, unofficial and informational only.", "It is not real-time and can be late, wrong or missing. Check an official source before acting.", "Nothing here is financial advice or a buy, sell or hold recommendation.", "EGX MCP is not affiliated with, endorsed by or sponsored by the Egyptian Exchange."
- **FR-H07 Footer**: the shared footer from `page()` (Home, Privacy policy, Terms of use). No GitHub or README link anywhere on the page.
- **FR-H08 Accessibility**: one `<h1>`; every content section is a `<section aria-labelledby>` pointing at its `<h2 id>`; the skip link stays; focus outline visible on links and buttons; text and controls meet WCAG 2.2 AA contrast in light and dark; link targets at least 24 by 24 CSS px.
- **FR-H09 Styling**: one stylesheet (`STYLESHEET`, served at `/styles.css`) with colors as custom properties, a `prefers-color-scheme: dark` override and `color-scheme: light dark`; no inline styles, no `<style>`, no `<script>`, no external fonts or files. Layout works at 375, 1024 and 1440 px wide without horizontal scrolling.
- **FR-H10 Contract**: `specs/001-egx-mcp-server/contracts/http-endpoints.md` row `GET /` describes this page.

## Success Criteria

- **SC-H01**: `GET /` answers `200` in the Node-pool unit run with the configured and with the fallback origin.
- **SC-H02**: The home page shows only the sign in button, the connection block and the single notice, and none of the removed sections or the false connector claim (tests fail if they return).
- **SC-H03**: No statement on the home page contradicts the legal pages, the README or the code.
- **SC-H04**: `npm run typecheck` and the Node-pool unit run pass with no failure beyond the 8 known `usage-store` failures.
- **SC-H05**: At 375, 1024 and 1440 px the page has no horizontal scrolling (rendered check, or recorded NOT RENDERED).

## Assumptions

- There is no "Read the docs" button: the connection block is the setup guide, and the old `README_URL` constant (a guessed GitHub address) stays removed.
- "Sign in" points at `/dashboard`, which redirects a signed-out visitor to Google sign-in and shows the dashboard to a signed-in one.
- Client wording: the page names Claude (custom connector, no sign-in, with the `Authorization` request header), Claude Code and Cursor as supported. Claude custom connectors do take a request header, so the earlier claim that they cannot is removed from the page and the README.
- Logo, favicon and dashboard styling are later runs. Dashboard and legal pages change only through the shared stylesheet (colors become custom properties with the same light values).

## Amendment 1: very simple home page

FR-H02 to FR-H07 are replaced by the following. FR-H01 and FR-H08 to FR-H09 stay (FR-H08 applies to the single section, FR-H09 to the new stylesheet tokens).

- **FR-H02 Hero**: `<h1>` "EGX MCP"; one value line "Ask your AI assistant about Egyptian Exchange stocks and indices. Data is delayed."; one "Sign in" link to `/dashboard` styled as a button; then the agreement sentence "By signing in you agree to the Terms of use and acknowledge the Privacy policy." with both linked.
- **FR-H03 Connect block**: a section with `<h2>` "Connect your assistant" and, each in its own monospace box, the server URL `<origin>/mcp` and the header `Authorization: Bearer <your key>`, then one line: "Create your key after signing in. Works in Claude (custom connector, no sign-in, add the header), Claude Code and Cursor."
- **FR-H04 Notice**: one paragraph: "Independent service, not affiliated with the Egyptian Exchange. Data is delayed, unofficial and for information only, not financial advice. Sources: EGX website, TradingView, Mubasher Info, iSagha."
- **FR-H05 Removed**: the example prompts, the three step guide, the tool list, the data sources section, the "Read the docs" button and the claim that Claude custom connectors cannot send a header.
- **FR-H06 Footer**: the shared footer on every page: Home, Privacy policy, Terms of use and GitHub. The GitHub link is the only external link on the home page.
- **FR-H07**: reserved.
