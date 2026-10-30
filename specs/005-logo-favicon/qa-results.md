# QA results: Logo and favicon, Amendment 1 (run 1, 2026-10-31)

Verify: `npm run typecheck` clean; `npm test` 70 files, 1466 tests passed (baseline 1452). Dev server: `npm run dev` (local only), stopped afterwards. Renders: `D:/Work/EGX MCP/.git/pipeline/q09-new-logo/renders/` (Chrome headless via CDP, 3 pages x 375/1024/1440 x light/dark).

| Id | Pri | Type | Result | Evidence | Date |
|---|---|---|---|---|---|
| QA-001 | 1 | automated | PASS | routes.test.ts "serves the EGX MCP artwork at %s" x6 and PNG size cases pass; local curl: all 6 routes 200, SHA-256 identical to assets folder, image/png (ico image/x-icon), max-age=86400, nosniff, no Set-Cookie | 2026-10-31 |
| QA-002 | 1 | automated | PASS | "serves /favicon.ico as a 16, 32 and 48 px icon" passes | 2026-10-31 |
| QA-003 | 2 | automated | PASS | "header logo with an alpha channel" and "apple touch icon without an alpha channel" pass | 2026-10-31 |
| QA-004 | 2 | automated | PASS | POST /favicon.ico, /icon-192.png, /icon-512.png, /logo-96.png 404 tests pass; curl POST /favicon.ico 404 | 2026-10-31 |
| QA-005 | 1 | automated | PASS | views.test.ts header tests and routes tests pass; live HTML header: mark /logo-96.png 48x48 alt="", "EGX MCP", link to /, affiliation | 2026-10-31 |
| QA-006 | 1 | automated | PASS | CSP, no inline style, loads nothing external, hex colors, affiliation once, header row stylesheet tests pass | 2026-10-31 |
| QA-007 | 1 | automated | PASS | server-info.test.ts and server.test.ts pass | 2026-10-31 |
| QA-008 | 2 | automated | PASS | icons.test.ts 2 tests pass | 2026-10-31 |
| QA-009 | 1 | manual | PASS | 375 px, 3 pages, light and dark: mark 48x48 (96 px source), rounded, no square backdrop, name centered beside it, affiliation wraps cleanly below, scrollWidth 375, readable. Focus rule `a:focus-visible` 3px outline in CSS (focus not exercised in a screenshot) | 2026-10-31 |
| QA-010 | 1 | manual | PASS | 1024 px, 3 pages, light and dark: one row aligned to content column, crisp mark, no horizontal overflow (scrollWidth 1009 = viewport minus scrollbar) | 2026-10-31 |
| QA-011 | 1 | manual | PASS | 1440 px, 3 pages, light and dark: as QA-010, centered, no stretch or blur | 2026-10-31 |
| QA-012 | 2 | manual | NOT RUN | Headless render cannot show a tab icon. Done: icon link tags present, /favicon.ico image/x-icon, /icon-512.png image/png locally. Human must look at the tab in a normal Chrome | 2026-10-31 |
| QA-013 | 3 | manual | NOT RUN | No local API key (needs Google sign-in to local D1); QA-007 covers the path | 2026-10-31 |
| QA-014 | 2 | manual (external) | NOT RUN | Needs deploy after user go-ahead | 2026-10-31 |
| QA-015 | 3 | manual (external) | NOT RUN | Needs deployed Worker and an icon-rendering MCP client | 2026-10-31 |
| QA-016 | 3 | manual (external) | NOT RUN | Needs a real iPhone and the deployed site | 2026-10-31 |
| QA-017 | 1 | automated | PASS | typecheck clean; 1466 tests, 0 failures (> 1452) | 2026-10-31 |
| QA-018 | 1 | manual | PASS | git status lists only planned files plus .mcp.json, no .png/.ico/.webp; .mcp.json has only rendobar, type http, url https://api.rendobar.com/mcp, no secret | 2026-10-31 |
