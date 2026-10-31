# QA results: Icon and test cleanup

Run date: 2026-10-31. Workspace D:/Work/EGX MCP, BASE 6683d29.
Full run: `npm run typecheck && npm test` clean; 71 files passed, 1475 tests passed (baseline 70 files, 1466; +9 new).

| id | priority | type | result | evidence | date |
|----|----------|------|--------|----------|------|
| QA-001 | 1 | automated | PASS | `tests/integration/icons.test.ts` has 6 `it.each` cases (all six paths) asserting 200, content-type, ACAO `*`, no set-cookie via `exports.default.fetch` with Origin; suite green | 2026-10-31 |
| QA-002 | 1 | automated | PASS | `tests/unit/routes.test.ts` artwork/size/ICO cases green in full run | 2026-10-31 |
| QA-003 | 1 | automated | PASS | `tests/unit/routes.test.ts` icon header cases green; `src/http/routes.ts` sets nosniff and ACAO `*`; local curl confirmed no CSP/referrer-policy on images | 2026-10-31 |
| QA-004 | 1 | automated | PASS | page, stylesheet, authorize, dashboard, oauth header cases green in full run | 2026-10-31 |
| QA-005 | 2 | automated | PASS | "adds no CORS header to the landing page" asserts 200 and null ACAO; green | 2026-10-31 |
| QA-006 | 1 | automated | PASS | views/routes tests green; `git diff 6683d29 -- tests/helpers/html.ts` is empty | 2026-10-31 |
| QA-007 | 1 | automated | PASS | `tests/unit/icons.test.ts` (`PAGE_ICONS`, `ICONS`, `mcpIcons`) and server-info contract green | 2026-10-31 |
| QA-008 | 2 | manual | PASS | Grep of `src/`: every path and its size only in `src/http/icons.ts` (table rows plus `LEGACY_FAVICON_PATH`, `LOGO_PATH` constants); no hand-written size strings (32x32 etc.) found anywhere in `src/`; icons.ts imports only `@modelcontextprotocol/server` type and `../domain/crypto`, not `./views` | 2026-10-31 |
| QA-009 | 1 | manual | PASS | `from "cloudflare:test"` only in `tests/setup.ts` and `tests/env.d.ts`; `\bSELF\b` no matches | 2026-10-31 |
| QA-010 | 1 | manual | PASS | typecheck clean; 71 files, 1475 tests, 0 failures | 2026-10-31 |
| QA-011 | 2 | manual | PASS | wrangler dev on 8787. `/icon-192.png` and `/favicon.ico`: 200, image/png and image/x-icon, ACAO `*`, `Cache-Control: public, max-age=86400`, nosniff, no CSP. `/`: 200, text/html, CSP `default-src 'self'; frame-ancestors 'none'`, no-store, no ACAO. Dev server stopped, port 8787 free, no workerd left | 2026-10-31 |
| QA-012 | 2 | automated | PASS | POST cases for `/favicon.ico`, `/icon-192.png`, `/icon-512.png`, `/logo-96.png` in `tests/unit/routes.test.ts` (lines ~205-208) green | 2026-10-31 |
| QA-013 | 3 | manual | PASS | local `curl -X OPTIONS` with Origin on `/icon-192.png` returned 404 | 2026-10-31 |
| QA-014 | 3 | manual (external) | NOT RUN | Needs a browser-based MCP client against the deployed Worker after the owner pushes. Human: connect a client to https://egx-mcp.essawy.workers.dev/mcp, confirm the EGX MCP icon shows and the console has no CORS error | 2026-10-31 |
