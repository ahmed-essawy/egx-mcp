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

## Amendment 1 (2026-10-31): EGX MCP logo

### Summary

`src/http/icons.ts` swaps its three base64 constants for the approved EGX MCP assets and adds three (favicon ICO, 512 px icon, 96 px header logo); its map now carries a content type per path so `/favicon.ico` answers as `image/x-icon`. The header shows the 96 px rounded logo at 48 px with "EGX MCP" as link text. A new `mcpIcons(origin)` builds the MCP `serverInfo.icons`; `oauthOptions(origin)` passes them through the API handler into `createServer`, so the MCP layer gains no import of the HTTP layer.

### Technical context

- Stack and versions: as above, plus `@modelcontextprotocol/server` 2.3.1 (the `McpServer` used by `src/mcp/server.ts`) and `agents` 0.30.1 (`createMcpHandler` only). Checked in `node_modules`: `ImplementationSchema` in `@modelcontextprotocol/core` 2.3.1 has `icons: { src, mimeType?, sizes?: string[], theme? }[]` and `websiteUrl`; the type `Icon` is exported from `@modelcontextprotocol/server`; `Server` answers `initialize` with `serverInfo: this._serverInfo` unchanged. `agents` 0.30.1 depends on that same 2.3.1 package and only wraps the transport. So `icons` is supported; no upgrade needed.
- Data access: none. No query, so no tracking, projection, N+1, pagination or index risk. No D1, KV, migration, binding or `wrangler.jsonc` change.
- Constitution: no principle touched. Principle IV (zero cost): icon requests stay ordinary Worker requests with a one day browser cache, as today. Principle V: `.mcp.json` holds only a public URL, no secret.
- Tests: `tests: required`; profile verify is `npm run typecheck; npm test` (the spec 005 rule against `npm test` is superseded by the current profile). Baseline at b143e4b (planner, with the user's uncommitted doc edits in `specs/001-egx-mcp-server/research.md` and `tasks.md`, and the untracked `.mcp.json`): typecheck PASS; `npm test` 68 files, 1452 tests, 0 failures. NOT RUN: none.
- Writing rules: no em or en dashes, no AI attribution, no comments in code, stage by explicit path, never stage an image file.

### Payload and storage decision

| Asset | Bytes | Base64 chars |
|---|---|---|
| favicon-32.png | 1,294 | 1,728 |
| favicon.ico (16/32/48, PNG entries) | 4,257 | 5,676 |
| apple-touch-icon.png (180) | 19,573 | 26,100 |
| icon-192.png | 21,596 | 28,796 |
| icon-512.png | 63,538 | 84,720 |
| logo-96.png | 7,600 | 10,136 |
| Total | 117,858 | 157,156 |

`src/http/icons.ts` grows from about 35 KB to about 158 KB of source; the decoded bytes are about 118 KB of Worker memory, decoded once per isolate at module load (`atob` plus one `Uint8Array.from` per image, a few milliseconds at most). PNG data does not compress further, so the gzipped bundle grows by roughly 120 KB, about 4 percent of the 3 MB free plan limit. The 512 px icon is 54 percent of the total; it is still small.

Embedding stays. Workers static assets would take icon requests off the Worker request quota, but the reasons recorded above still hold (a new `assets` block in `wrangler.jsonc`, headers moved to a `_headers` file, routes no longer covered by `defaultHandler` tests, and asset routing in front of the OAuth provider), and with the one day cache the icon traffic is negligible. Revisit only if the bundle passes about 1 MB or icon requests become a visible share of the daily request quota.

Generate the six constant lines (they replace the existing three):

```
node -e "const fs=require('fs');const d=process.argv[1];for(const [n,f] of [['FAVICON_PNG_BASE64','favicon-32.png'],['FAVICON_ICO_BASE64','favicon.ico'],['APPLE_TOUCH_ICON_PNG_BASE64','apple-touch-icon.png'],['ICON_PNG_BASE64','icon-192.png'],['LARGE_ICON_PNG_BASE64','icon-512.png'],['LOGO_PNG_BASE64','logo-96.png']])console.log('const '+n+' = \"'+fs.readFileSync(d+'/'+f).toString('base64')+'\";')" "D:/Work/EGX MCP/.git/pipeline/q09-new-logo/assets"
```

SHA-256 of the approved assets (the tests pin these):

| Path | SHA-256 |
|---|---|
| `/favicon-32.png` | `cc1d8ddd4f29bc85c4d22bb1f49b119140da17f4b05c73b8c6d47a5f3b1e23f9` |
| `/favicon.ico` | `27a5c823e0747a48299c28c2129b69935e238bb7dd924597eab0d7506e45aad1` |
| `/apple-touch-icon.png` | `70044c4bc2209e2110f6ec939d70e9668b80793caba67de22c6adc8aa5cdaf84` |
| `/icon-192.png` | `915a64bc304b1ed48cde32a7dfd975f48198199dc227677863d1549d3809b2cd` |
| `/icon-512.png` | `4c841d3a7e48a2ac241c16a36653330c080d0b3ecfdc1ed817249e7f0cf0d650` |
| `/logo-96.png` | `30430d7bc7b2703561d8b001d2226ac73ce1ce849b91e0b41e9d6c1c18c537f6` |

Asset facts (checked): the 32, 180, 192 and 512 PNGs are 8-bit RGB (colour type 2, opaque navy tile); `logo-96.png` is 8-bit RGBA (colour type 6, transparent rounded corners); `favicon.ico` has 3 entries (16, 32, 48 px, 32 bpp, each a PNG).

### Design (exact)

#### `src/http/views.ts`

- After `APPLE_TOUCH_ICON_PATH` add `export const LARGE_ICON_PATH = "/icon-512.png";` and `export const LOGO_PATH = "/logo-96.png";`.
- Remove `const LOGO_ALT = "EGX MCP home";` (no longer used).
- `siteHeader()` returns
  `<header><a class="brand" href="${HOME_PATH}"><img src="${LOGO_PATH}" alt="" width="${LOGO_SIZE}" height="${LOGO_SIZE}">${escapeHtml(PRODUCT_NAME)}</a><p class="affiliation">${escapeHtml(AFFILIATION)}</p></header>`
- `STYLESHEET`: insert, directly before `.brand img { display: block; }`:
  `.brand { display: flex; align-items: center; gap: 0.5rem; color: var(--text); font-weight: 600; font-size: 1.125rem; text-decoration: none; }`
- `iconLinks()` and `HTML_HEADERS` unchanged.

#### `src/http/icons.ts` (rewritten)

```ts
import type { Icon } from "@modelcontextprotocol/server";
import { fromBase64Url } from "../domain/crypto";
import { APPLE_TOUCH_ICON_PATH, FAVICON_PATH, ICON_PATH, LARGE_ICON_PATH, LOGO_PATH } from "./views";

export type IconAsset = { body: Uint8Array; contentType: string };

const LEGACY_FAVICON_PATH = "/favicon.ico";
const PNG_CONTENT_TYPE = "image/png";
const ICO_CONTENT_TYPE = "image/x-icon";
const FAVICON_PNG_BASE64 = "<generated>";
const FAVICON_ICO_BASE64 = "<generated>";
const APPLE_TOUCH_ICON_PNG_BASE64 = "<generated>";
const ICON_PNG_BASE64 = "<generated>";
const LARGE_ICON_PNG_BASE64 = "<generated>";
const LOGO_PNG_BASE64 = "<generated>";
const MCP_ICON_SIZES: ReadonlyArray<readonly [string, number]> = [
  [FAVICON_PATH, 32],
  [ICON_PATH, 192],
  [LARGE_ICON_PATH, 512],
];

function pngAsset(base64: string): IconAsset {
  return { body: fromBase64Url(base64), contentType: PNG_CONTENT_TYPE };
}

export const ICONS: ReadonlyMap<string, IconAsset> = new Map([
  [FAVICON_PATH, pngAsset(FAVICON_PNG_BASE64)],
  [LEGACY_FAVICON_PATH, { body: fromBase64Url(FAVICON_ICO_BASE64), contentType: ICO_CONTENT_TYPE }],
  [APPLE_TOUCH_ICON_PATH, pngAsset(APPLE_TOUCH_ICON_PNG_BASE64)],
  [ICON_PATH, pngAsset(ICON_PNG_BASE64)],
  [LARGE_ICON_PATH, pngAsset(LARGE_ICON_PNG_BASE64)],
  [LOGO_PATH, pngAsset(LOGO_PNG_BASE64)],
]);

export function mcpIcons(origin: string): Icon[] {
  return MCP_ICON_SIZES.map(([path, size]) => ({
    src: new URL(path, origin).href,
    mimeType: PNG_CONTENT_TYPE,
    sizes: [`${size}x${size}`],
  }));
}
```

#### `src/http/routes.ts`

- Import `ICONS, type IconAsset` from `./icons`. Remove the local `PNG_CONTENT_TYPE` constant (moved to `icons.ts`).
- `iconResponse(icon: IconAsset): Response` returns `new Response(icon.body, { headers: { ...HTML_HEADERS, "content-type": icon.contentType, "cache-control": ICON_CACHE_CONTROL } })`.
- `ICON_ROUTES` maps `([path, icon]) => ({ method: "GET", pattern: exactPath(path), handler: () => iconResponse(icon) })`. Route order unchanged.

#### `src/mcp/server.ts`

- `import { McpServer, type Icon } from "@modelcontextprotocol/server";`
- `export function createServer(env: Env, auth: AuthProps, icons: Icon[]): McpServer` builds `new McpServer({ name: SERVER_NAME, version: SERVER_VERSION, icons }, { capabilities: { tools: {} } })`. Nothing else changes.

#### `src/auth/oauth-options.ts`

- Import `type Icon` from `@modelcontextprotocol/server` and `mcpIcons` from `../http/icons`.
- The module constant `mcpHandler` becomes `function mcpApiHandler(icons: Icon[]): Required<Pick<ExportedHandler<Env>, "fetch">>` returning the same object, whose `fetch` calls `createServer(env, auth, icons)`. Body otherwise identical.
- `oauthOptions(origin)` sets `apiHandler: mcpApiHandler(mcpIcons(origin))`. `index.ts` already caches the provider per origin, so the icons are built once per origin.

#### Test helpers

- `tests/helpers/node-mcp.ts`: `createServer(env, NODE_AUTH, [])`.
- `tests/helpers/mcp.ts`: extract the private `function initializeRequest(bearer: string): Promise<Response>` (the `postMcp` initialize call now inline in `callTool`, same body); `callTool` calls `await initializeRequest(bearer)` (same behavior); add `export async function initialize(bearer: string): Promise<Record<string, unknown>>` returning `(await parseRpc(await initializeRequest(bearer))).result as unknown as Record<string, unknown>`.

### Contract

| Method and path | Behavior |
|---|---|
| `GET /favicon-32.png`, `/apple-touch-icon.png`, `/icon-192.png`, `/icon-512.png`, `/logo-96.png` | PNG 32, 180, 192, 512, 96 px, `image/png`, `public, max-age=86400` |
| `GET /favicon.ico` | ICO with 16, 32, 48 px, `image/x-icon`, same cache |
| MCP `initialize` | `serverInfo.icons`: 32, 192, 512 px PNG URLs on the public origin |

`specs/001-egx-mcp-server/contracts/http-endpoints.md`: the image row is replaced by the first two rows above (spec 005, Amendment 1), and one sentence after the table records `serverInfo.icons`.

### Follow-ups

- Google OAuth consent screen logo: the owner uploads `google-oauth-logo-120.png` in the Google Cloud console.
- `websiteUrl` on `serverInfo` and a web app manifest using the 512 px icon: not requested.

### Deviations noted

- `routes.ts` reuses `HTML_HEADERS` (with the HTML CSP) on image responses, as the stylesheet and spec 005 do. Kept for consistency; harmless for images; cost to split: one small headers constant.
