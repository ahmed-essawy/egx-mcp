# Contract: HTTP endpoints

One Worker. `export default new OAuthProvider({...})` from `@cloudflare/workers-oauth-provider` 1.2.4, wrapped by an outer `fetch` that applies the OAuth KV write guard, plus a `scheduled` handler.

## OAuth and MCP (library-owned unless stated)

| Method and path | Owner | Behavior |
|---|---|---|
| `GET /.well-known/oauth-authorization-server`, `GET /.well-known/oauth-protected-resource` | library | Metadata for MCP clients |
| `POST /register` | library (DCR) | Guarded: refused with `503` and `Retry-After` (seconds to 00:00 UTC) when `usage_global.oauth_kv_writes + 1 > OAUTH_DAILY_KV_WRITES` |
| `GET /authorize` | app | Parses the request with `OAUTH_PROVIDER.parseAuthRequest`; if consent is remembered, continues; else renders the consent page (client name, scopes, "data is delayed and informational") |
| `POST /authorize` | app | Consent form (CSRF token from the library consent helper); on approve calls `beginUpstream` to Google with `openid email profile` |
| `GET /callback/google` | app | `finishUpstream`, verifies the Google ID token (`iss`, `aud`, `exp`, `email_verified`), upserts `users`, then `completeAuthorization({ userId, props: { userId, email } })`. Guarded (+1 KV write) |
| `POST /token` | library | Guarded (+2 KV writes). `accessTokenTTL` 86,400 s |
| `POST /mcp` | app (`createMcpHandler`) | MCP Streamable HTTP, stateless. Bearer is an OAuth token or an API key (`egx_` prefix, resolved by `resolveExternalToken`). `401` with `WWW-Authenticate` when missing or invalid |

Scopes: `mcp:read` (all read tools), `mcp:write` (personal writes). Both are granted at consent; API keys carry both.

## Dashboard (app-owned)

Session: HMAC-SHA-256 signed cookie `__Host-egx_session` (`user id`, `exp` 12 h), `Secure`, `HttpOnly`, `SameSite=Lax`, signed with secret `SESSION_SECRET`. No KV or D1 session rows. Every `POST` checks `Origin` equals the Worker origin and a per-session CSRF token.

| Method and path | Behavior |
|---|---|
| `GET /` | Public landing page: what the server is, delayed and unofficial notice, sources, link to README and dashboard, and next to the dashboard link "By signing in you agree to the Terms of use and acknowledge the Privacy policy" (both linked) |
| `GET /privacy` | Public static privacy policy (spec 002, FR-L03). No session, no cookies, no D1 or KV read. Other methods `404` |
| `GET /terms` | Public static terms of use (spec 002, FR-L04). No session, no cookies, no D1 or KV read. Other methods `404` |
| `GET /dashboard/login` | Redirect to Google (state cookie, PKCE) |
| `GET /dashboard/callback` | Verify Google ID token, upsert user, set session, redirect to `/dashboard` |
| `GET /dashboard` | List keys: `prefix`, `name`, `createdAt`, `lastUsedAt`, `revokedAt`; today's usage per tool |
| `POST /dashboard/keys` | Form `name`. Creates `egx_` + 32 random bytes base64url; stores hash and prefix; renders the full key once in a read-only field (no copy button, no script). Refused with a message when 3 keys are active (FR-043) |
| `POST /dashboard/keys/:id/revoke` | Sets `revoked_at` when the key belongs to the session user, else `404` |
| `POST /dashboard/account/delete` | Confirm field must equal the user's email; deletes the account (FR-036), revokes OAuth grants, clears the cookie |
| `POST /dashboard/logout` | Clears the cookie |

All HTML responses carry `Content-Security-Policy: default-src 'self'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store` (the one-time plaintext key must not be cached; `/styles.css` is static and keeps `Cache-Control: public, max-age=300`), `Referrer-Policy: same-origin` (a stricter `no-referrer` would make browsers send `Origin: null` on form POSTs, and `checkPost` would refuse every dashboard POST). Pages meet WCAG 2.2 AA (labels, focus order, contrast). Every HTML page ends with a footer `<nav aria-label="Site">` linking `/`, `/privacy` and `/terms`; the consent page also carries the "By authorizing you agree ..." sentence with both links (spec 002).

## Scheduled (cron, UTC)

| Cron | Handler | Work |
|---|---|---|
| `* 6-12 * * SUN-THU` | `snapshotJob` | Gate: Cairo time inside the session window (09:55 to 14:45 inclusive, or special hours) on a trading day that is not a holiday; fetch stocks (provider order), indices, FX and global metals, iSagha every 15 minutes; build snapshot; write KV only if changed; at the window end also write `snapshot:last-session` |
| `30 12,13 * * SUN-THU` | `endOfDayJob` | Runs once per Cairo date at or after 15:30 Cairo on trading days only. Its first check reads `snapshot:v1`: when `session.date` is today and `session.noTradesToday` is true, the whole job is skipped (no source fetch, no listing sync, no `missing_sessions` change, no bars, no stats) and only the run date is recorded. Otherwise, in order: discovery (`listingSync` step: listing diff, pending inserts, inactive marking, directory to KV), daily bars (then the latest stored session `L`), index values, discrepancies, big-move events, queued adjustments (at most 2 per run, within the daily row cap), stats to KV, `snapshot:last-session` if the snapshot job missed it |
| `0 16 * * *` | `referenceJob` | Once per day, every day (funds, metals and FX do not follow the EGX calendar): funds and NAVs (at most 13 pages), corporate actions (first 3 pages), dividends and financial figures from TradingView, fund staleness notices, metals and FX merged into `snapshot:v1`, then the `purge` step: up to 1,200 `market_events` rows older than 400 days and up to 3,000 `usage_daily` rows older than 90 days |
| `0 1 * * SAT` | `maintenanceJob` | `purgeExpiredData()` batch of at most 500 OAuth records (KV only; the D1 purges run daily in `referenceJob`) |

Every job catches per-provider failures, keeps the last stored data and writes one `job_failed` notice per job, step, source and day (failed pages listed in its details); each job writes all its notices with one `raiseNotices` statement per run.
