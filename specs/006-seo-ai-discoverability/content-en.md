# English copy: Search and AI discoverability

This file is the exact English text of the public pages, the summary files and the listing kit. Implementers copy it verbatim into `src/site/identity.ts`, `src/site/tool-catalog.ts` and `src/site/content/en.ts` (data-model.md names the fields). Placeholders in braces are filled at render time from the site context:

| Placeholder | Value |
|---|---|
| `{origin}` | the configured public origin (`resolvePublicOrigin`) |
| `{mcpUrl}` | `mcpUrl(origin)`, for example `https://egx-mcp.essawy.workers.dev/mcp` |
| `{dashboardUrl}` | `{origin}/dashboard` |
| `{toolCount}` | `TOOL_NAMES.length` (30 today) |
| `{userDailyCalls}` | `loadConfig(env).userDailyCalls` (100 today) |
| `{globalDailyCalls}` | `loadConfig(env).globalDailyCalls` formatted with a thousands comma (15,000 today) |
| `{perMinute}` | `RATE_LIMIT_PER_MINUTE` = 10 (equals `wrangler.jsonc` `ratelimits[0].simple.limit`, test guarded) |
| `{maxKeys}` | `MAX_ACTIVE_KEYS` from the API key store (3) |
| `{maxItems}` | `MAX_ITEMS_PER_USER` (50) |

Inline code is written with backticks; the HTML renderer turns each backtick span into `<code>`, the Markdown renderer keeps it.

## 1. Site identity (`SITE` in `src/site/identity.ts`)

| Field | Text |
|---|---|
| `name` | EGX MCP |
| `oneLine` | EGX MCP is a free MCP server that lets AI assistants answer questions about Egyptian Exchange stocks, indices and funds with delayed data. |
| `registryDescription` | Delayed Egyptian Exchange (EGX) stocks, indices, funds, gold and USD/EGP data for AI assistants. |
| `shortDescription` | Free MCP server for Claude, ChatGPT, Claude Code and Cursor: delayed EGX stocks, indices, funds, gold and USD/EGP. Informational only, not advice. |
| `audience` | It is for investors, analysts and developers who want to ask Claude, ChatGPT, Claude Code or Cursor about the Egyptian Exchange in plain English or Arabic. |
| `longDescription` | EGX MCP connects AI assistants to stored Egyptian Exchange data through the Model Context Protocol. It answers questions about EGX stocks, the EGX30, EGX70 and EGX100 indices, Egyptian mutual funds, dividends and company figures, Egyptian gold and silver prices and the USD/EGP rate. Every answer carries the data time, the source and a delayed label. It is free, independent and for information only. |
| `keywords` | EGX, Egyptian Exchange, EGX30, EGX70, Egyptian stocks, Egypt stock market, MCP server, Model Context Protocol, Claude, ChatGPT, Claude Code, Cursor, Egyptian mutual funds, gold price Egypt, USD EGP, البورصة المصرية, الأسهم المصرية |
| `publisherName` | EGX MCP |
| `repositoryUrl` | https://github.com/ahmed-essawy/egx-mcp |
| `issuesUrl` | https://github.com/ahmed-essawy/egx-mcp/issues |
| `registryName` | io.github.ahmed-essawy/egx-mcp |
| `previewImageAlt` | EGX MCP logo with the words Egyptian Exchange data for AI assistants |
| `indexNowKey` | c60c57998197b5e5b4a9fc2f935a3c44 |
| `transportLabel` | Streamable HTTP |
| `signInMethods` | Google sign-in (OAuth) or an API key sent as `Authorization: Bearer <your key>` |
| `dataLimits` | Data is delayed (about 15 minutes during the session), unofficial and for information only. It is not investment advice, and EGX MCP is not affiliated with the Egyptian Exchange. |

`NOTICE` (the existing home notice in `src/http/views.ts`, unchanged) is the delayed-data notice shown at the end of `<main>` on every English content page:
"Data is delayed, unofficial and for information only, not financial advice. Sources: EGX website, TradingView, Mubasher Info, iSagha."

Footer link labels (English, in order): Home, Tools, Connect Claude, Connect ChatGPT, Connect Claude Code, Connect Cursor, Questions, Data and limits, Privacy policy, Terms of use, GitHub. On English pages that have an Arabic version the footer adds a last link "العربية" with `lang="ar"` and `hreflang="ar"` to the Arabic page (Arabic group only).

Breadcrumb label of the home item: Home.

## 2. Page set, titles and descriptions

| id | Path | Title | Description | Breadcrumb label |
|---|---|---|---|---|
| `home` | `/` | EGX MCP: Egyptian Exchange data for AI assistants | Free MCP server for Claude, ChatGPT, Claude Code and Cursor: ask about EGX stocks, indices, funds, gold and USD/EGP. Delayed data, not advice. | Home |
| `tools` | `/tools` | Tool catalog: the {toolCount} EGX MCP tools and what they return | Every EGX MCP tool with a plain description, an example question and what it returns: quotes, indices, history, funds, company data and more. | Tools |
| `connect-claude` | `/connect/claude` | Connect EGX MCP to Claude: custom connector steps | Add EGX MCP to Claude as a custom connector in four steps, with Google sign-in or an API key, and what to do if the connection fails. | Connect Claude |
| `connect-chatgpt` | `/connect/chatgpt` | Connect EGX MCP to ChatGPT: developer mode steps | Add EGX MCP to ChatGPT in developer mode with Google sign-in, ask about Egyptian stocks, and fix the most common connection problems. | Connect ChatGPT |
| `connect-claude-code` | `/connect/claude-code` | Connect EGX MCP to Claude Code: one command setup | Add EGX MCP to Claude Code with one claude mcp add command, sign in with Google or pass an API key header, then check it with /mcp. | Connect Claude Code |
| `connect-cursor` | `/connect/cursor` | Connect EGX MCP to Cursor: mcp.json setup steps | Add EGX MCP to Cursor through mcp.json with the server address and an API key header, reload the MCP list and ask about EGX stocks. | Connect Cursor |
| `faq` | `/faq` | Questions and answers about EGX MCP: data, cost, privacy | Straight answers about EGX MCP: is it free, how delayed the data is, which sources and assistants it uses, privacy, account deletion and advice. | Questions |
| `data` | `/data` | Data sources and limits of EGX MCP: delayed, unofficial | Where EGX MCP data comes from, how late it is, what it covers and what it does not, and the daily limits of the free service. | Data and limits |
| `privacy` | `/privacy` | Privacy policy: EGX MCP | How EGX MCP handles your Google sign-in data, API keys, usage counts, portfolio and price levels, and how to delete your account. | Privacy policy |
| `terms` | `/terms` | Terms of use: EGX MCP | The terms for using EGX MCP: a free service with delayed, unofficial data for information only, fair use limits, and no investment advice. | Terms of use |

Related pages (rendered as a "Related pages" links section at the end of each content page, before the notice):

| id | Related (in order) |
|---|---|
| `tools` | `connect-claude`, `faq`, `data` |
| each `connect-*` | the other three `connect-*` pages, `tools`, `faq` |
| `faq` | `tools`, `data`, `connect-claude` |
| `data` | `faq`, `tools`, `privacy` |

The home page links to every other page in its "Learn more" section; legal pages keep their content and get no related section.

## 3. Home page additions (`home`)

Hero, connect block and notice stay exactly as today. After the connect block and before the notice, two sections:

Section `examples`, heading "Example questions", intro paragraph "Ask your assistant in your own words. For example:", then an unordered list of exactly these 5 items:
1. How did the EGX30 close in the last session?
2. Show the delayed quote for Commercial International Bank (COMI).
3. Which EGX stocks gained the most today, and what time is the data from?
4. What is the gold 21K price per gram in Egypt today?
5. Compare the one-year return of two Egyptian mutual funds.

Section `learn-more`, heading "Learn more", an unordered list of links, label then a short note after a colon:
- Tool catalog: all {toolCount} tools and what they return
- Connect Claude: custom connector steps
- Connect ChatGPT: developer mode steps
- Connect Claude Code: one command
- Connect Cursor: mcp.json setup
- Questions and answers: cost, data, privacy and advice
- Data sources and limits: where the data comes from and how late it is
- Privacy policy
- Terms of use

## 4. Tool catalog (`tools`)

Lead (first paragraph): "EGX MCP gives your assistant {toolCount} tools. Your assistant picks the tool; you ask in plain English or Arabic. Every answer states the data time, the source and that the data is delayed."

Second paragraph: "Symbols can be a ticker, an ISIN, or an Arabic or English name. Tools marked read only never change anything; the personal tools change only your own portfolio and price levels."

Then one section per group (heading = group label), each tool as an `<h3>` with the tool name in code, then three lines: the description (from `TOOL_DESCRIPTIONS`, verbatim), "Ask:" the example, "Returns:" the returns text. Groups and tools in this order:

| Group label | Tool | Example question | Returns |
|---|---|---|---|
| Find and quote | `search` | Which EGX stocks have cement in the name? | Matching stocks and funds with ticker, ISIN and Arabic and English names. |
| Find and quote | `get_quotes` | What are the delayed prices of CIB and Talaat Moustafa? | Price, change, volume and value per stock, with the data time and source. |
| Market today | `get_market_overview` | How is the EGX market doing today? | Index values, advancers and decliners, top movers, most active stocks and totals. |
| Market today | `get_indices` | What are the EGX30 and EGX70 at? | Each index value and change with its data time. |
| Market today | `get_movers` | Which stocks are the top gainers today? | A ranked list for the chosen kind of move, with prices and changes. |
| Market today | `get_52_week_range` | How far is COMI from its 52-week high? | The 52-week high and low with their dates and the distance of the delayed price from each. |
| Market today | `get_sector_performance` | Which sectors did best this month? | Median return, advancers and decliners per sector for the period. |
| Market today | `get_daily_summary` | Give me a summary of the last session. | Closing index values, breadth, top movers and totals of the last completed session. |
| History | `get_price_history` | Show COMI daily prices for the last year, raw and adjusted. | Daily open, high, low, close and volume, paged 500 bars at a time. |
| History | `compare_symbols` | Which did better over 6 months, COMI, ETEL or SWDY? | Return, high, low and total volume per stock from adjusted prices. |
| History | `get_index_history` | How did the EGX30 move week by week over the last year? | Index closes per day, week or month, up to 500 points. |
| History | `get_index_summary` | Compare the EGX30 and EGX70 over 6 months: return, volatility and drawdown. | Latest close, change, period high, low and return, averages, volatility and drawdown per index. |
| Funds | `get_fund` | What is the latest NAV of this fund and how did it do this year? | Latest NAV with its date and returns over 1 month, 3 months, 1 year and year to date. |
| Funds | `get_fund_history` | Show the NAV history of this fund for the last 3 months. | Daily NAVs between two dates, 500 points per page, with the earliest date available. |
| Funds | `compare_funds` | Compare these two funds over the last year against the EGX30. | Return per fund in its own currency for the period, optionally with the EGX30. |
| Funds | `get_real_return` | What was the real return of this fund after inflation since January? | Nominal return, inflation over the period and the real return, with the CPI months used. |
| Company data | `get_company_profile` | Tell me about COMI: sector, shares and first trade date. | Sector, market, shares outstanding, free float and first trade date. |
| Company data | `get_dividends` | Which dividends have ex-dates in the next 90 days? | Cash dividends with ex-date, amount and currency. |
| Company data | `get_corporate_actions` | What corporate actions did COMI have in the last 5 years? | Dividends, bonus shares, splits, rights and other actions with their ex-dates. |
| Company data | `get_financials` | What are COMI's revenue, net income and P/E? | Stored financial figures with period and source, and P/E, P/B and dividend yield with their inputs. |
| Gold and currency | `get_metals` | What is the gold 21K price and the gold pound price in Egypt today? | Egyptian gold and silver buy and sell prices per gram, the gold pound and global spot prices in USD. |
| Gold and currency | `get_usd_egp` | What is the dollar rate in EGP? | The delayed USD to EGP market rate with its data time. |
| Your portfolio and price levels | `portfolio_get` | What is my portfolio worth and how is it split by sector? | Holdings with value and gain, totals, sector allocation and price levels crossed since the last check. |
| Your portfolio and price levels | `portfolio_upsert_holding` | Record that I bought 100 COMI at 95 EGP on 2026-03-01. | The id of the saved holding. |
| Your portfolio and price levels | `portfolio_remove_holding` | Remove my COMI holding. | Whether the holding was removed. |
| Your portfolio and price levels | `price_level_set` | Set a price level for when COMI goes above 100 EGP. | The id of the saved price level. |
| Your portfolio and price levels | `price_level_remove` | Remove my price level for COMI. | Whether the price level was removed. |
| Your portfolio and price levels | `price_levels_list` | Which price levels have I set? | Your price levels with their armed state and last crossing time. |
| Your portfolio and price levels | `what_changed_since` | What changed since yesterday afternoon, including any price levels I crossed? | New fund NAVs, big moves, new listings, corporate actions and your crossed price levels since that time. |
| Owner only | `admin` | As the owner, list the open notices. | Owner maintenance results; every other account gets a forbidden answer. |

Group intro lines (one paragraph under each group heading):
- Find and quote: "Find a stock or fund and get its delayed quote."
- Market today: "The state of the market from the latest delayed snapshot."
- History: "End-of-day prices and index closes, up to 5 years per request."
- Funds: "Egyptian mutual funds with daily NAVs."
- Company data: "Company profiles, dividends, corporate actions and stored figures."
- Gold and currency: "Gold, silver and the dollar rate in Egypt."
- Your portfolio and price levels: "Personal tools that work only on your own data, up to {maxItems} holdings and {maxItems} price levels. EGX MCP never pushes alerts; crossings show when you ask."
- Owner only: "Maintenance for the service owner."

## 5. Connection guides

Each guide: lead paragraph, then section `steps` with the heading below and an ordered list (these steps feed the HowTo structured data verbatim), then section `api-key` (where given), then section `troubleshooting` with heading "If it does not work" and an unordered list.

### `connect-claude`

Lead: "You can add EGX MCP to Claude on the web and in the desktop app as a custom connector. You sign in with Google once; no key is needed."

Steps heading: "Add EGX MCP to Claude"
1. In Claude, open Settings, then Connectors, and choose Add custom connector.
2. Enter the name EGX MCP and the server address `{mcpUrl}`, leave the advanced settings empty, and choose Add.
3. Choose Connect. Sign in with Google, check the app name and the address on the EGX MCP consent page, and approve.
4. In a chat, open the tools menu, turn on EGX MCP and ask "What is the delayed price of COMI?".

Section `api-key`, heading "Use an API key instead": "If your Claude version shows a request headers field for custom connectors, you can connect without signing in: create a key at {dashboardUrl}, then add the header `Authorization` with the value `Bearer <your key>`. The key is shown only once."

Troubleshooting:
- If Claude says it cannot connect, remove the connector, add it again and finish the Google sign-in in the same browser.
- If you see that sign-in is at capacity, try again after 00:00 UTC.
- On Team and Enterprise plans an owner adds the connector first in the organization settings.
- If it keeps failing, open an issue on GitHub with the error text.

### `connect-chatgpt`

Lead: "You can add EGX MCP to ChatGPT on the web as an app in developer mode. You sign in with Google once; no key is needed."

Steps heading: "Add EGX MCP to ChatGPT"
1. In ChatGPT, open Settings, then Apps (called Apps and Connectors on some plans), open Advanced settings and turn on Developer mode.
2. Choose Create app, enter the name EGX MCP and the server address `{mcpUrl}`, and choose OAuth as the sign-in method.
3. Choose Connect. Sign in with Google, check the EGX MCP consent page, and approve.
4. In a chat, turn on EGX MCP from the tools menu and ask "What is the delayed price of COMI?".

Section `api-key`, heading "Use an API key instead": "If your plan cannot use OAuth apps but the form accepts custom headers, create a key at {dashboardUrl} and send it as `Authorization: Bearer <your key>`. The key is shown only once."

Troubleshooting:
- If you cannot find Developer mode, your plan or workspace may not offer it yet; ask your workspace admin.
- If only search and fetch tools appear, turn Developer mode on and add the app again.
- If you see that sign-in is at capacity, try again after 00:00 UTC.
- If it keeps failing, open an issue on GitHub with the error text.

### `connect-claude-code`

Lead: "You can add EGX MCP to Claude Code with one command. Sign in with Google from Claude Code, or pass an API key header."

Steps heading: "Add EGX MCP to Claude Code"
1. In a terminal, run `claude mcp add --transport http egx {mcpUrl}`.
2. Start Claude Code and run `/mcp`, choose egx and choose Authenticate.
3. Sign in with Google in the browser that opens, check the EGX MCP consent page, and approve.
4. Back in Claude Code, ask "What is the delayed price of COMI?".

Section `api-key`, heading "Use an API key instead": "Create a key at {dashboardUrl}, then run `claude mcp add --transport http egx {mcpUrl} --header \"Authorization: Bearer <your key>\"`. The key is shown only once; you can have up to {maxKeys} active keys."

Troubleshooting:
- Run `claude mcp list` to check that egx is listed and connected.
- If a call says unauthorized after you revoke a key, wait up to 2 minutes and use a new key.
- If it keeps failing, open an issue on GitHub with the error text.

### `connect-cursor`

Lead: "You can add EGX MCP to Cursor in its mcp.json file with the server address and an API key header."

Steps heading: "Add EGX MCP to Cursor"
1. Open {dashboardUrl}, sign in with Google and create a key with a name. Copy it now; it is shown only once.
2. Open Cursor's mcp.json (the project file `.cursor/mcp.json` or your user file) and add the egx server shown below.
3. Restart Cursor or reload the MCP servers list; the egx server shows its tools.
4. In the chat, ask "What is the delayed price of COMI?".

Code block after the steps (Markdown fenced `json`, HTML `<pre><code>`):
```json
{
  "mcpServers": {
    "egx": {
      "url": "{mcpUrl}",
      "headers": {
        "Authorization": "Bearer <your key>"
      }
    }
  }
}
```

No `api-key` section.

Troubleshooting:
- If the server shows no tools, check the address ends in /mcp and the key starts with egx_.
- If a call says unauthorized after you revoke a key, wait up to 2 minutes and use a new key.
- If it keeps failing, open an issue on GitHub with the error text.

## 6. Questions and answers (`faq`)

Lead: "Short, direct answers about EGX MCP. Each answer stands on its own."

Each pair is an `<h2>` question and one paragraph answer (FAQPage structured data uses the same text). In this order:

1. **What is EGX MCP?** EGX MCP is a free MCP server that lets AI assistants answer questions about Egyptian Exchange stocks, indices and funds with delayed data. You connect it once to Claude, ChatGPT, Claude Code or Cursor and then ask in plain English or Arabic.
2. **Is EGX MCP free?** Yes. EGX MCP is free and has no ads. It runs on free hosting with daily limits, so when a limit is reached requests are refused until the next day instead of being charged.
3. **Is the data real-time?** No. Stock and index data is delayed by about 15 minutes during the session, fund NAVs are daily values, and every answer states the data time and that the data is delayed.
4. **Where does the data come from?** From free public sources: the EGX website when it is reachable, TradingView, Mubasher Info, iSagha for Egyptian gold and silver, and fund managers' own sites. The sources are unofficial and the Egyptian Exchange has not given permission to redistribute the data.
5. **Which AI assistants work with EGX MCP?** Claude (web and desktop, as a custom connector), ChatGPT (developer mode apps), Claude Code and Cursor. Any client that supports remote MCP servers over Streamable HTTP with OAuth or a bearer header can connect.
6. **How do I connect my assistant?** Add the server address {mcpUrl} in your assistant's connector or MCP settings and sign in with Google, or send an API key header. Each connection guide on this site has numbered steps.
7. **Do I need an API key?** Not for Claude or ChatGPT, which sign in with Google. Claude Code can do either, and Cursor uses a key. You create keys after signing in at {dashboardUrl}; each key is shown once and you can have up to {maxKeys} active keys.
8. **Does EGX MCP give investment advice?** No. EGX MCP reports and computes facts such as prices, returns and ratios. It never gives a buy, sell or hold recommendation, and nothing it returns is financial advice.
9. **Is EGX MCP affiliated with the Egyptian Exchange?** No. EGX MCP is an independent service and is not affiliated with, endorsed by or sponsored by the Egyptian Exchange.
10. **What can I ask?** Questions about stock quotes, indices, market movers, sectors, price history, mutual funds, dividends, corporate actions, company figures, gold and silver prices in Egypt and the dollar rate, plus your own portfolio and price levels. The tool catalog lists every tool with an example.
11. **How is my data kept private?** EGX MCP receives only the tool calls your assistant makes, not the questions you type, and does not store tool arguments. It keeps your Google account identifier, email and name, your API key hashes, daily call counts per tool, and any holdings and price levels you save, which only you can see. There are no trackers or third-party scripts.
12. **How do I delete my account?** Sign in at {dashboardUrl} and use Delete account. It removes your account, keys, holdings, price levels and usage records and revokes your assistant connections.
13. **How is this different from asking an assistant to search the web?** Web search returns pages that may be old or about other markets. EGX MCP returns stored EGX figures with the data time, the source and a delayed label in every answer, so your assistant can quote numbers together with their age.
14. **What are the usage limits?** Each account can make {userDailyCalls} tool calls per day and {perMinute} per minute, and all users together share {globalDailyCalls} calls per day. Limits reset at 00:00 UTC.
15. **Does it cover mutual funds, gold and the dollar rate?** Yes. It covers Egyptian mutual funds listed by Mubasher with daily NAVs, Egyptian gold and silver prices per gram, the gold pound, global gold and silver in USD and the USD/EGP market rate.
16. **What happens when the service is at capacity?** Calls are refused with a message that says when to try again, usually after 00:00 UTC. Nothing is billed, because the service runs only on free hosting.
17. **Is the source code public?** Yes. The code is on GitHub at {repositoryUrl}, where you can also report problems through the issues page.

## 7. Data sources and limits (`data`)

Lead: "EGX MCP serves stored, delayed data from free public sources. It is unofficial and for information only."

Section `sources`, heading "Where the data comes from", a table with header "Source | What it provides":
| EGX website | Stock quotes, used only while it is reachable and verified. |
| TradingView | Delayed stock quotes (about 15 minutes), index values, the USD/EGP market rate and global gold and silver prices. |
| Mubasher Info | Backup stock quotes, the listing directory with Arabic names and sectors, mutual funds and NAVs, corporate actions and price history. |
| iSagha | Egyptian gold and silver prices per gram and the gold pound. |
| Fund managers' own sites | Fund NAVs when Mubasher does not have them. |
Then the paragraph: "These sources are free but unofficial, and the Egyptian Exchange has not given permission to redistribute the data. Check an official source before acting."

Section `freshness`, heading "How late the data is", unordered list:
- Stock and index snapshots are refreshed about every minute during the EGX session, Sunday to Thursday, and are delayed by about 15 minutes.
- End-of-day prices, index closes and fund NAVs are added once per day.
- Every answer states the data time, the source and that the data is delayed.

Section `coverage`, heading "What it covers", unordered list:
- Every active EGX stock in the directory, by ticker, ISIN, or Arabic or English name.
- The EGX30, EGX30 Capped, EGX70 EWI and EGX100 EWI indices.
- Egyptian mutual funds with daily NAVs.
- Gold 18K, 21K and 24K, the gold pound and silver 925 and 999 in Egypt, global gold and silver in USD, and the USD/EGP rate.
- Dividends, corporate actions and stored company figures.

Section `not-covered`, heading "What it does not do", unordered list:
- It is not real-time and stores no tick data.
- It never pushes alerts; price level crossings show when you ask.
- It gives no investment advice and no buy, sell or hold recommendation.
- It does not show live prices on this website; prices are answered only through your assistant.

Section `limits`, heading "Limits of the free service", unordered list:
- {userDailyCalls} tool calls per account per day and {perMinute} per minute.
- {globalDailyCalls} tool calls per day for all users together; when reached, calls are refused until 00:00 UTC.
- Up to {maxKeys} active API keys and up to {maxItems} holdings and {maxItems} price levels per account.

## 8. Summary file text

`/llms.txt` paragraph after the blockquote (one paragraph, then a blank line, then `Last updated: {date}`):
"{audience} Server address: {mcpUrl}. Transport: {transportLabel}. Sign-in: {signInMethods}. {dataLimits}"

H2 labels: `Pages`, `Tools`, `Arabic`, `Optional`. Optional items: Privacy policy, Terms of use, Full content (`/llms-full.txt`: "Every page, the tool list and the questions and answers in one file"), MCP server card (`/mcp/server-card`: "Machine-readable server address, transport and sign-in"), AI catalog (`/.well-known/ai-catalog.json`).

`/llms-full.txt` starts with the same H1, blockquote, paragraph and date, then each page as `# {title}` followed by `Source: {canonical url}`, `Last updated: {updated}` and the page Markdown body.

## 9. Content rules (test guarded, `tests/unit/site-content.test.ts`)

Banned patterns (case insensitive) on every public HTML page, Markdown twin, summary file and discovery file, after removing the allowed phrases below: `real[- ]?time`, `\bbuy\b`, `\bsell\b`, `\bhold\b`, `recommend`, `endorsed by`, `\bofficial (data|source|partner|feed)`, `live price`, `affiliated with`. The check covers the legal pages too (their current text passes with this list).

Allowed phrases, removed before the check (exact, case sensitive):
- "Is the data real-time?"
- "Is EGX MCP affiliated with the Egyptian Exchange?"
- "It is not real-time"
- "not real-time"
- "buy, sell or hold recommendation"
- "buy and sell prices"
- "bought"
- "not affiliated with, endorsed by or sponsored by the Egyptian Exchange"
- "not affiliated with the Egyptian Exchange"
- "It does not show live prices on this website"
- "Check an official source before acting"

Arabic banned patterns (on Arabic pages): `لحظي`, `فوري`, `توصية`, `اشترِ`, `بِع`, `احتفظ`, `تابع(ة|ون)? للبورصة`; Arabic allowed phrases are listed in arabic-copy.md section 9.
