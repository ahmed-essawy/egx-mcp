# EGX MCP Server

An MCP (Model Context Protocol) server that gives AI assistants read access to Egyptian Exchange (EGX) market data: stock quotes, indices, gold, silver and the dollar rate today, with price history, index history, funds, dividends and financial figures. It runs as one Cloudflare Worker on the free tier. Anyone with a Google account can sign in, create an API key and use it from Claude (custom connector), Claude Code, ChatGPT or Cursor.

Status: the MVP runs at <https://egx-mcp.essawy.workers.dev/> (see also the [privacy policy](https://egx-mcp.essawy.workers.dev/privacy) and the [terms of use](https://egx-mcp.essawy.workers.dev/terms)), and no permission from EGX or EGID to share the data has been obtained yet. See [Data sources and limits](#data-sources-and-limits).

Current build: 30 tools are enabled (`search`, `get_quotes`, `get_market_overview`, `get_indices`, `get_index_history`, `get_index_summary`, `get_price_history`, `compare_symbols`, `get_movers`, `get_52_week_range`, `get_sector_performance`, `get_daily_summary`, `get_fund`, `get_fund_history`, `compare_funds`, `get_real_return`, `get_company_profile`, `get_dividends`, `get_corporate_actions`, `get_financials`, `get_metals`, `get_usd_egp`, `portfolio_get`, `portfolio_upsert_holding`, `portfolio_remove_holding`, `price_level_set`, `price_level_remove`, `price_levels_list`, `what_changed_since` and `admin`). You can connect with an API key from the dashboard or sign in with Google from Claude and ChatGPT. The `admin` tool is for the owner only. The only part of this guide that describes later work is the `egx` stock source, marked "(coming later)".

## Overview

The server publishes its home page at <https://egx-mcp.essawy.workers.dev/>.

What the server does:

- Answers questions about EGX stocks and EGX indices. Gold and silver prices in Egypt and worldwide and the USD/EGP rate are available. Index history and summaries (return, volatility and drawdown), mutual funds, dividends and corporate actions, and company financial figures are available.
- Keeps a personal portfolio and price levels for each signed-in user, and reports what changed since a given time.
- Gives the owner an `admin` tool for notices, the holiday table, inflation figures and corporate action ratios.

Data coverage:

- Stocks: every active EGX symbol in the server directory (ticker, ISIN, Arabic or English name all work as input), with delayed quotes during the session (with end-of-day price history).
- Indices: EGX30, EGX30CAPPED, EGX70EWI and EGX100EWI, with end-of-day history that grows from the day the server starts collecting (EGX30 also has a backfilled history). EGX30USD is reported as not available unless a source supplies it.
- Funds: Egyptian funds listed by Mubasher, with daily NAV history that grows from the day the server starts collecting.
- Metals and currency: Egypt gold (18K, 21K, 24K) and silver (925, 999) buy and sell prices per gram, global gold and silver in USD per ounce, the gold pound, and the USD/EGP market rate.

Important notice:

- All market data is delayed (about 15 minutes during the session) and unofficial.
- All data is informational only. It is not investment advice, and the server never tells you to buy, sell or hold.
- Every answer carries a label, the data time, the source and a notice saying so.

## Data sources and limits

| Source | What it provides |
|---|---|
| EGX website (www.egx.com.eg) | Intended first choice for stock quotes. Not reachable from the owner's desktop during research (every connection was reset), so it is used only if a probe from the deployed Worker succeeds. |
| TradingView scanner | Delayed stock quotes (15 minutes), ISIN, index values and the share counts used by the symbol directory sync. It also supplies the USD/EGP market rate and global gold and silver in USD per ounce. |
| Mubasher | Backup stock quotes, listing master, Arabic names and sector, funds and NAVs, corporate action events, the history files and the EGX 30 index history backfill. The end-of-day symbol directory sync needs both TradingView and Mubasher: if either fails, the directory is not updated. |
| iSagha | Egypt gold and silver buy and sell prices per gram, and the gold pound. The page has no timestamp, so the data time is the fetch time. |
| Owner-entered | Monthly inflation (CAPMAS urban CPI) and bonus, split and reverse split ratios, entered with the `admin` tool. |

The order of stock sources is the `STOCK_PROVIDERS` setting (default `tradingview,mubasher`): TradingView is the primary source and Mubasher the backup. When TradingView fails, returns nothing or returns old data, Mubasher serves, the answer names the source actually used and a `source_switched` notice is raised. The `egx` source is accepted by the setting but is not built yet (coming later) and this build ignores it.

Known gaps (from the research notes, R3). These are reported as not available, or labeled, until a source is found:

- Investor statistics by investor type (only the EGX website has them).
- EGX30 in USD.
- Disclosures in `what_changed_since`.
- Company listing date and index membership (`indexCodes` stays empty).
- Fund NAV history before the server started collecting, and fund comparisons against EGX30 before index history exists.
- Bonus and split ratios: the sources give the event and dates but not the ratio, so the owner must enter each ratio. Until then, price history is labeled `adjustmentPending` or `rawPending`.

Permission: EGX and EGID have not yet given permission to share this data. The server serves data from the sources above to any signed-in user until that changes. Seeking permission, or moving to a licensed feed, is an open owner task.

## Connect from Claude

The server address is `https://egx-mcp.essawy.workers.dev` and the MCP address is `https://egx-mcp.essawy.workers.dev/mcp`. If you deploy your own copy, use your own address (`<PUBLIC_ORIGIN>`) instead, see [Install and deploy from a clean Windows machine](#install-and-deploy-from-a-clean-windows-machine).

Claude custom connectors work with sign-in with Google (see the end of this section) or with an API key. With a key, the connector sends it in a request header:

1. Open <https://egx-mcp.essawy.workers.dev/dashboard> in a browser and sign in with Google.
2. Create a key with a name. The full key (it starts with `egx_`) is shown once. Copy it now; after you reload, only its prefix remains. You can have up to 3 active keys, and you can revoke a key on the same page.
3. In Claude, open the connectors settings and choose to add a custom connector.
4. Enter a name (for example `EGX`) and the address `https://egx-mcp.essawy.workers.dev/mcp`. Choose no sign-in, then in the request headers field add `Authorization` with the value `Bearer <your key>`, and save.
5. Start a chat, enable the connector, and ask "What is the price of CIB?".

Claude Code sends the same header:

```text
claude mcp add --transport http egx https://egx-mcp.essawy.workers.dev/mcp --header "Authorization: Bearer <your key>"
```

To sign in with Google instead (no key needed), add the custom connector with the address `https://egx-mcp.essawy.workers.dev/mcp` and leave the sign-in settings empty. Claude registers itself at `/register`, opens a Google sign-in and a consent page, and then connects.

## Connect from ChatGPT

1. In ChatGPT, open the settings for connectors and enable developer mode if your plan requires it.
2. Add a new connector and enter `https://egx-mcp.essawy.workers.dev/mcp` as the server address. Choose OAuth as the sign-in method if asked.
3. Choose to connect. Sign in with your Google account, read the consent page and approve.
4. In a chat, enable the connector and ask "What is the price of CIB?".

If your ChatGPT plan cannot use OAuth connectors, create an API key at `https://egx-mcp.essawy.workers.dev/dashboard` (sign in with Google, create a key, copy it once) and use it as a bearer token where the connector form allows custom headers.

## Connect from Cursor

1. Open `https://egx-mcp.essawy.workers.dev/dashboard` in a browser and sign in with Google.
2. Create a key with a name and copy it. It is shown once.
3. Open Cursor's `mcp.json` (project `.cursor/mcp.json` or your user-level file) and add:

```json
{
  "mcpServers": {
    "egx": {
      "url": "https://egx-mcp.essawy.workers.dev/mcp",
      "headers": {
        "Authorization": "Bearer <your key>"
      }
    }
  }
}
```

4. Restart Cursor or reload the MCP servers list. The `egx` server should show its tools.
5. In the chat, ask "What is the price of CIB?".

If a client reports `unauthorized` after you revoke a key, wait up to 2 minutes and use a new key.

## Tools

The server provides 30 tools: `search`, `get_quotes`, `get_market_overview`, `get_indices`, `get_index_history`, `get_index_summary`, `get_price_history`, `compare_symbols`, `get_movers`, `get_52_week_range`, `get_sector_performance`, `get_daily_summary`, `get_fund`, `get_fund_history`, `compare_funds`, `get_real_return`, `get_company_profile`, `get_dividends`, `get_corporate_actions`, `get_financials`, `get_metals`, `get_usd_egp`, `portfolio_get`, `portfolio_upsert_holding`, `portfolio_remove_holding`, `price_level_set`, `price_level_remove`, `price_levels_list`, `what_changed_since` and `admin`.

Symbols can be given as a ticker, an ISIN, or an Arabic or English name. Index names accept the short aliases `EGX70` (meaning `EGX70EWI`) and `EGX100` (meaning `EGX100EWI`).

| Tool | Example question |
|---|---|
| `search` | "Which stocks have cement in the name?" |
| `get_quotes` | "What is the price of CIB and Talaat Moustafa?" |
| `get_market_overview` | "How is the market doing right now?" |
| `get_indices` | "What are EGX30 and EGX70 at?" |
| `get_index_history` | "How did EGX30 move week by week over the last year?" |
| `get_index_summary` | "Compare EGX30 and EGX70 over 6 months: return, volatility and drawdown?" |
| `get_price_history` | "Show me COMI daily prices for the last year, raw and adjusted?" |
| `compare_symbols` | "Which did better over 6 months, COMI, ETEL or SWDY?" |
| `get_movers` | "Which stocks are the top gainers today?" |
| `get_52_week_range` | "How far is COMI from its 52-week high?" |
| `get_sector_performance` | "Which sectors did best this month?" |
| `get_daily_summary` | "Give me a summary of the last session?" |
| `get_fund` | "What is the latest NAV of this fund and how did it do this year?" |
| `get_fund_history` | "Show the NAV history of this fund for the last 3 months?" |
| `compare_funds` | "Compare these two funds over the last year against EGX30?" |
| `get_real_return` | "What was the real return of this fund after inflation since January?" |
| `get_company_profile` | "Tell me about COMI: sector, shares and first trade date?" |
| `get_dividends` | "Which dividends have ex dates in the next 90 days?" |
| `get_corporate_actions` | "What corporate actions did COMI have in the last 5 years?" |
| `get_financials` | "What are COMI's revenue, net income and P/E?" |
| `get_metals` | "What is the gold 21K price and the gold pound price in Egypt today?" |
| `get_usd_egp` | "What is the dollar rate in EGP now?" |
| `portfolio_get` | "What is my portfolio worth and how is it allocated by sector?" |
| `portfolio_upsert_holding` | "Can you record that I bought 100 COMI at 95 EGP on 2026-03-01?" |
| `portfolio_remove_holding` | "Can you remove my COMI holding from my portfolio?" |
| `price_level_set` | "Can you set a price level for when COMI goes above 100 EGP?" |
| `price_level_remove` | "Can you remove my price level for COMI?" |
| `price_levels_list` | "Which price levels have I set?" |
| `what_changed_since` | "What changed since yesterday afternoon, including any price levels crossed?" |
| `admin` | "As the owner, list the open notices?" |

The server never pushes alerts. Crossings show in `what_changed_since`, `portfolio_get` and `price_levels_list` when you ask.

Portfolio and price level data belongs to the signed-in user only. The `admin` tool works only for the Google emails listed in `OWNER_EMAILS`; everyone else gets `forbidden`.

## Limits and fair use

The service runs only on free hosting with no payment method, so reaching a limit causes a refusal, never a bill.

- Per user (shared by all of that user's API keys and sign-ins): 100 calls per day (`USER_DAILY_CALLS`) and 10 calls per minute.
- Global daily cap for all users together: 15,000 calls per day (`GLOBAL_DAILY_CALLS`), plus a cap on database rows read. When a cap is reached, calls are refused until 00:00 UTC, even for users on the unlimited list.
- Users whose Google email is in `UNLIMITED_EMAILS` skip the per-user limits, but not the global caps.
- Sign-ups are also protected by the OAuth guard: sign-in storage writes are capped at 600 per day (`OAUTH_DAILY_KV_WRITES`, about 100 first sign-ins per day). When that budget is used up, new sign-ins get a `503` with a `Retry-After` header until 00:00 UTC.

Retry messages tell you when to try again:

- Per-minute limit: "Rate limit reached. Retry at <time>." where the time is one minute ahead.
- Per-day limit: "Rate limit reached. Retry at <time>." where the time is the next 00:00 UTC.
- Global cap: "The free service is at capacity until 00:00 UTC."

The limits are settings in `wrangler.jsonc` (or the Cloudflare dashboard). Changing them needs no code change.

Sign-in endpoints at the edge (recommended owner action): the OAuth guard lets each IP address make 10 guarded requests per minute to `/token`, `/register`, `/authorize` and `/callback/google`, so one address can still pass about 14,400 guarded requests a day. To stop bursts before they reach the Worker, add a Cloudflare WAF rate limiting rule that counts by IP with the expression `http.request.uri.path in {"/token" "/register" "/authorize" "/callback/google"}`. The Free plan allows one such rule, with a 10 second counting period and a 10 second block, so it cuts bursts but sets no daily cap. WAF rules apply only when the Worker is served from a custom domain or route on a Cloudflare zone, not on `workers.dev`.

## Install and deploy from a clean Windows machine

Prerequisites:

- Windows 11.
- Node.js 24 LTS.
- Git.
- A free Cloudflare account with no payment method attached.
- A Google Cloud OAuth client of type web application. Its authorized redirect URIs are `https://<worker host>/callback/google` and `https://<worker host>/dashboard/callback` for the deployed Worker, and `http://localhost:8787/callback/google` and `http://localhost:8787/dashboard/callback` for local runs. Keep the client id and client secret.
- An MCP client (Claude, ChatGPT, Cursor, or MCP Inspector with `npx @modelcontextprotocol/inspector`).

Steps (run them in a terminal in the cloned folder):

1. Clone the repository: `git clone <repository URL>` and `cd` into it. The repository URL comes from wherever the owner hosts the code.
2. Install packages: `npm ci`
3. Generate the Worker types: `npm run types`
4. Log in to Cloudflare: `npx wrangler login`
5. Create the database and both key-value stores:

   ```text
   npx wrangler d1 create egx
   npx wrangler kv namespace create DATA
   npx wrangler kv namespace create OAUTH_KV
   ```

   Each command prints an id. Paste them into `wrangler.jsonc`: the database id as `database_id` in the `DB` entry of `d1_databases`, and each namespace id as `id` in the matching `kv_namespaces` entry (`DATA`, `OAUTH_KV`).
6. Store the secrets (each command asks for the value):

   ```text
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   npx wrangler secret put SESSION_SECRET
   npx wrangler secret put OWNER_EMAILS
   npx wrangler secret put UNLIMITED_EMAILS
   ```

   `GOOGLE_CLIENT_SECRET` comes from your Google OAuth client. `SESSION_SECRET` is a long random string you make up. `OWNER_EMAILS` is your Google email (comma separated for several) and `UNLIMITED_EMAILS` lists users who skip the per-user limits (comma separated, optional). A missing secret is an empty list: nobody is an owner, so the `admin` tool refuses everyone, and nobody is unlimited. For local runs copy `.dev.vars.example` to `.dev.vars` and fill in the four values. These two used to be `vars` in `wrangler.jsonc` and are removed there. On an existing deployment the live plain-text vars are kept by `keep_vars`, so deploying does not remove them and they stay on the Worker, and admin and unlimited access keep working until you act. After the deploy, in the dashboard (Settings, Variables and Secrets) edit each of the two variables and change its type to Secret, or delete the two variables there first, before or instead of `wrangler secret put`, which fails on a same-name binding. The Google client id is not a secret: it is `GOOGLE_CLIENT_ID` in the `vars` of `wrangler.jsonc` (step 7). Do not also create a secret with that name, because a secret and a var with the same name conflict. If you deployed before `GOOGLE_CLIENT_ID` became a var, run `npx wrangler secret delete GOOGLE_CLIENT_ID` once before `npm run deploy`.
7. Set your own values in the `vars` of `wrangler.jsonc`: `GOOGLE_CLIENT_ID` (the client id of your own Google OAuth client, replacing the one in the file), and `PUBLIC_ORIGIN` (the Worker address, for example `https://<worker name>.<your workers subdomain>.workers.dev`; you learn the exact address after the first deploy, so set it and deploy again).
8. Create the tables, locally and then remotely:

   ```text
   npx wrangler d1 migrations apply egx --local
   npx wrangler d1 migrations apply egx --remote
   ```

9. Check the project: `npm run typecheck` and `npm test`.
10. Run it locally: `npm run dev`. To trigger a job by hand while it runs, open `http://localhost:8787/__scheduled?cron=<cron with spaces as +>`. The snapshot job is `cron=*+6-13+*+*+SUN-THU`. It writes data only during the Cairo session window (09:55 to 14:45, Sunday to Thursday), and on a fresh install its first tick builds the symbol list (the listing bootstrap) before it writes quotes. So trigger it on a trading day inside the window, and quotes appear from that first in-window tick. The end-of-day job (`cron=30+12,13,14+*+*+SUN-THU`, 15:30 Cairo time or later) also builds the symbol list. For local sign-in, put the secrets and `PUBLIC_ORIGIN=http://localhost:8787` in a `.dev.vars` file (it is not committed). Without `PUBLIC_ORIGIN` the dashboard is unavailable.
11. Load the historical data. This needs the symbols to exist, which one snapshot tick or one end-of-day run provides. Validate first, then load corporate actions, then the prices, and re-run the last command on later days until it finishes (a daily row budget limits how much is loaded per day):

    ```text
    npm run backfill -- --validate
    npm run backfill -- --actions --years 5
    npm run backfill -- --years 5
    ```

    The `--validate` run compares the newest stored close of each symbol with the source file and lists symbols that differ by more than 0.5 percent; only the symbols that pass are loaded. Importing a file locks the database, so loading actions and prices refuses to run during the EGX session (Sunday to Thursday, 10:00 to 14:30 Cairo time); run it after 14:30, or pass `--during-session` to run it anyway.
12. Deploy: `npm run deploy`. Wrangler prints the Worker address. Put it in `PUBLIC_ORIGIN`, add its two redirect URIs to the Google OAuth client, and run `npm run deploy` again.
13. Make the first tool call: open `<PUBLIC_ORIGIN>/dashboard`, sign in, create a key, connect a client as described above and ask "What is the price of CIB?". On a fresh deploy the first snapshot tick on a trading day builds the symbol list, and quotes appear from the first tick inside the session window.

Holiday table maintenance: the server skips dates marked as holidays and uses special hours (for example Ramadan) from a table you maintain. Ask the `admin` tool, for example:

- `set_calendar_day` with `date`, `kind` `holiday` and a `note`.
- `set_calendar_day` with `kind` `special_hours`, `openTime` and `closeTime`.
- `list_calendar` with `from` and `to`, and `remove_calendar_day` with `date`.

A holiday missing from the table is detected automatically when no trades happen, and the day is reported as closed.

Update and rollback:

1. To update: pull the new code, run `npm ci`, `npx wrangler d1 migrations apply egx --remote` if there are new migrations, then `npm run deploy`. If you deployed before `GOOGLE_CLIENT_ID` became a var, run `npx wrangler secret delete GOOGLE_CLIENT_ID` once before `npm run deploy`.
2. To see recent versions: `npx wrangler deployments list`
3. To go back to the previous version: `npx wrangler rollback`

## Owner tasks

Index history load (one time, after the first deploy, from your own machine, not through the `admin` tool):

1. Run `npm run backfill:indices`. It writes `scripts/backfill/out/index-history-EGX30.sql`.
2. Load it: `npx wrangler d1 execute egx --remote --file "scripts/backfill/out/index-history-EGX30.sql"`.
3. Deploy `scripts/probe` and record the `getIndexChartData` result in research R1 of `specs/004-market-data-extensions/research.md`.

The owner is anyone whose Google email is in `OWNER_EMAILS`. All of the tasks below use the `admin` tool from an MCP client.

Notices: the server raises a notice when something needs attention (a new listing, a failed job, a ratio needed, a stale fund, a source switch). Read them with `list_notices` (status `open` by default) and close them with `mark_notice_done` and their `ids`. Check them regularly.

Corporate action ratios: for bonus, split and reverse split events the sources give no ratio, so the action waits with status `needs_ratio` and a notice. Set it with `set_action_ratio` (`actionId`, `ratio`). The ratio is the number of shares held after per share held before, except for bonus, where it is the bonus shares received per share held. The allowed range depends on the kind:

| Kind | Valid ratio | Example |
|---|---|---|
| Bonus | above 0 up to 10 | "1 bonus share for every 4 held" is `0.25` |
| Split | above 1 | a 2 for 1 split is `2` |
| Reverse split | between 0 and 1 | a 1 for 10 reverse split is `0.1` |

Any other value is refused as `invalid_input`. The definition and the full action list are in [contracts/admin-tool.md](specs/001-egx-mcp-server/contracts/admin-tool.md).

Correcting a wrong ratio: if you applied a wrong ratio, run `revert_action` for that `actionId` (it restores the prices and sets the action back to `needs_ratio`), then run `set_action_ratio` again with the right value. Do not edit the database by hand.

Refused applies: `set_action_ratio` and `add_corporate_action` return `status`, `rowsAdjusted` and `refusedReason`. When the apply is refused, the action stays `recorded` and the end-of-day job retries it. The reasons are:

- `ex_date_not_reached`: the ex date is after the latest stored session. It applies by itself after the end-of-day run on the ex date.
- `backfill_loading`: the symbol's history is still being loaded by the backfill. Finish the backfill for that symbol first.
- `daily_cap`: today's limit on adjusted rows is used up. Try again after 00:00 UTC.

Draining the queue: run `apply_queued_actions` (optional `limit` 1 to 3) to apply the oldest waiting actions now. It returns the applied actions and how many remain.

Inflation: real return needs monthly inflation. Enter each month with `set_inflation` (`month` as `YYYY-MM`, `cpiIndex`, `yoyPct`, `source`), using the CAPMAS monthly urban CPI. Without the months in a range, `get_real_return` answers `not_available`.

Other admin actions: `list_discrepancies` (stock prices that differ between sources), `usage_summary` (today's global usage and the top users), and `activate_symbol` (turn a newly found `pending` symbol into `active`).

## Troubleshooting

| Symptom | Cause | Recovery |
|---|---|---|
| Answers say the data is stale, or a quote has `stale: true` | The symbol's last trade is older than the last completed session (for example it is suspended), or a refresh job failed and the last stored data is being served. | Check the `dataTime` and `source` in the answer. Notices can be read with the `admin` tool (`list_notices`). `npx wrangler tail` shows thrown errors only, not job results. The data refreshes at the next job run. |
| Source outage: answers come from a different source, or a tool returns `not_available` | A source is down or changed its format. The server keeps the last stored data and raises one `job_failed` notice per job, source and day, and a `source_switched` notice when a backup served (notices can be read with the `admin` tool). With the default `STOCK_PROVIDERS` Mubasher backs up TradingView; if both fail, answers keep the last stored data. | Nothing is lost. If a source stays broken for days, check whether its page or API changed. |
| Blocked requests: a source works from your desktop but not from the Worker, or the opposite | The source blocks the Cloudflare network or your location (the EGX website did this during research). | The default `STOCK_PROVIDERS` (`tradingview,mubasher`) already falls back to the other source. `wrangler.jsonc` keeps `keep_vars` on, so a value edited in the Cloudflare dashboard overrides the file on deploy: after a deploy, check that `STOCK_PROVIDERS` still reads `tradingview,mubasher` there. If a source stays blocked, check it for a change and keep `STOCK_PROVIDERS` on a source that works. The Worker also keeps serving stored data meanwhile. |
| `capacity` error: "The free service is at capacity until 00:00 UTC." | The global daily cap is reached. This protects the free tier. | Wait until 00:00 UTC. The owner can raise `GLOBAL_DAILY_CALLS` in `wrangler.jsonc` only while it stays within the free limits. Sign-in has its own cap (`OAUTH_DAILY_KV_WRITES`) behind a per-IP limit that slows one address but does not stop a determined day-long attack, so add a Cloudflare WAF rate limiting rule on `/token`, `/register` and `/authorize` if you see abuse. |
| `rate_limited` error | You passed 10 calls per minute or 100 per day. | Retry at the time in the message. The owner can raise `USER_DAILY_CALLS` or list a user in the `UNLIMITED_EMAILS` secret. |
| Sign-in fails (error page, `503`, or returned to the client without access) | The Google OAuth client is missing a redirect URI, the secrets are wrong, `PUBLIC_ORIGIN` is not the Worker address, or the daily sign-in storage budget is used up (`503` with `Retry-After`). | Check the redirect URIs in the Google client against `<PUBLIC_ORIGIN>`, re-run `npx wrangler secret put` for the secrets, check `PUBLIC_ORIGIN`, and retry after the `Retry-After` time. |
| `unauthorized` | The key was revoked or mistyped, or the account was deleted. | Create a new key at `https://egx-mcp.essawy.workers.dev/dashboard`. A revoked key stops working within 2 minutes. |
| `forbidden` on `admin` | Your Google email is not in `OWNER_EMAILS`. | Add it to the `OWNER_EMAILS` secret (`npx wrangler secret put OWNER_EMAILS`). |
| Every request fails with a `500`, and the snapshot job throws `invalid config: <name>` during the session window | A value in `wrangler.jsonc` `vars` is invalid, or the combination of caps goes over the free limits (the name `rows written budget` means lowering `GLOBAL_DAILY_CALLS`, `ADJUST_MAX_ROWS_PER_DAY` or `PERSONAL_DAILY_ROWS`). The server checks this on each request, not at start. An invalid `PUBLIC_ORIGIN` (for example without `https://`) also gives a `500` on every request, with nothing logged. | Read the name in the error (`wrangler tail` shows it), correct that value in `wrangler.jsonc` and deploy again. For `PUBLIC_ORIGIN`, set the full address with `https://`. |

## Privacy and terms

The server publishes its privacy policy at <https://egx-mcp.essawy.workers.dev/privacy> and its terms of use at <https://egx-mcp.essawy.workers.dev/terms>. For account deletion, write to ahm.elessawy@gmail.com.
