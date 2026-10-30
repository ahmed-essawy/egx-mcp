# QA cases: Logo and favicon, Amendment 1 (EGX MCP logo)

Written from spec.md, Amendment 1, before implementation. Workspace: `D:/Work/EGX MCP`. Assets for comparison: `D:/Work/EGX MCP/.git/pipeline/q09-new-logo/assets`.

How to run the manual cases locally: start the Worker with `npm run dev` (wrangler dev, local simulation only, no `--remote`), open `http://localhost:8787` (the port wrangler prints). Never deploy and never write to the live Worker. If the dev server cannot start, render `landingView`, `privacyView` and `dashboardView` with `STYLESHEET` into a scratch folder with the six images beside the HTML (as spec 003 T007), and record that fallback in the result.

Priority: 1 must pass to deliver, 2 should, 3 nice.

## Cases

### QA-001 Every icon route serves the approved artwork
- Traces to: US1 A1-1, SC-I04, FR-I01
- Type: automated (T006, `tests/unit/routes.test.ts` "serves the EGX MCP artwork at %s" and the PNG size table)
- Priority: 1
- Preconditions and data: T007 done; SHA-256 table in plan.md, Amendment 1.
- Steps: 1. Run `npm test`. 2. Find the artwork and PNG size cases.
- Expected: all pass: `/favicon-32.png`, `/favicon.ico`, `/apple-touch-icon.png`, `/icon-192.png`, `/icon-512.png`, `/logo-96.png` answer 200, bodies hash to the pinned values, PNGs are 32, 180, 192, 512, 96 px with `image/png`, the one day cache and `nosniff`, no cookie.

### QA-002 `/favicon.ico` is a real 16/32/48 icon
- Traces to: US1 A1-2, FR-I01
- Type: automated (T006, "serves /favicon.ico as a 16, 32 and 48 px icon")
- Priority: 1
- Preconditions and data: T007 done.
- Steps: 1. Run `npm test`. 2. Find the ICO case.
- Expected: pass: `content-type: image/x-icon`, ICO header with 3 entries of 16, 32 and 48 px, each a PNG.

### QA-003 Header logo keeps its transparent rounded corners; apple touch icon stays opaque
- Traces to: Edge cases (amended), US1 A1-4
- Type: automated (T006 logo alpha case; existing apple touch colour type case)
- Priority: 2
- Steps: 1. Run `npm test`.
- Expected: `/logo-96.png` has colour type 6 (RGBA); `/apple-touch-icon.png` has colour type 2 (RGB).

### QA-004 Icon routes refuse other methods
- Traces to: Edge cases (amended), FR-I01
- Type: automated (T006, 404 table)
- Priority: 2
- Steps: 1. Run `npm test`.
- Expected: `POST /favicon.ico`, `/icon-192.png`, `/icon-512.png`, `/logo-96.png` answer 404.

### QA-005 Header markup on every page
- Traces to: US1 A1-3, SC-I05, FR-I03
- Type: automated (T008, `tests/unit/views.test.ts` page and dashboard header tests, `tests/unit/routes.test.ts` `/`, `/privacy`, `/terms`)
- Priority: 1
- Steps: 1. Run `npm test`.
- Expected: every page contains exactly the FR-I03 header (mark `/logo-96.png` at 48 by 48 with `alt=""`, text "EGX MCP", one link to `/`, then the affiliation) between the skip link and `<main>`.

### QA-006 No security or notice regression
- Traces to: FR-I05 (unchanged), FR-I04 (unchanged), SC-I05, FR-I10
- Type: automated (existing CSP, inline style, "loads nothing external", hex colors and "states the affiliation once" tests; T008 stylesheet assertions)
- Priority: 1
- Steps: 1. Run `npm test`.
- Expected: CSP stays `default-src 'self'; frame-ancestors 'none'`; no inline style; no `url(` or `@import` in the stylesheet; hex colors only in custom properties; the affiliation sentence appears once on the home page; the stylesheet has the `.brand` flex rule without underline.

### QA-007 MCP `initialize` advertises the icons through the Worker
- Traces to: US3 A3-1, A3-2 (empty `PUBLIC_ORIGIN` falls back to the request origin), SC-I06, FR-I09
- Type: automated (T010, `tests/contract/server-info.test.ts`; `tests/unit/server.test.ts` createServer case)
- Priority: 1
- Preconditions and data: seeded user and API key; test pool `PUBLIC_ORIGIN` is empty; request origin `https://egx.test`.
- Steps: 1. Run `npm test`.
- Expected: `serverInfo` equals `{ name: "egx-mcp", version: "1.0.0", icons: [32, 192, 512 px PNG entries on https://egx.test] }`; the Node-pool `createServer` case returns the icons it was given.

### QA-008 Icon URLs are absolute on the given origin
- Traces to: US3 A3-2, FR-I09
- Type: automated (T010, `tests/unit/icons.test.ts`)
- Priority: 2
- Steps: 1. Run `npm test`.
- Expected: `mcpIcons` returns the three entries with `https://egx.example.com/...` URLs, `image/png` and the right `sizes`, and drops any path on the origin argument.

### QA-009 Header render at 375 px (phone)
- Traces to: US1 A1-4, SC-I07, FR-I10
- Type: manual (local `npm run dev` in a browser via the `run` skill, window or device emulation at 375 px wide; fallback: scratch render)
- Priority: 1
- Preconditions and data: dev server running; pages `/`, `/privacy`, `/terms`; light theme, then dark theme (`prefers-color-scheme: dark` emulation).
- Steps: 1. Open each page at 375 px. 2. Inspect the header. 3. Switch to dark theme and repeat. 4. Tab to the brand link.
- Expected: mark at 48 by 48 with rounded corners and no square background behind it, "EGX MCP" vertically centered beside it, the affiliation on the same row or wrapped cleanly below; no horizontal scroll (`document.documentElement.scrollWidth <= 375`); text readable in both themes; the focus outline is visible around the link.

### QA-010 Header render at 1024 px (laptop)
- Traces to: US1 A1-4, SC-I07, FR-I10
- Type: manual (as QA-009 at 1024 px)
- Priority: 1
- Steps: as QA-009 at 1024 px, light and dark.
- Expected: header aligned to the 38rem content column, mark and name on one row with the affiliation, no horizontal scroll, crisp mark (96 px source at 48 px).

### QA-011 Header render at 1440 px (desktop)
- Traces to: US1 A1-4, SC-I07, FR-I10
- Type: manual (as QA-009 at 1440 px)
- Priority: 1
- Steps: as QA-009 at 1440 px, light and dark.
- Expected: as QA-010; header centered with the content column; no stretched or blurred mark.

### QA-012 Browser tab shows the new favicon
- Traces to: US1 (story), US1 A1-1, A1-2
- Type: manual (local dev server in Chrome)
- Priority: 2
- Steps: 1. Open `http://localhost:8787/` in a fresh profile or after clearing the site cache. 2. Look at the tab icon. 3. Open `http://localhost:8787/favicon.ico` and `http://localhost:8787/icon-512.png` directly. 4. Read the response headers in the network panel.
- Expected: the tab shows the navy and gold EGX MCP mark, not the gate logo; `/favicon.ico` answers `image/x-icon`; `/icon-512.png` shows the 512 px mark as `image/png`.

### QA-013 MCP `initialize` over local HTTP
- Traces to: US3 A3-1, SC-I06
- Type: manual (local dev server, API call)
- Priority: 3
- Preconditions and data: a local API key (local D1 only, created through the local dashboard or the test seed); if none can be made locally, record NOT RUN with that reason (QA-007 covers the same path automatically).
- Steps: 1. `POST http://localhost:8787/mcp` with `Authorization: Bearer <local key>`, `accept: application/json, text/event-stream` and an `initialize` body (protocol `2025-06-18`). 2. Read `result.serverInfo`.
- Expected: `icons` lists `http://localhost:8787/favicon-32.png`, `/icon-192.png`, `/icon-512.png` with sizes and `image/png`; each URL opens the image.

### QA-014 Live site after delivery
- Traces to: US1 (story), SC-I04
- Type: manual (external): needs the push to `main` and the Cloudflare deploy, which happen only after the user's go-ahead
- Priority: 2
- Steps: 1. After deploy, open `https://egx-mcp.essawy.workers.dev/` (read only). 2. Check the tab icon, the header and `/favicon.ico`.
- Expected: the live site shows the new mark and the header as in QA-009 to QA-011.

### QA-015 Assistant shows the server icon
- Traces to: US3 (story)
- Type: manual (external): needs a deployed Worker and an MCP client that renders server icons (for example Claude custom connectors)
- Priority: 3
- Steps: 1. After deploy, add or refresh the connector in a client that shows icons. 2. Look at the connector list.
- Expected: the EGX MCP mark shows for the server; a client that ignores icons still connects and lists tools.

### QA-016 iOS home screen icon
- Traces to: US1 (story), Edge cases (opaque apple touch icon)
- Type: manual (external): needs a real iPhone or iPad and the deployed site
- Priority: 3
- Steps: 1. In Safari, Share, Add to Home Screen. 2. Look at the icon.
- Expected: the navy tile with the gold mark, no black fill.

### QA-017 Full verify with no new failure
- Traces to: SC-I08
- Type: automated (T013, `npm run typecheck`, `npm test`)
- Priority: 1
- Steps: 1. Run `npm run typecheck`. 2. Run `npm test`.
- Expected: typecheck PASS; `npm test` 0 failures, more than the 1452 baseline tests.

### QA-018 Only planned files change; `.mcp.json` is safe to commit
- Traces to: FR-I07 (no image file committed), Input (`.mcp.json` committed with the change)
- Type: manual (`git status --short`, `git diff --stat`, read `.mcp.json`)
- Priority: 1
- Steps: 1. Run `git status --short`. 2. Read `.mcp.json`.
- Expected: only the files listed in tasks.md, Amendment 1 rules, plus `.mcp.json` (and, only if present, the user's own `specs/001-egx-mcp-server/research.md` and `tasks.md`, never staged); no `.png`, `.ico` or `.webp` file; `.mcp.json` holds only the `rendobar` server with `"type": "http"` and `"url": "https://api.rendobar.com/mcp"`, no key or token.

## Coverage

| Spec item | Cases |
|---|---|
| US1 A1-1 | QA-001, QA-012 |
| US1 A1-2 | QA-002, QA-012 |
| US1 A1-3 | QA-005 |
| US1 A1-4 | QA-003, QA-009, QA-010, QA-011 |
| US3 A3-1 | QA-007, QA-013, QA-015 |
| US3 A3-2 | QA-007, QA-008 |
| FR-I01 | QA-001, QA-002, QA-004 |
| FR-I03 | QA-005 |
| FR-I04, FR-I05 (unchanged) | QA-006 |
| FR-I07 | QA-018 |
| FR-I08 (no link for 512 and ICO) | QA-005 (the unchanged `ICON_LINKS` assertion), QA-012 |
| FR-I09 | QA-007, QA-008 |
| FR-I10 | QA-006, QA-009, QA-010, QA-011 |
| Edge cases (amended) | QA-003, QA-004, QA-015, QA-016 |
| SC-I04 | QA-001, QA-014 |
| SC-I05 | QA-005, QA-006 |
| SC-I06 | QA-007, QA-013 |
| SC-I07 | QA-009, QA-010, QA-011 |
| SC-I08 | QA-017 |
| Input: `.mcp.json` | QA-018 |
