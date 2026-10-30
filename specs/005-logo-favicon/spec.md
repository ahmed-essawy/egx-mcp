# Feature Specification: Logo and favicon

**Feature Branch**: `005-logo-favicon` (delivered on `pipeline/claude-logo-favicon`, squash-local) | **Created**: 2026-10-28 | **Status**: Planned | **Amended**: 2026-10-31 (Amendment 1, EGX MCP logo)

**Input**: The owner confirmed the 512 by 512 EGX gate logo (`logo.png`) may be the temporary site logo and favicon. Serve it from the Worker as favicons (32 and 192), the apple-touch-icon (180) and a header logo with alt text on the home, privacy, terms and dashboard pages. CSP stays `default-src 'self'`. Add the notice "independent service, not affiliated with the Egyptian Exchange" once, near the logo, without duplicating the home page notice. Commit only the image data actually used; never a `logo.png` at the repo root.

## User Scenarios and Testing

### User Story 1: Recognize the site (Priority: P1)

A visitor sees the logo in the browser tab, in a home screen shortcut and at the top of every page, and the logo links back home.

**Independent Test**: `GET /favicon-32.png`, `/favicon.ico`, `/apple-touch-icon.png` and `/icon-192.png` answer `200` PNG images of 32, 32, 180 and 192 px with a cache header; every page head links them; every page body starts (after the skip link) with a header holding the logo image with alt text, linked to `/`.

### User Story 2: Know the site is unofficial (Priority: P1)

A visitor sees next to the logo that the service is independent and not affiliated with the Egyptian Exchange, so the gate logo is not taken as an official mark.

**Independent Test**: every page shows "Independent service, not affiliated with the Egyptian Exchange." exactly once, in the header; the home notice no longer repeats it.

### Edge Cases

- `POST` to an icon path: `404` (routes are GET only, like the stylesheet).
- Repeated requests for the same icon return the full image each time.
- Dark system theme: the PNG has a transparent background (RGBA), so it sits on the page background in both themes.
- The apple touch icon is opaque (flattened onto the light page background `#f8fafb`) because iOS fills transparency with black; the 32 and 192 px icons stay transparent.
- The consent and message pages share `page()`, so they get the same head links and header.

## Requirements

- **FR-I01 Icon routes**: `GET /favicon-32.png` (32 by 32), `GET /favicon.ico` (the same 32 by 32 PNG bytes), `GET /apple-touch-icon.png` (180 by 180), `GET /icon-192.png` (192 by 192) answer `200` with `content-type: image/png`, `cache-control: public, max-age=86400`, `x-content-type-options: nosniff`. No D1, KV or upstream access.
- **FR-I02 Head links**: every page from `page()` links, before the stylesheet: `<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">`, `<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">`, `<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">`.
- **FR-I03 Header**: every page from `page()` has, between the skip link and `<main>`, `<header><a class="brand" href="/"><img src="/icon-192.png" alt="EGX MCP home" width="48" height="48"></a><p class="affiliation">Independent service, not affiliated with the Egyptian Exchange.</p></header>`.
- **FR-I04 Single notice**: the home notice becomes "Data is delayed, unofficial and for information only, not financial advice. Sources: EGX website, TradingView, Mubasher Info, iSagha." The affiliation sentence appears once per page (FR-I03). This supersedes spec 003 FR-H04 (Amendment 1): the independence sentence moves to the site header.
- **FR-I05 Security headers**: `HTML_HEADERS` is unchanged (CSP `default-src 'self'; frame-ancestors 'none'`). Images are same-origin, so no CSP change. No external font, script or image.
- **FR-I06 Styling**: the header uses the content column width; logo and affiliation sit on one row and wrap on narrow screens; no inline styles; colors only through existing custom properties.
- **FR-I07 Assets**: only the 32, 180 and 192 px images are committed, as base64 string constants in `src/http/icons.ts`. No PNG file and no `logo.png` is committed.

## Success Criteria

- **SC-I01**: The four icon routes pass in the Node-pool unit run with the right dimensions and headers.
- **SC-I02**: Home, privacy, terms and dashboard pages contain the head links and the header with alt text; CSP test unchanged.
- **SC-I03**: `npm run typecheck` passes and the Node-pool unit run has no failure (baseline 376 pass, 0 fail).

## Assumptions

- The logo is temporary; replacing it later means regenerating the three base64 constants (command in plan.md).
- MCP `serverInfo.icons` is out of scope for this run (see plan.md, Follow-ups).

## Amendment 1 (2026-10-31): EGX MCP logo

**Input**: The owner approved the final EGX MCP logo (navy `#032853`, gold `#d6a814`, a mark with no text) to replace the temporary EGX gate logo everywhere the site uses it: the favicons, the apple touch icon, the 192 px icon and the header logo, with "EGX MCP" as HTML text beside the mark. `/favicon.ico` becomes a real multi-size icon, a 512 px icon is added, and MCP clients see the logo through `serverInfo.icons` (the follow-up in plan.md). The source images are final and live outside the repo (`.git/pipeline/q09-new-logo/assets`); the Google OAuth consent screen logo is uploaded by the owner and is not part of the code. The repo's `.mcp.json` (Rendobar MCP server URL, no secret) is committed with this change at the owner's request.

FR-I01, FR-I03, FR-I07, the US1 Independent Test, the transparency edge cases and the first assumption are replaced by the items below. FR-I02, FR-I04, FR-I05 and FR-I06 stay.

### User Story 1 (amended): Recognize the site (Priority: P1)

A visitor sees the EGX MCP mark in the browser tab, in a home screen shortcut and at the top of every page beside the words "EGX MCP", and the mark and name link back home.

**Acceptance scenarios**:

1. **A1-1** Given any page, when the browser loads `/favicon-32.png`, `/apple-touch-icon.png`, `/icon-192.png`, `/icon-512.png` or `/logo-96.png`, then each answers `200` with the EGX MCP artwork (byte for byte the approved asset) as a PNG of 32, 180, 192, 512 and 96 px.
2. **A1-2** Given a browser or crawler that asks for `/favicon.ico`, when it loads it, then it receives an ICO file holding 16, 32 and 48 px images with `content-type: image/x-icon`.
3. **A1-3** Given any page from `page()`, when it renders, then the header shows the mark at 48 by 48 CSS px with "EGX MCP" as text beside it, both inside one link to `/`, and the affiliation sentence after it.
4. **A1-4** Given a phone (375 px), a laptop (1024 px) or a desktop (1440 px) in light or dark theme, when a page renders, then the mark, the name and the affiliation sit on one row or wrap cleanly, the mark keeps its rounded corners, and nothing scrolls sideways.

### User Story 3: See the logo in the assistant (Priority: P2)

An MCP client that shows server icons (for example in its connector list) shows the EGX MCP mark for this server.

**Independent Test**: the `initialize` result's `serverInfo` holds `icons` with absolute URLs on the Worker's public origin for the 32, 192 and 512 px PNGs, each with `mimeType` and `sizes`.

**Acceptance scenarios**:

1. **A3-1** Given an authenticated MCP client, when it sends `initialize` to `/mcp`, then `serverInfo` is `{ name: "egx-mcp", version: "1.0.0", icons: [...] }` with three icons: `<origin>/favicon-32.png` (`32x32`), `<origin>/icon-192.png` (`192x192`), `<origin>/icon-512.png` (`512x512`), all `image/png`.
2. **A3-2** Given `PUBLIC_ORIGIN` is set, when the icons are built, then they use that origin; given it is empty, they use the request origin (the same rule as the MCP address on the home page).

### Requirements (amended)

- **FR-I01 Icon routes (replaces FR-I01)**: `GET /favicon-32.png` (32 by 32), `GET /apple-touch-icon.png` (180 by 180), `GET /icon-192.png` (192 by 192), `GET /icon-512.png` (512 by 512) and `GET /logo-96.png` (96 by 96) answer `200` with `content-type: image/png`; `GET /favicon.ico` answers `200` with `content-type: image/x-icon` and an ICO holding 16, 32 and 48 px PNG entries. All answer with `cache-control: public, max-age=86400`, `x-content-type-options: nosniff`, no cookie. No D1, KV or upstream access. Other methods `404`.
- **FR-I03 Header (replaces FR-I03)**: every page from `page()` has, between the skip link and `<main>`, `<header><a class="brand" href="/"><img src="/logo-96.png" alt="" width="48" height="48">EGX MCP</a><p class="affiliation">Independent service, not affiliated with the Egyptian Exchange.</p></header>`. The image is decorative (`alt=""`) because the link text "EGX MCP" names the link.
- **FR-I07 Assets (replaces FR-I07)**: the six served images (favicon 32 PNG, favicon ICO, apple touch 180, icon 192, icon 512, header logo 96) are committed only as base64 string constants in `src/http/icons.ts`, generated from the approved assets. No image file is committed. The 1024 px master, the 120 px Google logo and the source `seed-42.webp` stay outside the repo.
- **FR-I08 Head links**: unchanged from FR-I02 (32 and 192 px icons, apple touch icon). The 512 px icon and `/favicon.ico` get routes but no `<link>`, so no browser downloads the 63 KB image for a tab icon, and `/favicon.ico` stays the conventional fallback path.
- **FR-I09 MCP server icons**: `createServer` passes `icons` on the server implementation info as in A3-1; the origin is the one the OAuth provider is built for (`resolvePublicOrigin`). No other `serverInfo` field changes.
- **FR-I10 Header styling**: the brand link lays the mark and the name on one row (flex, centered, small gap), uses `var(--text)` and weight 600 with no underline, and keeps the existing focus outline. No inline style, no new color.

### Edge cases (amended)

- `POST` to any icon path, including `/icon-512.png` and `/logo-96.png`: `404`.
- The favicon, apple touch and 192/512 px icons are opaque navy squares (24-bit RGB), so iOS shows no black fill and both themes show the same tile.
- The 96 px header logo is RGBA with transparent rounded corners, so it sits on the page background in both themes.
- A client that ignores `icons` keeps working: the field is optional in the MCP schema of `@modelcontextprotocol/server` 2.3.1.

### Success criteria (amended)

- **SC-I04**: every served image equals the approved asset byte for byte (SHA-256 test) and has the size and type in FR-I01.
- **SC-I05**: the header markup equals FR-I03 on the home, privacy, terms, dashboard and message pages; CSP and the single affiliation sentence tests stay unchanged.
- **SC-I06**: an `initialize` call through the Worker returns the three icons of A3-1 on the request origin.
- **SC-I07**: the header renders cleanly at 375, 1024 and 1440 px in light and dark themes (manual render check).
- **SC-I08**: `npm run typecheck` passes and `npm test` has no failure (baseline at b143e4b: 68 files, 1452 tests pass).

### Assumptions (amended)

- The EGX MCP logo is final; a later replacement regenerates the six constants with the command in plan.md, Amendment 1.
- The owner uploads `google-oauth-logo-120.png` to the Google OAuth consent screen; nothing in the code refers to it.
- `websiteUrl` on `serverInfo` is not added (not requested).
