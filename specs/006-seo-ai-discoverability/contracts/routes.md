# Contract: public routes and headers

All routes below are served by `defaultHandler` (`src/http/routes.ts` spreading `PUBLIC_ROUTES` from `src/http/public.ts`), except `/mcp/server-card`, which `src/index.ts` answers before the OAuth guard and the provider (the provider owns every `/mcp/...` path). None of them reads D1, KV or an upstream, calls `RATE_LIMITER`, charges any quota or sets a cookie. `{origin}` is `resolvePublicOrigin(request, env)`; when it is `null` every route answers `500` with the existing error page.

## Route table

| Method | Path | 200 body | Content type | Cache-Control | Extra headers |
|---|---|---|---|---|---|
| GET, HEAD | `/` | home HTML | `text/html; charset=utf-8` | `public, max-age=3600` | P, V, L(`/index.md`) |
| GET, HEAD | `/tools` | HTML | html | same | P, V, L |
| GET, HEAD | `/connect/claude`, `/connect/chatgpt`, `/connect/claude-code`, `/connect/cursor` | HTML | html | same | P, V, L |
| GET, HEAD | `/faq`, `/data` | HTML | html | same | P, V, L |
| GET, HEAD | `/privacy`, `/terms` | HTML (legal text unchanged) | html | same | P, V, L |
| GET, HEAD | `/ar`, `/ar/tools`, `/ar/faq`, `/ar/data` (Arabic group) | HTML, `lang="ar" dir="rtl"` | html | same | P, V, L |
| GET, HEAD | `/index.md`, `<page path>.md` for every page above (`/ar.md` for the Arabic home) | Markdown twin | `text/markdown; charset=utf-8` | same | T, C |
| GET, HEAD | `/robots.txt` | crawler rules | `text/plain; charset=utf-8` | same | T |
| GET, HEAD | `/sitemap.xml` | sitemap | `application/xml; charset=utf-8` | same | T |
| GET, HEAD | `/llms.txt` | site summary | `text/plain; charset=utf-8` | same | T |
| GET, HEAD | `/llms-full.txt` | full content | `text/plain; charset=utf-8` | same | T |
| GET, HEAD | `/.well-known/ai-catalog.json` | AI catalog | `application/ai-catalog+json` | same | T, X |
| GET, HEAD | `/mcp/server-card` | server card | `application/mcp-server-card+json` | same | T, X |
| GET, HEAD | `/c60c57998197b5e5b4a9fc2f935a3c44.txt` | the key, no newline | `text/plain; charset=utf-8` | same | T |
| GET, HEAD | `/google8bdb3ebfbb167b7e.html` | Search Console verification file, body `google-site-verification: google8bdb3ebfbb167b7e.html` with no newline, not a page and not listed in the sitemap or llms.txt | `text/html; charset=utf-8` | same | P |
| GET (like every image route) | `/og-image.png` | 1200 by 630 PNG | `image/png` | `public, max-age=86400` | the image headers of spec 007 (same as the other icon routes) |

Header sets:

- **P (public HTML)**: `content-security-policy: default-src 'self'; frame-ancestors 'none'`, `x-content-type-options: nosniff`, `referrer-policy: same-origin` (the three existing `HTML_HEADERS` values), plus `etag`. No `x-robots-tag`, no `set-cookie`.
- **V**: `vary: Accept`.
- **L**: `link: <{origin}{markdown path}>; rel="alternate"; type="text/markdown"`.
- **T (text files and twins)**: `x-content-type-options: nosniff`, `etag`. No CSP (not a document that runs anything) and no cookie.
- **C (Markdown twin)**: `link: <{origin}{html path}>; rel="canonical"`.
- **X (discovery CORS, SEP-2127)**: `access-control-allow-origin: *`, `access-control-allow-methods: GET`, `access-control-allow-headers: Content-Type, If-None-Match`, `access-control-expose-headers: ETag`.

`etag` is `"` + the first 32 lower-case hex characters of the SHA-256 of the exact body bytes + `"`. The HTML and Markdown representations of one URL have different ETags.

## Conditional requests

`If-None-Match` is split on commas, each value trimmed and a leading `W/` removed; if any value equals the response ETag, or the header is `*`, the answer is `304` with no body and the same `etag`, `cache-control`, `vary`, `link` and CORS headers as the `200`. No other conditional header is read.

## HEAD

`HEAD` on any route above answers the `GET` status and headers with no body. `HEAD` on any other path keeps today's behavior (`404` page, because only these routes register `HEAD`).

## Content negotiation on HTML page URLs

The page URL answers the Markdown twin (body, `content-type`, `etag` and C header of the twin, plus `vary: Accept`) when `prefersMarkdown(accept)` is true:

- Parse `Accept` into media ranges with `q` (default 1; invalid `q` counts as 0).
- `markdownQ` = highest `q` among `text/markdown` and `text/plain`; `htmlQ` = highest `q` among `text/html`, `application/xhtml+xml`, `text/*` and `*/*`.
- Markdown when `markdownQ > 0` and `markdownQ > htmlQ`. A missing or empty `Accept` gives HTML.

Examples: `text/markdown` gives Markdown; `text/markdown, text/html;q=0.9` gives Markdown; `text/html,application/xhtml+xml,*/*;q=0.8` (browsers) gives HTML; `*/*` gives HTML; `text/plain;q=0.5, text/html` gives HTML.

## Canonical redirects and not found

`canonicalRedirect(request, ctx)` runs in `defaultHandler` after the route loop finds no match and before the `404` page, for `GET` and `HEAD` only:

1. `candidate` = pathname lower-cased, with one or more trailing `/` removed (except the root `/`).
2. If `candidate` differs from the pathname and `candidate` is a public HTML page path or Markdown twin path, answer `301` with `location: {origin}{candidate}` (query string dropped) and `cache-control: public, max-age=86400`, no body.
3. Otherwise the existing `404` page (`messageView("Page not found", ...)`), which is a private page (see below).

Query strings never change the answer of a public route (the page declares its canonical URL without the query). Examples: `/Tools` and `/tools/` give `301` to `/tools`; `/TOOLS.MD` gives `301` to `/tools.md`; `/tools?utm_source=x` gives `200` with canonical `{origin}/tools`; `/tool` gives `404`; `POST /tools` gives `404`.

## Private pages (changed headers)

Every response built by `htmlResponse` (dashboard, sign-in, consent, OAuth guard refusals, error and not found pages) keeps `HTML_HEADERS` (`no-store` and the CSP) and gains `x-robots-tag: noindex, nofollow`; the shared private layout `page()` gains `<meta name="robots" content="noindex, nofollow">`. `src/http/authorize.ts` builds its headers from `HTML_HEADERS`, so the consent page gets the header too. Redirect responses (`/dashboard` to `/dashboard/login`, Google redirects) are unchanged.

## Unchanged routes

`/styles.css`, the icon routes (as spec 007 leaves them), `/dashboard*`, `/authorize`, `/callback/google`, `/token`, `/register`, `/.well-known/oauth-*` and `POST /mcp` behave exactly as before.
