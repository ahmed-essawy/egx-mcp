# Contract: HTTP endpoints

One Worker. `export default { fetch, scheduled }` in `src/index.ts`: `fetch` first applies the OAuth guard (guarded routes only: a per-IP limiter, then the KV write charge for `POST /token` and `POST /register`; the app-owned routes charge after validation), then delegates to an `OAuthProvider` from `@cloudflare/workers-oauth-provider` 1.2.4 built lazily per origin by `providerFor(request, env)` (the resource URL depends on `PUBLIC_ORIGIN`); `scheduled` dispatches the crons.

## OAuth and MCP (library-owned unless stated)

| Method and path | Owner | Behavior |
|---|---|---|
| `GET /.well-known/oauth-authorization-server`, `GET /.well-known/oauth-protected-resource` | library | Metadata for MCP clients |
| `POST /register` | library (DCR) | Guarded (per-IP limit, refused with `429` and `Retry-After` 60; then +1 KV write up front): refused with `503` and `Retry-After` (seconds to 00:00 UTC) when `usage_global.oauth_kv_writes` plus the route cost would pass `OAUTH_DAILY_KV_WRITES` |
| `GET /authorize` | app | Parses the request with `OAUTH_PROVIDER.parseAuthRequest`, looks up the client and calls `beginConsent`; renders the consent page every time (no remembered consent, owner decision D4): client name, the redirect host the tokens will be sent to, a loopback warning when it is a local app, the client's verified domain or a notice that a self-registered client's name is not verified, requested scopes, "data is delayed and informational", Approve and Deny buttons; the response carries `X-Frame-Options: DENY`. Per-IP limit first; charged +1 KV write (the consent transaction) only after `parseAuthRequest` accepts the request |
| `POST /authorize` | app | Consent form posting the library `handle` (bound by the library's own consent cookie, not by `checkPost`) and `decision` (`approve` or `deny`); approve calls `approveConsent` then `beginUpstream` to Google with `openid email profile`; deny calls `denyConsent`. Per-IP limit first; charged +1 KV write (the upstream transaction) only after `approveConsent` or `denyConsent` accepts the handle |
| `GET /callback/google` | app | `finishUpstream`, verifies the Google ID token (`iss`, `aud`, `exp`, `email_verified`), upserts `users`, then `completeAuthorization` with `userId`, the granted `scope` and `props: { userId, email, via: "oauth" }`. Per-IP limit first; charged +1 KV write (the grant) only after `finishUpstream` accepts the state |
| `POST /token` | library | Guarded (per-IP limit, then +2 KV writes up front). `accessTokenTTL` 86,400 s |
| `POST /mcp` | app (`createMcpHandler`) | MCP Streamable HTTP, stateless. Bearer is an OAuth token or an API key (`egx_` prefix, resolved by `resolveExternalToken`). `401` with `WWW-Authenticate` when missing or invalid |

Scopes: `mcp:read` (every tool registered `readOnly: true`, including `portfolio_get` and `what_changed_since`, whose crossing state write is internal bookkeeping), `mcp:write` (the 4 personal write tools and `admin`). Consent grants the scopes the client requested within `scopesSupported`, or both when it requested none; a call without the needed scope gets `forbidden` before any accounting row is written. API keys carry both.

## Dashboard (app-owned)

Session: HMAC-SHA-256 signed cookie `__Host-egx_session` (`user id`, `exp` 12 h), `Secure`, `HttpOnly`, `SameSite=Lax`, signed with secret `SESSION_SECRET`. No KV or D1 session rows. Every `POST` checks `Origin` equals the Worker origin and a per-session CSRF token.

| Method and path | Behavior |
|---|---|
| `GET /`, `HEAD /` | Public home page (spec 003, amendments 1 to 3; spec 006): "EGX MCP", one sentence, a "Sign in" button (`/dashboard`) with "By signing in you agree to the Terms of use and acknowledge the Privacy policy" (both linked); 5 example questions; a "Connect your assistant" block showing the MCP address `<origin>/mcp` (origin from `PUBLIC_ORIGIN`, or the request origin when it is empty; `500` when it is invalid) and `Authorization: Bearer <your key>`; a "Learn more" links section; one notice that data is delayed, unofficial and not advice, with the sources (the independence sentence is in the site header, spec 005). Public headers (see Public site below). No D1 or KV read, no cookie |
| `GET /privacy`, `HEAD /privacy` | Public static privacy policy (spec 002, FR-L03; headers per spec 006). No session, no cookies, no D1 or KV read. Other methods `404` |
| `GET /terms`, `HEAD /terms` | Public static terms of use (spec 002, FR-L04; headers per spec 006). No session, no cookies, no D1 or KV read. Other methods `404` |
| `GET /favicon-32.png`, `/apple-touch-icon.png`, `/icon-192.png`, `/icon-512.png`, `/logo-96.png` | PNG 32, 180, 192, 512, 96 px, `image/png`, `public, max-age=86400`, `nosniff`, `Access-Control-Allow-Origin: *`, no HTML CSP, no cookie, no D1 or KV read. Other methods 404 (spec 005, Amendment 1; image headers per spec 007) |
| `GET /favicon.ico` | ICO with 16, 32, 48 px, `image/x-icon`, same cache and image headers, no cookie, no D1 or KV read. Other methods 404 (spec 005, Amendment 1; image headers per spec 007) |
| `GET /dashboard/login` | Redirect to Google (state cookie, PKCE) |
| `GET /dashboard/callback` | Verify Google ID token, upsert user, set session, redirect to `/dashboard` |
| `GET /dashboard` | List keys: `prefix`, `name`, `createdAt`, `lastUsedAt`, `revokedAt`; today's usage per tool |
| `POST /dashboard/keys` | Form `name`. Creates `egx_` + 32 random bytes base64url; stores hash and prefix; renders the full key once in a read-only field (no copy button, no script). Refused with a message when 3 keys are active (FR-043) |
| `POST /dashboard/keys/:id/revoke` | Sets `revoked_at` when the key belongs to the session user, else `404` |
| `POST /dashboard/account/delete` | Confirm field must equal the user's email; deletes the account (FR-036), revokes OAuth grants, clears the cookie |
| `POST /dashboard/logout` | Clears the cookie |

All private HTML responses (dashboard, sign-in, consent, OAuth guard refusals, error and not found pages) carry `Content-Security-Policy: default-src 'self'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `X-Robots-Tag: noindex, nofollow`, `Cache-Control: no-store` (the one-time plaintext key must not be cached; `/styles.css` is static and keeps `Cache-Control: public, max-age=300`), `Referrer-Policy: same-origin` (a stricter `no-referrer` would make browsers send `Origin: null` on form POSTs, and `checkPost` would refuse every dashboard POST). Pages meet WCAG 2.2 AA (labels, focus order, contrast). Every HTML page ends with a footer `<nav aria-label="Site">` linking Home, Tools, the four connect guides, Questions, Data and limits, Privacy policy, Terms of use and the GitHub repository (spec 006); the consent page also carries the "By authorizing you agree ..." sentence with both links (spec 002).

The MCP `initialize` result lists `serverInfo.icons`: the 32, 192 and 512 px PNGs on the public origin (spec 005, Amendment 1).

## Public site (spec 006, search and AI discoverability)

Detail in `specs/006-seo-ai-discoverability/contracts/routes.md`. All routes below are served by `defaultHandler` (`src/http/public.ts`) except `GET /mcp/server-card`, which `src/index.ts` answers before the OAuth guard and the provider (the provider owns every `/mcp/...` path). None reads D1, KV or an upstream, calls the rate limiter or sets a cookie. Only `GET` and `HEAD` are answered (the image route answers `GET`); other methods get `404`, except that `/mcp/server-card` and `/.well-known/ai-catalog.json` also answer `OPTIONS` with `204` and the discovery CORS header set.

| Method and path | Behavior |
|---|---|
| `GET`, `HEAD` `/`, `/tools`, `/connect/claude`, `/connect/chatgpt`, `/connect/claude-code`, `/connect/cursor`, `/faq`, `/data`, `/privacy`, `/terms` | HTML, `cache-control: public, max-age=3600`, `etag`, `vary: Accept`, `link` to the Markdown twin, the three existing security headers, no `x-robots-tag`. `If-None-Match` gives `304`. An `Accept` that prefers `text/markdown` or `text/plain` gets the Markdown twin |
| `GET`, `HEAD` `/index.md`, `/tools.md`, `/connect/claude.md`, `/connect/chatgpt.md`, `/connect/claude-code.md`, `/connect/cursor.md`, `/faq.md`, `/data.md`, `/privacy.md`, `/terms.md` | Markdown twin, `text/markdown; charset=utf-8`, same cache headers, `link` canonical to the HTML page |
| `GET`, `HEAD` `/ar`, `/ar/tools`, `/ar/faq`, `/ar/data` and their `.md` twins (`/ar.md` for the Arabic home) | (spec 006 Phase 7, pending) |
| `GET`, `HEAD` `/robots.txt` | Crawler rules, `text/plain` |
| `GET`, `HEAD` `/sitemap.xml` | Sitemap, `application/xml` |
| `GET`, `HEAD` `/llms.txt`, `/llms-full.txt` | Site summary and full content, `text/plain` |
| `GET`, `HEAD` `/.well-known/ai-catalog.json` | AI catalog, `application/ai-catalog+json`, discovery CORS headers |
| `GET`, `HEAD` `/mcp/server-card` | MCP server card, `application/mcp-server-card+json`, discovery CORS headers; answered in `src/index.ts` before the provider |
| `GET`, `HEAD` `/c60c57998197b5e5b4a9fc2f935a3c44.txt` | IndexNow key file, the key with no newline, `text/plain` |
| `GET` `/og-image.png` | 1200 by 630 PNG preview image, `image/png`, `public, max-age=86400`, image headers of spec 007 (spec 005, Amendment 2) |

Text files and Markdown twins carry `x-content-type-options: nosniff` and an `etag`, with no CSP and no cookie. A path that differs from a public page or twin only by case or trailing slash answers `301` to the canonical path (query dropped); any other unknown path answers the private `404` page.

## Scheduled (cron, UTC)

| Cron | Handler | Work |
|---|---|---|
| `* 6-13 * * SUN-THU` | `snapshotJob` | Before the gate, on any tick including holidays: when `directory:v1` is missing, run the shared listing sync once per Cairo date (job `listing_bootstrap`, marked before it runs, failures raise a `job_failed` notice and never stop the snapshot). Gate: Cairo time inside the session window (09:55 to 14:45 inclusive, or special hours) on a trading day that is not a holiday; fetch stocks (provider order), indices, FX and global metals, iSagha every 15 minutes; build snapshot; write KV only if changed; at the window end also write `snapshot:last-session` |
| `30 12,13,14 * * SUN-THU` | `endOfDayJob` | Runs once per Cairo date at or after 15:30 Cairo on trading days only. Its first check reads `snapshot:v1`: when `session.date` is today and `session.noTradesToday` is true, the whole job is skipped (no source fetch, no listing sync, no `missing_sessions` change, no bars, no stats) and only the run date is recorded. Otherwise, in order: discovery (`listingSync` step: listing diff, pending inserts, inactive marking, directory to KV), daily bars (then the latest stored session `L`), index values, discrepancies, big-move events, queued adjustments (at most 2 per run, within the daily row cap), stats to KV, `snapshot:last-session` if the snapshot job missed it |
| `0 16 * * *` | `referenceJob` | Once per day, every day (funds, metals and FX do not follow the EGX calendar): funds and NAVs (at most 13 pages), corporate actions (first 3 pages), dividends and financial figures from TradingView, fund staleness notices, metals and FX merged into `snapshot:v1`, then the `purge` step: up to 1,200 `market_events` rows older than 400 days and up to 3,000 `usage_daily` rows older than 90 days |
| `0 1 * * SAT` | `maintenanceJob` | `purgeExpiredData({ batchSize: 250, cursor })` through `getOAuthApi(oauthOptions(origin), env)` (the `env.OAUTH_PROVIDER` helpers are not set in `scheduled`), so one run checks at most 500 OAuth records; cursor in KV `oauth:purge-cursor`; skipped with a log line when `PUBLIC_ORIGIN` is empty; writes only `job_state` job `maintenance` in D1 (the D1 purges run daily in `referenceJob`) |

Every job catches per-provider failures, keeps the last stored data and writes one `job_failed` notice per job, step, source and day (failed pages listed in its details); each job writes all its notices with one `raiseNotices` statement per run.
