# Feature Specification: Logo and favicon

**Feature Branch**: `005-logo-favicon` (delivered on `pipeline/claude-logo-favicon`, squash-local) | **Created**: 2026-10-28 | **Status**: Planned

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
