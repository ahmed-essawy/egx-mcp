# Implementation Plan: Logo and favicon

**Branch**: `005-logo-favicon` (one squash commit from `pipeline/claude-logo-favicon`) | **Date**: 2026-10-28 | **Spec**: [spec.md](spec.md)

## Summary

A new `src/http/icons.ts` holds the three PNGs as base64 constants and exports a path to bytes map. `routes.ts` adds one GET route per map entry that answers `image/png` with a one day cache. `page()` in `views.ts` gains the icon links in the head and a header with the linked logo and the affiliation sentence; the home notice drops that sentence so it appears once.

## Technical Context

- Stack: TypeScript 7.0.2, Cloudflare Workers (wrangler 4.152.0, compatibility date 2026-10-01), vitest 4.1.12. No new dependency, binding, migration, KV or D1 access, no `wrangler.jsonc` change.
- Data access: none. The images are decoded once at module load (about 27 KB of bytes, 36 KB of base64 in the bundle, far under the 3 MB free Worker limit). No query, so no tracking, projection, N+1, pagination or index risk. Free tier: icon requests count as normal Worker requests; the one day `cache-control` lets browsers skip repeats.
- Constitution: no principle touched (no data, no auth change). Principle VI and the data rights section are reinforced by the affiliation sentence.
- Tests (HARD RULES): never run `npm test`, any vitest on the Workers pool, `wrangler dev`, `wrangler deploy` or any Cloudflare call. Verify with `npm run typecheck` and the Node-pool unit run only:
  `node node_modules/vitest/vitest.mjs run --config C:/Users/Essawy/AppData/Local/Temp/claude/D--Work-EGX-MCP/51ec8f53-7b81-47cb-a408-d2a7ead475b8/scratchpad/vitest.unit.logo-favicon.config.mjs --root "D:/Work/egx-mcp.pipeline/logo-favicon"`
- Baseline at BASE aaaee7e (run by the planner): typecheck PASS; Node pool 22 files, 376 tests, 0 failures. `npm test` NOT RUN (forbidden). Any failure counts.
- Writing rules: no em or en dashes, no AI attribution, no comments in code, stage by explicit path, never stage a PNG or `logo.png`.

## Asset storage decision

Base64 string constants in a TypeScript module, decoded with the existing `fromBase64Url` from `src/domain/crypto.ts` (standard base64 has no `-` or `_`, so the helper decodes it unchanged; no second decoder).

Rejected:
- Workers static assets: `wrangler.jsonc` has no `assets` block. Adding one edits a file the concurrent streams share, serves files before the Worker (headers then need a `_headers` file), and `defaultHandler` tests cannot cover it.
- A `Data` module rule for `*.png`: needs a `rules` entry in `wrangler.jsonc`, and the Node-pool test run (Vite) turns a `.png` import into a URL string, not bytes, so tests and the Worker would disagree.

Source images (outside the repo, not committed): `D:/Work/EGX MCP/.git/pipeline/logo-favicon/icons/egx-logo-32.png`, `egx-logo-180.png`, `egx-logo-192.png` (32 and 192 are RGBA with a transparent background; 180 is flattened onto the light page background `#f8fafb` as `egx-logo-180-opaque.png`, 24-bit RGB, because iOS fills transparency with black; the constant uses the opaque file). Generate the constant lines with:

```
node -e "const fs=require('fs');const d=process.argv[1];for(const [n,s] of [['FAVICON_PNG_BASE64',32],['APPLE_TOUCH_ICON_PNG_BASE64',180],['ICON_PNG_BASE64',192]])console.log('const '+n+' = \"'+fs.readFileSync(d+'/egx-logo-'+s+(s===180?'-opaque':'')+'.png').toString('base64')+'\";')" "D:/Work/EGX MCP/.git/pipeline/logo-favicon/icons"
```

## Design (exact)

### `src/http/views.ts`

- Add after `STYLESHEET_PATH`: `export const FAVICON_PATH = "/favicon-32.png";`, `export const ICON_PATH = "/icon-192.png";`, `export const APPLE_TOUCH_ICON_PATH = "/apple-touch-icon.png";`, private `const LOGO_ALT = "EGX MCP home";`, private `const LOGO_SIZE = 48;`, private `const AFFILIATION = "Independent service, not affiliated with the Egyptian Exchange.";`.
- `NOTICE` becomes `"Data is delayed, unofficial and for information only, not financial advice. Sources: EGX website, TradingView, Mubasher Info, iSagha."`.
- `page()` head, between `<title>` and the stylesheet link, adds `${iconLinks()}`; body becomes skip link, `${siteHeader()}`, `<main id="main">`, unchanged rest.
- Private helpers next to `siteFooter()`:
  - `iconLinks()` returns, joined with `\n`:
    `<link rel="icon" type="image/png" sizes="32x32" href="${FAVICON_PATH}">`
    `<link rel="icon" type="image/png" sizes="192x192" href="${ICON_PATH}">`
    `<link rel="apple-touch-icon" sizes="180x180" href="${APPLE_TOUCH_ICON_PATH}">`
  - `siteHeader()` returns
    `<header><a class="brand" href="${HOME_PATH}"><img src="${ICON_PATH}" alt="${LOGO_ALT}" width="${LOGO_SIZE}" height="${LOGO_SIZE}"></a><p class="affiliation">${escapeHtml(AFFILIATION)}</p></header>`
- `STYLESHEET`: change `main, footer {` to `header, main, footer {`; change `.agreement, .notice {` to `.agreement, .notice, .affiliation {`; add after the `footer nav` rule:
  `header { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; padding-bottom: 0; }`
  `.brand img { display: block; }`
  `.affiliation { margin: 0; }`

### `src/http/icons.ts` (new)

```ts
import { fromBase64Url } from "../domain/crypto";
import { APPLE_TOUCH_ICON_PATH, FAVICON_PATH, ICON_PATH } from "./views";

const LEGACY_FAVICON_PATH = "/favicon.ico";
const FAVICON_PNG_BASE64 = "<generated>";
const APPLE_TOUCH_ICON_PNG_BASE64 = "<generated>";
const ICON_PNG_BASE64 = "<generated>";

const FAVICON_PNG = fromBase64Url(FAVICON_PNG_BASE64);

export const ICONS: ReadonlyMap<string, Uint8Array> = new Map([
  [FAVICON_PATH, FAVICON_PNG],
  [LEGACY_FAVICON_PATH, FAVICON_PNG],
  [APPLE_TOUCH_ICON_PATH, fromBase64Url(APPLE_TOUCH_ICON_PNG_BASE64)],
  [ICON_PATH, fromBase64Url(ICON_PNG_BASE64)],
]);
```

### `src/http/routes.ts`

- Constants: `const ICON_CACHE_CONTROL = "public, max-age=86400";`, `const PNG_CONTENT_TYPE = "image/png";`. Import `ICONS` from `./icons`.
- `function iconResponse(body: Uint8Array): Response` returns `new Response(body, { headers: { ...HTML_HEADERS, "content-type": PNG_CONTENT_TYPE, "cache-control": ICON_CACHE_CONTROL } })` (same shape as `stylesheetResponse`).
- `function exactPath(path: string): RegExp` returns `new RegExp(\`^${path.replace(REGEX_METACHARACTERS, "\\$&")}$\`)`, escaping every regex metacharacter through the private constant `const REGEX_METACHARACTERS = /[.*+?^${}()|[\]\\]/g;` in `src/http/routes.ts`.
- `const ICON_ROUTES: Route[] = [...ICONS].map(([path, body]) => ({ method: "GET", pattern: exactPath(path), handler: () => iconResponse(body) }));` declared before `ROUTES`; `ROUTES` spreads `...ICON_ROUTES` right after the `/styles.css` entry.

### Contract

| Method and path | Behavior |
|---|---|
| `GET /favicon-32.png`, `GET /favicon.ico` | 32 px PNG, `image/png`, `public, max-age=86400` |
| `GET /apple-touch-icon.png` | 180 px PNG, same headers |
| `GET /icon-192.png` | 192 px PNG (favicon and header logo), same headers |

`specs/001-egx-mcp-server/contracts/http-endpoints.md` is edited in this run (owner approved): one row for the image routes, and the `GET /` row now says the independence sentence is in the site header.

## Follow-ups

- MCP `serverInfo.icons`: `@modelcontextprotocol/server` 2.3.1 accepts `icons: [{ src, mimeType, sizes }]` and `websiteUrl` on the server implementation info, but `src` must be an absolute URL and `createServer(env, auth)` in `src/mcp/server.ts` has no origin, so it needs the origin threaded from `src/index.ts`, and `src/mcp/server.ts` is in the area the concurrent streams edit. Not in this run.

## Complexity Tracking

None.
