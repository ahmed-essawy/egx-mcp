# Feature Specification: Icon and test cleanup

**Feature Branch**: `feat/cleanup-icons-tests` (spec folder `007-cleanup-icons-tests`, delivered squash-local into `main`)

**Created**: 2026-10-31

**Status**: Planned

**Input**: Follow-ups from spec 005 (logo and favicon) and the q09-new-logo run. (1) Icon sizes and types are written twice, in the page head links and in the MCP server icon list: drive both from one table of path, size and type. (2) Icon responses reuse the HTML page headers (the HTML content security policy): give images their own fitting headers. (3) Let MCP clients on other origins fetch the icons (`Access-Control-Allow-Origin: *`); this is the only intended behavior change. (4) The tests import the deprecated `SELF` and `env` from `cloudflare:test`; move them to `exports` and `env` from `cloudflare:workers`. Business behavior otherwise stays identical.

## User Scenarios and Testing

### User Story 1: MCP clients show the server icon (Priority: P1)

An MCP client (for example a web based assistant on another origin) reads the server's icon list from `serverInfo` and fetches the icon image from the browser. Today the browser blocks reading the image cross-origin when the client uses a script fetch; after this change it may.

**Why this priority**: it is the only user-visible change and the reason for the header work.

**Independent Test**: request each icon path with an `Origin: https://client.example` header and check the response carries `Access-Control-Allow-Origin: *`, the right image type and the unchanged bytes.

**Acceptance Scenarios**:

1. **Given** the Worker is running, **When** a client sends `GET` to any of `/favicon-32.png`, `/favicon.ico`, `/apple-touch-icon.png`, `/icon-192.png`, `/icon-512.png`, `/logo-96.png`, **Then** the response is `200` with `access-control-allow-origin: *`, the same `content-type`, `cache-control: public, max-age=86400` and `x-content-type-options: nosniff` as before, and the same bytes as before (same SHA-256).
2. **Given** a request with an `Origin` header from another site, **When** it fetches an icon through the full Worker (OAuth provider in front), **Then** the response still carries `access-control-allow-origin: *` and no cookie.

---

### User Story 2: Image responses carry image headers (Priority: P2)

The operator wants image responses to carry only headers that apply to images, not the HTML page policy.

**Why this priority**: technical hygiene recorded as an accepted deviation in spec 005; no visitor-facing effect.

**Independent Test**: fetch each icon and check the header set exactly.

**Acceptance Scenarios**:

1. **Given** any icon path, **When** it is fetched, **Then** the response has no `content-security-policy` and no `referrer-policy` header, and has exactly the headers `content-type`, `cache-control`, `x-content-type-options` and `access-control-allow-origin` (plus any the platform adds).
2. **Given** any HTML page or the stylesheet, **When** it is fetched, **Then** its headers are unchanged (HTML content security policy, `no-store` for pages, `public, max-age=300` for the stylesheet).

---

### User Story 3: One place to change an icon (Priority: P2)

A maintainer adding or resizing an icon edits one table entry, and the page head links, the MCP icon list and the served image all follow.

**Why this priority**: removes duplication that already caused two lists to be kept in step by hand.

**Independent Test**: the page head links and the MCP icon list are byte for byte and value for value the same as before, and the source has one table holding path, size and type for each listed icon.

**Acceptance Scenarios**:

1. **Given** any page built by the shared page layout, **When** it is rendered, **Then** its head holds exactly the same three icon links in the same order as before (32 px icon, 192 px icon, 180 px apple touch icon).
2. **Given** an origin, **When** the MCP icon list is built, **Then** it is exactly the same three entries in the same order as before (32, 192, 512 px PNG on that origin).

---

### User Story 4: Tests use the current test API (Priority: P3)

A maintainer running the tests sees no deprecated test imports, so the suite keeps working when the deprecated names are removed.

**Why this priority**: no runtime effect; prevents a future break.

**Independent Test**: no test file imports `SELF` or `env` from `cloudflare:test`, and the full suite passes with the same number of tests as the baseline.

**Acceptance Scenarios**:

1. **Given** the test sources, **When** they are searched, **Then** no file imports `SELF` or `env` from `cloudflare:test` (helpers such as `applyD1Migrations` and the `D1Migration` type, which are not deprecated, may stay).
2. **Given** the full suite, **When** it runs, **Then** it passes with at least the baseline 70 files and 1466 tests (plus the new ones from this feature).

### Edge Cases

- `POST` to an icon path still answers `404` (routes stay GET only).
- `OPTIONS` preflight to an icon path is not added: a plain image `GET` needs no preflight; behavior for `OPTIONS` stays as today.
- `/favicon.ico` holds three sizes (16, 32, 48) and is not listed in the head or MCP list; it keeps its own type `image/x-icon`.
- `/logo-96.png` is the header logo, not a listed icon; it is still served with the image headers.
- The OAuth provider in front of the routes must not strip or replace the `access-control-allow-origin` header on these default-handler responses.

## Requirements

### Functional Requirements

- **FR-001 Single icon table**: one table holds, for each listed icon (32, 192, 180 and 512 px), its path, pixel size, content type, image data, whether it is linked from the page head (and with which link relation) and whether it is in the MCP icon list. The two unlisted images (`/favicon.ico`, `/logo-96.png`) are declared beside it with path, content type and image data. The page head links, the MCP icon list and the icon routes are all derived from these declarations, in one module. No path, size or type for these images is written anywhere else in source.
- **FR-002 Head links unchanged**: the rendered head icon links are byte for byte identical to today.
- **FR-003 MCP icon list unchanged**: the MCP `serverInfo` icon list is value for value identical to today.
- **FR-004 Image headers**: every icon and logo response carries `content-type` (its own type), `cache-control: public, max-age=86400`, `x-content-type-options: nosniff` and `access-control-allow-origin: *`, and does not carry the HTML `content-security-policy` or `referrer-policy`.
- **FR-005 CORS on icons (behavior change)**: `access-control-allow-origin: *` is the only new header a client can observe on icon responses. It applies to icon and logo routes only; HTML pages, the stylesheet, the OAuth endpoints and `/mcp` are unchanged.
- **FR-006 Other responses unchanged**: HTML pages and the stylesheet keep their current headers.
- **FR-007 Image bytes unchanged**: every icon path serves the same bytes as today.
- **FR-008 Test API**: test sources import `env` and `exports` from `cloudflare:workers` instead of `env` and `SELF` from `cloudflare:test`; requests to the Worker under test use `exports.default.fetch`, with the same arguments as before.

### Key Entities

- **Served image**: path, content type, image data.
- **Listed icon**: a served image with a square pixel size, an optional page head link relation (`icon` or `apple-touch-icon`) and a flag for the MCP icon list.

## Success Criteria

### Measurable Outcomes

- **SC-001**: 6 of 6 icon paths answer with `access-control-allow-origin: *` and the unchanged bytes (SHA-256 equal to the spec 005 values).
- **SC-002**: 0 icon responses carry `content-security-policy` or `referrer-policy`; 100% of HTML and stylesheet responses keep their current headers.
- **SC-003**: the head icon links and the MCP icon list compare equal to the current values in 100% of renders.
- **SC-004**: each listed icon's path, size and type appears in exactly 1 place in source.
- **SC-005**: 0 test files import `SELF` or `env` from `cloudflare:test`, and the suite passes with no test removed.

## Assumptions

- `Access-Control-Allow-Origin: *` is safe for these public, credential-free images; no `Vary: Origin` is needed for a fixed `*`.
- The stylesheet keeps reusing the HTML headers; that is out of scope here and noted in the plan as a follow-up.
- `HEAD` and `OPTIONS` handling for icons is out of scope.
- No change to data, tools, scheduled jobs, D1, KV or free-tier usage.
- The deprecation of `env` and `SELF` in `cloudflare:test` is taken from the `@cloudflare/vitest-plugin` 1.4.11 type declarations and the Cloudflare Workers Vitest "Test APIs" page; the "Migrate to Vitest plugin" guide named in the request covers only the package rename and does not describe this change.
