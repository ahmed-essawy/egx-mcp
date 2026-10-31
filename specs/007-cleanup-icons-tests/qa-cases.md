# QA cases: Icon and test cleanup

Written from spec.md before implementation. Workspace: `D:/Work/EGX MCP`. Priority: 1 must pass to deliver, 2 should, 3 nice.

Local manual runs: start the Worker with `npm run dev` (wrangler dev, local simulation only, never `--remote`), use the port wrangler prints (default 8787), and stop the dev server when done (a leftover one locks `node_modules`). Never deploy and never call the live Worker with a write.

## Cases

### QA-001 Other origins can read every icon through the full Worker
- Traces to: US1 A1, US1 A2, FR-005, SC-001
- Type: automated (T004, `tests/integration/icons.test.ts` "lets other origins read %s through the full Worker")
- Priority: 1
- Preconditions and data: T005 done. Origin `https://client.example`.
- Steps: 1. Run `npm test`. 2. Find the six `icons.test.ts` cases.
- Expected: all pass: `/favicon-32.png`, `/favicon.ico`, `/apple-touch-icon.png`, `/icon-192.png`, `/icon-512.png`, `/logo-96.png` answer 200 with their type, `access-control-allow-origin: *`, no cookie.

### QA-002 Icon bytes are unchanged
- Traces to: US1 A1, FR-007, SC-001
- Type: automated (existing `tests/unit/routes.test.ts` "serves the EGX MCP artwork at %s", PNG size table, ICO case; kept green by T003 and T005)
- Priority: 1
- Preconditions and data: SHA-256 values pinned in `ARTWORK_SHA256` (same as spec 005).
- Steps: 1. Run `npm test`. 2. Find the artwork cases.
- Expected: all six hashes match; PNG sizes 32, 180, 192, 512, 96; ICO has 16, 32, 48.

### QA-003 Icon responses carry exactly the image headers
- Traces to: US2 A1, FR-004, SC-002
- Type: automated (T004, `tests/unit/routes.test.ts` PNG `it.each` and ICO case)
- Priority: 1
- Preconditions and data: T005 done.
- Steps: 1. Run `npm test`. 2. Find the icon header cases.
- Expected: pass: `content-type` per image, `cache-control: public, max-age=86400`, `x-content-type-options: nosniff`, `access-control-allow-origin: *`; `content-security-policy` and `referrer-policy` absent; no cookie.

### QA-004 HTML pages and the stylesheet keep their headers
- Traces to: US2 A2, FR-006, SC-002
- Type: automated (T004 stylesheet assertions; existing landing, privacy, terms, consent and dashboard header cases in `tests/unit/routes.test.ts`, `tests/unit/authorize.test.ts`, `tests/unit/dashboard.test.ts`, `tests/integration/oauth.test.ts`)
- Priority: 1
- Steps: 1. Run `npm test`.
- Expected: pages keep `content-security-policy: default-src 'self'; frame-ancestors 'none'` and `cache-control: no-store`; the stylesheet keeps that CSP and `cache-control: public, max-age=300`, with no `access-control-allow-origin`.

### QA-005 CORS is limited to the images
- Traces to: FR-005
- Type: automated (T004, `tests/integration/icons.test.ts` "adds no CORS header to the landing page")
- Priority: 2
- Steps: 1. Run `npm test`.
- Expected: `GET /` with an `Origin` header answers 200 without `access-control-allow-origin`.

### QA-006 Page head icon links are byte identical
- Traces to: US3 A1, FR-002, SC-003
- Type: automated (existing `tests/unit/views.test.ts` `ICON_LINKS` checks and `tests/unit/routes.test.ts` landing case; `ICON_LINKS` in `tests/helpers/html.ts` must not change)
- Priority: 1
- Steps: 1. Run `npm test`. 2. Confirm `git diff 6683d29 -- tests/helpers/html.ts` is empty.
- Expected: pass; the helper is unchanged; head holds the 32, 192 and 180 links in that order, the apple touch link without `type`.

### QA-007 MCP icon list is value identical
- Traces to: US3 A2, FR-003, SC-003
- Type: automated (existing `tests/unit/icons.test.ts` `mcpIcons` cases, `tests/contract/server-info.test.ts`; T002 `PAGE_ICONS` and `ICONS` cases)
- Priority: 1
- Steps: 1. Run `npm test`.
- Expected: `mcpIcons("https://egx.example.com")` equals the 32, 192, 512 PNG entries as before; `serverInfo.icons` matches; `PAGE_ICONS` and the `ICONS` type map match T002.

### QA-008 One table holds each icon's path, size and type
- Traces to: US3 independent test, FR-001, SC-004
- Type: manual (source inspection)
- Priority: 2
- Steps: 1. Grep `src/` for `favicon-32.png|icon-192.png|icon-512.png|apple-touch-icon.png|logo-96.png|favicon.ico`. 2. Grep `src/` for `32x32|192x192|180x180|512x512`. 3. Open `src/http/icons.ts` and `src/http/views.ts` around the table and `iconLinks`.
- Expected: every path appears only in `src/http/icons.ts` (one table row or one constant used by a row); no size string is written by hand; `iconLinks()` and `mcpIcons()` both read the table; `src/http/icons.ts` does not import `./views`.

### QA-009 No deprecated test imports remain
- Traces to: US4 A1, FR-008, SC-005
- Type: manual (Grep over `tests/`)
- Priority: 1
- Steps: 1. Grep `tests/` for `from "cloudflare:test"`. 2. Grep `tests/` for `\bSELF\b`.
- Expected: step 1 only finds `tests/setup.ts` (`applyD1Migrations`) and `tests/env.d.ts` (`D1Migration` type); step 2 finds nothing.

### QA-010 Full suite passes with no test removed
- Traces to: US4 A2, SC-005
- Type: manual (run `npm run typecheck; npm test` in the workspace)
- Priority: 1
- Steps: 1. Run typecheck. 2. Run the suite. 3. Compare with the baseline (70 files, 1466 tests).
- Expected: typecheck clean; 0 failures; at least 71 files and 1466 plus the new tests (T002 and T004) pass.

### QA-011 A real client request sees the header (local Worker)
- Traces to: US1 A2, FR-004, FR-005
- Type: manual (wrangler dev and an HTTP call)
- Priority: 2
- Preconditions and data: `npm run dev` running locally.
- Steps: 1. `curl -s -D - -o NUL -H "Origin: https://client.example" http://localhost:8787/icon-192.png`. 2. Repeat for `/favicon.ico`. 3. `curl -s -D - -o NUL -H "Origin: https://client.example" http://localhost:8787/`. 4. Stop the dev server.
- Expected: steps 1 and 2 show 200, the image type, `access-control-allow-origin: *`, `x-content-type-options: nosniff`, the one day cache and no `content-security-policy`; step 3 shows the HTML CSP and no `access-control-allow-origin`.

### QA-012 Icon routes stay GET only
- Traces to: Edge cases (POST)
- Type: automated (existing `tests/unit/routes.test.ts` POST cases lines 190 to 196)
- Priority: 2
- Steps: 1. Run `npm test`.
- Expected: `POST` to `/favicon.ico`, `/icon-192.png`, `/icon-512.png`, `/logo-96.png` answers 404.

### QA-013 OPTIONS on an icon is unchanged
- Traces to: Edge cases (OPTIONS)
- Type: manual (wrangler dev and an HTTP call, compared with BASE behavior from the code: no OPTIONS route, so 404)
- Priority: 3
- Steps: 1. `curl -s -o NUL -w "%{http_code}" -X OPTIONS -H "Origin: https://client.example" http://localhost:8787/icon-192.png`.
- Expected: 404, as before (no preflight route added).

### QA-014 A web MCP client shows the server icon
- Traces to: US1 (user value)
- Type: manual (external): needs a browser-based MCP client connected to the live Worker after deploy, which this run cannot do before the owner pushes.
- Priority: 3
- Steps: 1. After the owner deploys, connect a browser-based MCP client to `https://egx-mcp.essawy.workers.dev/mcp`. 2. Look at the server entry.
- Expected: the EGX MCP icon shows; the browser console shows no CORS error for the icon URL.

## Coverage

| Spec item | Cases |
|-----------|-------|
| US1 A1 | QA-001, QA-002 |
| US1 A2 | QA-001, QA-011, QA-014 |
| US2 A1 | QA-003 |
| US2 A2 | QA-004 |
| US3 A1 | QA-006 |
| US3 A2 | QA-007 |
| US4 A1 | QA-009 |
| US4 A2 | QA-010 |
| Edge: POST | QA-012 |
| Edge: OPTIONS | QA-013 |
| Edge: favicon.ico, logo | QA-001, QA-002, QA-003 |
| Edge: OAuth provider keeps the header | QA-001, QA-011 |
| FR-001 | QA-008 |
| FR-002 | QA-006 |
| FR-003 | QA-007 |
| FR-004 | QA-003, QA-011 |
| FR-005 | QA-001, QA-005, QA-011 |
| FR-006 | QA-004 |
| FR-007 | QA-002 |
| FR-008 | QA-009, QA-010 |
| SC-001 | QA-001, QA-002 |
| SC-002 | QA-003, QA-004 |
| SC-003 | QA-006, QA-007 |
| SC-004 | QA-008 |
| SC-005 | QA-009, QA-010 |
