# Feature Specification: Privacy policy and terms of use pages

**Feature Branch**: `002-legal-pages` (delivered on `feat/egx-mcp-server-mvp`) | **Created**: 2026-10-28 | **Status**: Planned

**Input**: Public pages `GET /privacy` and `GET /terms` on the Worker, static HTML in the `src/http/views.ts` style with the existing security headers, linked from the home, sign-in and consent pages. Operator Ahmed M. Essawy, contact ahm.elessawy@gmail.com. Content matches the real behavior of the service (spec 001). The README states the live address and links both pages.

## User Scenarios and Testing

### User Story 1: Read how personal data is handled (Priority: P1)

A visitor, or Google during OAuth app verification, opens the privacy policy from any page of the service and learns who runs it, what is collected, why, where it is stored, how long it is kept and how to delete an account.

**Independent Test**: `GET /privacy` with no cookies and no bindings returns `200` HTML containing every section of FR-L03.

### User Story 2: Read the terms before signing in (Priority: P1)

A visitor reads the terms of use (delayed and unofficial data, not investment advice, no warranty, acceptable use) before signing in or authorizing an AI client.

**Independent Test**: `GET /terms` returns `200` HTML containing every section of FR-L04; the home and consent pages link both pages next to the sign-in or authorize action.

### User Story 3: Find the live server and the policies in the README (Priority: P2)

A user reading the README finds the live MCP address, the home page and links to both policies.

**Independent Test**: `npm run check:readme` passes and the README contains the four live URLs.

### Edge Cases

- `POST`, `PUT` or `HEAD` on `/privacy` or `/terms`: `404`, the same as every other unmatched method (existing router rule).
- Bindings missing or D1/KV down: both pages still render (they read nothing).
- Features in spec 001 that are not built in this build (portfolio, price levels, MCP client sign-in, in-dashboard account deletion T110): the text is phrased so it is true now and stays true once they ship (conditional "if you use ..." wording, deletion by email "until a delete button is available in the dashboard").

## Requirements

- **FR-L01**: `GET /privacy` and `GET /terms` MUST return `200` with `HTML_HEADERS` unchanged (`content-type: text/html; charset=utf-8`, `content-security-policy: default-src 'self'; frame-ancestors 'none'`, `x-content-type-options: nosniff`, `referrer-policy: same-origin`, `cache-control: no-store`), no `set-cookie`, and no D1, KV, secret or config read. Other methods fall through to `404`.
- **FR-L02**: Every page rendered by `page()` MUST end with a footer navigation (`<footer>` with `<nav aria-label="Site">`) linking `/` (Home), `/privacy` (Privacy policy) and `/terms` (Terms of use). This covers the home page, the sign-in result pages (sign-in failed, sign-in not available yet, account deleted), the consent page, the dashboard and both legal pages.
- **FR-L02a**: The home page (next to the "Sign in to manage your API keys" link) and the consent page (after the disclaimer) MUST show: "By signing in you agree to the Terms of use and acknowledge the Privacy policy." (consent: "By authorizing you agree ..."), with both names linked.
- **FR-L03**: The privacy page (`<h1>Privacy policy</h1>`) MUST show "Last updated: 2026-10-28" and these `<h2>` sections in this order, with these facts:
  1. **Who runs this service**: operator Ahmed M. Essawy; contact `mailto:ahm.elessawy@gmail.com`; the service is free and has no ads.
  2. **What we collect and why**: from Google sign-in (scopes `openid email profile`): Google account identifier, email address and display name; the identifier and email address are used to identify the account, show who is signed in and apply the limits that the operator sets for individual accounts, and the display name is stored with the account and is not shown or shared; API key records (see section 6); per-tool usage counts (section 7); if you use the portfolio or price-level tools, the holdings (symbol, quantity, cost per share, acquisition date) and price levels (symbol, above or below, level, last crossing time) you save, used only to answer your own requests and visible only to you.
  3. **What we do not collect**: no Google password, no contacts, Drive, Gmail or other Google data, no payment data, no location, no advertising or analytics trackers, no third-party scripts; the questions you type into your AI assistant are not received, only the tool calls it makes, and their arguments are not stored; personal data is never sold or shared for advertising.
  4. **Cookies**: `__Host-egx_session` (signed, HttpOnly, Secure, 12 hours) keeps you signed in to the dashboard; `__Host-egx_login` (10 minutes) protects the Google sign-in step. Both are strictly necessary; no other cookies.
  5. **Where data is stored and who processes it**: Cloudflare (Workers, D1 database, KV storage; as host it processes request data such as IP addresses under its own privacy policy, and data may be stored or processed outside your country); Google (sign-in under its own privacy policy). Market data sources never receive personal data.
  6. **How API keys are stored**: the full key is shown once and never stored; only a SHA-256 hash, the 8 characters that follow `egx_`, the name you give and the created, last used and revoked times are kept; you can revoke a key at any time in the dashboard.
  7. **Usage records and limits**: calls per tool per account per UTC day, used for daily limits and shown on the dashboard; short-lived per-minute rate counters per account.
  8. **How long we keep data**: account, keys, holdings and price levels until the account is deleted; daily usage records are kept for operating the limits and the intent is to delete them after 90 days (no purge job exists yet); sign-in sessions 12 hours; Cloudflare keeps its own logs under its policy.
  9. **Your choices and account deletion**: see your email, keys and today's usage in the dashboard; revoke keys; remove the app's access in your Google account settings; to delete the account and all its data, email the contact from the account's address until a delete button is available in the dashboard; requests are handled within 30 days.
  10. **Children**: the service is not intended for anyone under 18, and people under 18 may not use it.
  11. **Changes to this policy**: changes are posted on this page with a new "Last updated" date; the page also points to the terms of use (linked).
  12. **Contact**: name and mailto link again.
- **FR-L04**: The terms page (`<h1>Terms of use</h1>`) MUST show "Last updated: 2026-10-28" and these `<h2>` sections in this order:
  1. **Acceptance**: using the service, signing in or creating a key means accepting these terms and the privacy policy (linked); the service is not affiliated with, endorsed by or sponsored by the Egyptian Exchange.
  2. **The service**: free MCP server and dashboard run by Ahmed M. Essawy that answers questions about EGX market data from stored data; it may change, be limited or stop at any time without notice.
  3. **Delayed and unofficial data**: data is delayed (not real-time), unofficial and informational only; it comes, or will come, from free public sources (EGX website, TradingView, Mubasher Info, iSagha, fund managers' own sites) and the Egyptian Exchange has not given permission to redistribute it; it can be late, wrong or missing; check an official source before acting.
  4. **Not investment advice**: nothing from the service is financial, investment, tax or legal advice or a buy, sell or hold recommendation; decisions are yours.
  5. **No warranty**: provided "as is" and "as available", without warranties of any kind.
  6. **Limitation of liability**: to the extent the law allows, the operator is not liable for losses from use of the service or its data, including trading losses.
  7. **Acceptable use and limits**: by default a daily and a per-minute limit per account (100 calls per day and 10 per minute), other limits the operator may set for some accounts, and a global daily cap set by the operator; refusals say when to retry; no bypassing limits (several accounts, shared keys), no bulk copying or resale of the data, no attacks or attempts to access other users' data.
  8. **API keys and your account**: keep keys secret, you are responsible for calls made with them, revoke a leaked key at once; one person per account.
  9. **Suspension and termination**: you may stop at any time and ask for deletion (privacy policy, section 9); the operator may revoke keys or block accounts that break these terms.
  10. **Governing law**: text from owner decision Q1 (default until answered: "These terms do not limit rights you have under mandatory laws where you live." No jurisdiction is named).
  11. **Changes to these terms**: posted here with a new date; continued use means acceptance.
  12. **Contact**: name and mailto link.
- **FR-L05**: The pages MUST contain no script, no inline style and no form, and pass the existing page rules (skip link, `lang="en"`, external stylesheet).
- **FR-L06**: The README MUST state the live MCP address `https://egx-mcp.essawy.workers.dev/mcp` in "Connect from Claude", "Connect from ChatGPT" and "Connect from Cursor", link the home page `https://egx-mcp.essawy.workers.dev/`, and have a "Privacy and terms" section linking `/privacy` and `/terms` on that origin, while keeping the MVP-accurate wording (OAuth sign-in "coming later", API key by header works) and `<PUBLIC_ORIGIN>` for people deploying their own copy.

## Success Criteria

- **SC-L01**: Both pages answer `200` from the Node-pool unit run with an empty `Env`.
- **SC-L02**: Every page built by `page()` links both policies.
- **SC-L03**: No statement on either page contradicts spec 001, data-model.md or the current code.
- **SC-L04**: `npm run typecheck`, the Node-pool unit run and `npm run check:readme` pass.

## Assumptions

Owner answers to the planner questions (Q1 to Q4 in plan.md) use the recommended defaults until the owner says otherwise; each is a one-constant or one-sentence change.
