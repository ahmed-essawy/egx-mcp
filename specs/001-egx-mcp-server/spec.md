# Feature Specification: EGX MCP Server

**Feature Branch**: `001-egx-mcp-server` (repository `https://github.com/ahmed-essawy/egx-mcp.git`, default branch `main`)

**Created**: 2026-10-25

**Status**: Draft

**Input**: User description: "EGX MCP Server: a public, open-source MCP server that gives AI clients (Claude, ChatGPT, Cursor) one place for Egyptian Exchange (EGX) stocks, indices, Egyptian mutual funds and related Egyptian market data, hosted on Cloudflare Workers at near-zero cost." The full description, including data source research from 2026-10-25, capabilities, out-of-scope items, documentation and success goals, was supplied in the `/speckit-specify` command and is reflected below.

## Clarifications

### Session 2026-10-25

- Q: Which capabilities must be in the first working release? → A: Everything in the spec (Stories 1 to 10) ships in one release. Priorities set build order only. Capabilities that need a source not yet confirmed still depend on that source being found.
- Q: How should the server notify the owner about new listings and failed data jobs? → A: No push. Notices are stored and returned by an owner-only admin tool when asked.
- Q: Should the server keep watchlists? → A: No. Watchlists and the watchlist digest are removed; the portfolio and price levels remain.
- Q: How many years of daily price history should the one-time backfill load? → A: 5 years for every stock, then history grows from daily updates.
- Q: How should financial statements be produced under the zero-cost rule? → A: Only from free sources that already publish the figures. No PDF extraction or any paid processing.
- Q: Until EGX or EGID gives permission to share the data, who should be able to sign in? → A: Anyone with a Google account, from day one.
- Q: How many tool calls per day should each user or API key be allowed? → A: Configurable by the owner, default 100 per day and 10 per minute, with an owner-defined list of unlimited users in configuration. The owner must never pay: the service runs only on free hosting tiers, and a global daily cap refuses calls before any free-tier limit is reached.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ask about any EGX stock (Priority: P1)

The owner connects an AI client to the server with an API key and asks about a stock by ticker, ISIN, Arabic name or English name. The server finds the symbol and returns its latest delayed price with open, high, low, previous close, change, volume and value, clearly labeled as delayed, with the time of the data and the name of the source.

**Why this priority**: This is the core reason the server exists. With only this story built, the owner can already check the state of any Egyptian stock from an AI client.

**Independent Test**: Create an API key, connect an AI client, ask "What is the price of CIB?" and "سعر سهم البنك التجاري الدولي", and confirm both return the same labeled delayed quote for COMI.

**Acceptance Scenarios**:

1. **Given** the owner has a valid API key and the market snapshot is current, **When** the owner asks for COMI, **Then** the answer includes price, change, volume, the data time, a "delayed" label and the source name.
2. **Given** a search term in Arabic, English, a ticker or an ISIN, **When** the owner searches, **Then** all matching symbols are returned with ticker, ISIN, both names and sector.
3. **Given** a symbol whose newest data is older than one trading day, **When** it is requested, **Then** the answer is flagged stale and shows the date of the data it has.
4. **Given** a symbol that is listed but has no price data yet, **When** it is requested, **Then** the answer says "no data yet" instead of hiding the symbol.
5. **Given** no key or a revoked key, **When** any tool is called, **Then** the request is refused with a clear message.

---

### User Story 2 - Market overview and indices (Priority: P1)

The owner asks how the market is doing. The server answers with market status (open or closed), main indices, advancers and decliners, top gainers, top losers, most active stocks, market totals, and investor statistics by investor type when a source provides them (otherwise "not available from current sources").

**Why this priority**: Together with Story 1 it answers the owner's main question, "what is the state of the market today", in one or two questions.

**Independent Test**: Ask "How is the Egyptian market today?" during and after trading hours and confirm all overview parts are present and labeled.

**Acceptance Scenarios**:

1. **Given** trading hours, **When** the owner asks for the market overview, **Then** status shows open and all figures carry the data time and source.
2. **Given** an index name such as EGX30, EGX30 capped, EGX30 USD, EGX70 or EGX100, **When** it is requested, **Then** its latest value and change are returned, or "not available from current sources" if no source provides it.
3. **Given** the market is closed, **When** the owner asks for top movers, **Then** the answer uses the last session and says which session it is.

---

### User Story 3 - Price history and comparisons (Priority: P2)

The owner asks for the price history of a stock over a period, compares several stocks, or asks how far a stock is from its 52-week high and low, which stocks show unusual volume, or how a sector performed.

**Why this priority**: History is required for every comparison, performance figure and later analysis.

**Independent Test**: Ask for one year of daily history for a stock that had a bonus share distribution in that year and confirm the adjusted series shows no false drop while the raw series shows the real traded prices.

**Acceptance Scenarios**:

1. **Given** stored daily history, **When** the owner requests a date range, **Then** daily open, high, low, close and volume are returned in both raw and adjusted form.
2. **Given** a bonus share or split on a known date, **When** adjusted history is requested, **Then** prices before that date are adjusted so that no artificial drop appears.
3. **Given** two to five symbols, **When** the owner asks to compare them over a period, **Then** the server returns each symbol's return, high, low and volume for the same period.
4. **Given** a request for a range before the earliest stored date, **When** it is served, **Then** the answer states the earliest date available.

---

### User Story 4 - Fund NAVs and performance (Priority: P2)

The owner asks about an Egyptian mutual fund by name or manager. The server returns the latest NAV with its own publication date, NAV history, and performance over 1 month, 3 months, 1 year and year to date, compares funds with each other and with EGX30, and shows the return after Egyptian inflation.

**Why this priority**: Funds are half of the owner's stated need.

**Independent Test**: Ask "What is the latest NAV of [fund] and how did it do this year compared with EGX30?" and confirm the NAV date, performance figures and comparison are returned.

**Acceptance Scenarios**:

1. **Given** a fund that publishes weekly, **When** its NAV is requested midweek, **Then** the last published NAV is returned with its publication date and is not flagged stale until a full publication cycle is missed.
2. **Given** a fund with less than one year of history, **When** 1-year performance is requested, **Then** the answer says the period is not available and gives the longest period that is.
3. **Given** two funds in different currencies, **When** they are compared, **Then** each is shown in its own currency and the answer states the currencies differ.
4. **Given** stored inflation figures, **When** the real return is requested, **Then** the answer shows nominal return, inflation over the same period and the real return.

---

### User Story 5 - Portfolio, price levels and "what changed" (Priority: P3)

The owner records holdings (quantity and cost) and price levels for symbols. When the owner asks, the server reports gain or loss, allocation by sector, any levels crossed, and everything that changed since a given time: new fund NAVs, big moves, levels crossed, new listings, new dividends or corporate actions, and new disclosures.

**Why this priority**: Valuable, but it builds on Stories 1, 3 and 4.

**Independent Test**: Record two holdings and one price level below the current price, then ask "what changed since yesterday" after the price falls below that level, and confirm the crossed level and portfolio change appear.

**Acceptance Scenarios**:

1. **Given** holdings with cost, **When** the owner asks for the portfolio, **Then** the server returns current value, gain or loss per holding and in total, and allocation by sector.
2. **Given** a saved price level, **When** a later "what changed" request finds the price has crossed it, **Then** the crossing is reported once with the time it was detected.
3. **Given** a start time, **When** the owner asks what changed since then, **Then** only events after that time are returned, grouped by type.

---

### User Story 6 - Company fundamentals and corporate actions (Priority: P3)

The owner asks about a company's profile, dividends, corporate actions, key financial figures and ratios. The server returns static profile data, a dividend calendar, corporate actions, the financial figures that free sources publish (such as net profit and revenue) with their source and period, and P/E, P/B and dividend yield computed from the current price where the inputs exist.

**Why this priority**: Fundamentals coverage is poor elsewhere, but quotes, history and funds come first.

**Independent Test**: Ask "Show CIB's net profit and its P/E" and confirm the figure comes with its source and period and the ratio uses the current delayed price.

**Acceptance Scenarios**:

1. **Given** a stored financial figure, **When** it is returned, **Then** it carries the period, currency and source.
2. **Given** no financial figures for a company, **When** ratios are requested, **Then** the answer says they cannot be computed and why.
3. **Given** an upcoming dividend, **When** the owner asks for the dividend calendar, **Then** it shows the company, amount, and the relevant dates.

---

### User Story 7 - New listings, delistings and operator notices (Priority: P3)

Every trading day the server compares the full list of listed companies with its symbol master. New symbols are added as "pending" and an operator notice is stored. Symbols that disappear are marked inactive and keep their history. A notice is also stored when a scheduled data job fails. The owner reads open notices through an owner-only admin tool.

**Why this priority**: Keeps the data complete without manual work, but it is not needed for the first answers.

**Independent Test**: Remove one symbol from the stored master in a test environment, run the daily discovery, and confirm it comes back as pending and the admin tool shows a notice for it.

**Acceptance Scenarios**:

1. **Given** a listing that is not in the symbol master, **When** daily discovery runs, **Then** it is inserted as pending and a notice is stored the same day.
2. **Given** a symbol missing from the source list for 5 consecutive trading days (FR-004), **When** discovery runs, **Then** it is marked inactive and its history is kept.
3. **Given** a data job fails, **When** it fails, **Then** a notice naming the job, the source and the time is stored.
4. **Given** stored notices, **When** the owner calls the admin tool, **Then** open notices are listed and can be marked done; **When** any other user calls it, **Then** the call is refused.

---

### User Story 8 - Public access with sign-in and limits (Priority: P4)

A public user adds the server URL to an AI client. The client opens the server's sign-in page, the user signs in with Google and consents, and the client can call tools. Developers sign in to a dashboard to create, view and revoke API keys. Each user or key is rate limited and their usage is recorded.

**Why this priority**: Part of the first release but built after the data stories. API key creation (part of this story) is needed for Story 1, so the key dashboard is built first and OAuth later in the same release.

**Independent Test**: With a second Google account, connect an AI client through sign-in, call a tool, create and revoke a key, and exceed the rate limit to confirm refusal.

**Acceptance Scenarios**:

1. **Given** a signed-in user on the dashboard, **When** they create a key, **Then** the full key is shown exactly once and later only its prefix and last-used time are visible.
2. **Given** a user who already has 3 active keys, **When** they create another, **Then** the request is refused with a message.
3. **Given** a revoked key, **When** it is used, **Then** it is refused within 2 minutes of revocation.
4. **Given** a user over their rate limit, **When** they call a tool, **Then** the call is refused with a message that says when they can retry.
5. **Given** an MCP client that supports sign-in, **When** the user completes Google sign-in and consent, **Then** the client can call tools as that user.
6. **Given** a user on the owner's unlimited list, **When** they exceed the default limits, **Then** their calls are still served.
7. **Given** the global daily cap has been reached, **When** any user calls a tool, **Then** the call is refused with a message that the free service is at capacity until the next day.

---

### User Story 9 - Gold, silver and the dollar (Priority: P4)

The owner asks for gold and silver prices in Egypt or the USD/EGP rate. The server returns the latest values with time and source.

**Why this priority**: Useful context for Egyptian investors and cheap to add, but not core.

**Independent Test**: Ask "What is the gold price in Egypt today and the dollar rate?" and confirm both are returned with time and source.

**Acceptance Scenarios**:

1. **Given** current gold price data, **When** requested, **Then** buy and sell prices per gram for 18K, 21K and 24K are returned with time and source.
2. **Given** current silver price data, **When** requested, **Then** buy and sell prices per gram for 925 and 999 silver are returned with time and source.
3. **Given** a retail source page that carries no timestamp, **When** its prices are returned, **Then** the time shown is the time the server fetched them and says so.
4. **Given** the USD/EGP rate, **When** requested, **Then** the rate is returned with time and source.

---

### User Story 10 - Public README for users and the owner (Priority: P1)

The repository is public. Its README explains what the server does, what data it covers, that all data is delayed and informational only, and the data sources and their limits. It walks a public user through connecting Claude, ChatGPT and Cursor, signing in and creating an API key, lists every tool with an example question, and walks the owner through installation and deployment from a clean Windows machine. It ends with troubleshooting.

**Why this priority**: The owner needs the installation guide to run Story 1, and the repository is public from the start.

**Independent Test**: A person who has not seen the project follows the README on a clean Windows machine and reaches a first successful tool call without outside help.

**Acceptance Scenarios**:

1. **Given** a clean Windows machine, **When** the owner follows the installation steps in order, **Then** the server is deployed and answers a first tool call.
2. **Given** a new public user, **When** they follow the usage steps for their AI client, **Then** they connect and get an answer.
3. **Given** a source outage, blocked requests or stale data, **When** the reader opens the troubleshooting section, **Then** it gives the symptom, the cause and the steps to recover.

---

### Edge Cases

- The primary stock source is down, blocked or returns an error: the server keeps serving the last stored snapshot marked with its time, switches to the backup source if available, and attributes data to the source it actually came from.
- Primary and backup sources disagree for the same symbol: the primary value is served, and differences above the 2 percent threshold (FR-014) are recorded for the owner.
- A source reports a last trade date older than the time it wrote the record: the server uses the trade date for freshness, not the write time.
- A ticker or company name changes: the symbol keeps its ISIN, history stays attached, and search finds both old and new names.
- An ISIN appears with a different ticker on two sources: the ISIN wins and both tickers are kept as provider symbols.
- The market is closed (weekend, holiday, after hours): no refresh happens, and answers say the market is closed and which session the data is from.
- A holiday is missing from the holiday table: refresh runs, finds no new trades, and data is not marked as a new session.
- A fund stops publishing NAVs: it is flagged stale after one missed publication cycle and stays queryable.
- A user asks for a recommendation ("should I buy COMI?"): tools return facts only, and the response states the server does not give investment advice.
- Arabic search with different spellings (with or without hamza, ta marbuta or alef variants): matching normalizes these so common variants match.
- A portfolio holding or price level refers to a symbol that later becomes inactive: it is shown as inactive with last known data, never silently dropped.
- A corporate action is announced after history was stored: adjusted history is recomputed for the affected symbol.

## Requirements *(mandatory)*

### Functional Requirements

**Symbols and search**

- **FR-001**: System MUST keep a symbol master identified by ISIN, holding ticker, provider-specific symbols, Arabic name, English name, sector, market (main or Nilex), index membership when a source provides it, and status (active, pending, inactive).
- **FR-002**: System MUST let users search symbols and funds by ticker, ISIN, Arabic name or English name, with Arabic spelling variants normalized.
- **FR-003**: System MUST compare the full listed-company list with the symbol master once per trading day, insert new listings as pending, and store an operator notice the same day (FR-048).
- **FR-004**: System MUST mark a symbol inactive when it is absent from the listing source for 5 consecutive trading days, and MUST NOT delete its history.

**Quotes, indices and market overview**

- **FR-005**: System MUST refresh one shared market snapshot every 1 to 2 minutes inside the session window, and MUST NOT refresh outside it or on dates in the owner-maintained holiday table. The session window is Sunday to Thursday from 09:55 to 14:45 Africa/Cairo (5 minutes before the 10:00 open to 15 minutes after the 14:30 close); owner-set special hours (for example Ramadan) move the window the same way. Daily jobs (end of day, fund NAVs, reference data) run once per day.
- **FR-006**: System MUST answer every user request from stored data only, never by contacting a data source during the request.
- **FR-007**: Every quote, index value, NAV and price MUST state that it is delayed or end of day, the time of the data and the source it came from.
- **FR-008**: System MUST flag a stock quote as stale when its data is older than one trading day, and a fund NAV as stale when one publication cycle has been missed.
- **FR-009**: System MUST return "no data yet" for a listed symbol that has no data, rather than omitting it.
- **FR-010**: System MUST provide quotes for one or more symbols in one request, up to 20 symbols per request.
- **FR-011**: System MUST provide the latest value and change of EGX30, EGX30 capped, EGX30 USD, EGX70, EGX100 and any other index the sources expose, and say "not available from current sources" for a named index it cannot provide.
- **FR-012**: System MUST provide a market overview with market status, main indices, advancers and decliners count, top gainers, top losers, most active by volume and value, market totals and, when a source provides them, investor statistics by investor type; otherwise the overview marks investor statistics as not available with the reason.
- **FR-013**: System MUST use a primary source and a backup source for stock data, switch to the backup when the primary fails or is stale, and attribute each value to the source it actually came from.
- **FR-014**: System MUST record differences between primary and backup values above 2 percent for the same symbol and session for the owner to review.
- **FR-015**: System MUST determine freshness from the trade date reported by the source, not from the time the source wrote the record.

**History and comparisons**

- **FR-016**: System MUST store daily open, high, low, close and volume for every symbol after each trading day.
- **FR-017**: System MUST store both raw and adjusted prices, with adjustments for bonus shares and splits, and MUST recompute adjusted history when a bonus share or split is applied.
- **FR-017a**: Until a bonus share or split whose ex date has passed is applied, System MUST label every stored bar dated before its ex date as not yet adjusted, stating whether it awaits the owner's ratio or is queued for adjustment, and MUST remove the label only when the action is applied.
- **FR-018**: System MUST support a one-time historical backfill run by the owner outside the live service, loading 5 years of daily history (or from listing date if shorter) for every stock, with corporate actions for the same period so adjusted prices are correct.
- **FR-019**: System MUST return history for a requested date range and state the earliest date available when the range starts before it.
- **FR-020**: System MUST compare 2 to 5 symbols over a common period by return, high, low and volume.
- **FR-021**: System MUST provide top movers, sector comparison, distance from the 52-week high and low, and unusual volume (volume above 2 times its 20-session average).

**Funds**

- **FR-022**: System MUST keep a fund list with manager, currency and Arabic name, plus English name and category when the source provides them.
- **FR-023**: System MUST fetch fund NAVs once per day and store each NAV with its own publication date and full history.
- **FR-024**: System MUST provide fund performance over 1 month, 3 months, 1 year and year to date, and state when a period is not available.
- **FR-025**: System MUST compare funds with each other and with EGX30 over the same period, showing each in its own currency; the EGX30 figure is given only for periods covered by stored index history and is otherwise marked not available.
- **FR-026**: System MUST show nominal return, Egyptian inflation over the same period and real return, using stored official inflation figures.

**Fundamentals and corporate actions**

- **FR-027**: System MUST provide a company profile with sector, ISIN, shares outstanding, free float and listing date; when no source provides the listing date, the first trade date in stored history is shown and the listing date is marked not available.
- **FR-028**: System MUST provide dividends and corporate actions, and a dividend calendar of upcoming dates.
- **FR-029**: System MUST provide the financial figures that free sources publish (such as net profit, revenue and net income), each with its period, currency and source, and MUST say which figures are not available for a company.
- **FR-030**: System MUST NOT extract financial figures from disclosure documents or use any paid processing to obtain them.
- **FR-031**: System MUST compute P/E, P/B and dividend yield from the current delayed price and the latest stored figures where those figures exist, and MUST say when a ratio cannot be computed and why.

**Personal data**

- **FR-032**: Removed (watchlists, see Clarifications).
- **FR-033**: Users MUST be able to record portfolio holdings with quantity, cost and date, and get current value, gain or loss per holding and in total, and allocation by sector.
- **FR-034**: Users MUST be able to save price levels per symbol (above or below a value), and the system MUST report each crossing once, in the next "what changed" or portfolio request after it is detected.
- **FR-035**: Personal data MUST be visible only to its owner.
- **FR-036**: Users MUST be able to delete their account, which removes their portfolio, price levels and keys.

**Summary tools**

- **FR-037**: Removed (watchlist digest, see Clarifications).
- **FR-038**: System MUST provide "what changed since" a given time, returning new fund NAVs, moves larger than 5 percent, crossed price levels, new listings, new dividends or corporate actions, and new disclosures when a source provides them, grouped by type.
- **FR-039**: System MUST provide a daily market summary for the last completed session.

**Other Egyptian market data**

- **FR-040**: System MUST provide gold and silver prices in Egypt and the USD/EGP rate, each with time and source.

**Access and operations**

- **FR-041**: System MUST let a user sign in to a dashboard with Google and create API keys that are shown in full exactly once.
- **FR-042**: System MUST store only a one-way hash and a short prefix of each key, plus its last-used time, and MUST let the user revoke a key.
- **FR-043**: System MUST limit each account to 3 active API keys.
- **FR-044**: A revoked key MUST stop working within 2 minutes.
- **FR-045**: System MUST support sign-in for MCP clients with Google (GitHub optional), with consent. Sign-up is open to anyone with a Google account from the first release, with no allowlist.
- **FR-046**: System MUST apply rate limits per user or per key, with daily and per-minute limits set in owner configuration (default 100 calls per day and 10 per minute), and the refusal message MUST say when the user can retry.
- **FR-046a**: System MUST exempt from rate limits the users listed by Google account in an owner-maintained configuration list, and changing the limits or the list MUST NOT require a code change.
- **FR-046b**: System MUST enforce a global daily cap across all users, set in owner configuration below the free hosting tier limits, and MUST refuse further calls for the rest of that day once the cap is reached, including calls from unlimited users if needed to stay free. Data refresh jobs MUST also stay within free-tier limits (FR-046c is the canonical zero-cost rule).
- **FR-046c**: The service MUST run only on free hosting tiers with no payment method that can be charged automatically, so that exceeding a limit causes refusals, never a bill.
- **FR-047**: System MUST record usage per user: calls per tool per day.
- **FR-048**: System MUST store an operator notice for each new listing, each failed data job (naming the job, the source and the time), each bonus share or split awaiting its ratio, each fund that turns stale and each switch to the backup stock source, and MUST NOT push notices to any channel. An owner-only admin tool MUST list open notices and let the owner mark them done; other users MUST be refused.
- **FR-049**: System MUST keep each data source replaceable, so that switching a source does not change any tool's inputs or outputs.
- **FR-050**: Tools MUST return facts and calculations only and MUST NOT produce buy, sell or hold recommendations.

**Documentation**

- **FR-051**: The repository MUST include a README covering: an overview with data coverage, delayed and informational-only notice, and source attributions and limits; step-by-step usage for Claude, ChatGPT and Cursor including sign-in and API key creation; every tool with an example question; step-by-step installation for the owner from a clean Windows machine (prerequisites, cloning, hosting account and login, storage setup, secrets, running locally, historical backfill, deployment, first tool call, holiday table maintenance, update and rollback); and troubleshooting for source outages, blocked requests and stale data.

### Key Entities

- **Symbol**: a listed security identified by ISIN, with ticker, provider symbols, names in Arabic and English, sector, market, index memberships and status.
- **Quote snapshot**: the latest delayed values for all active symbols at one time, with source and data time.
- **Daily bar**: one symbol's open, high, low, close and volume for one session, raw and adjusted.
- **Corporate action**: a bonus share distribution, split or dividend for a symbol, with its dates and ratio or amount.
- **Index value**: an index's value and change at a time, with source.
- **Fund**: an Egyptian mutual fund with manager, currency, category and names.
- **NAV record**: one fund's NAV on its publication date.
- **Financial figure**: one value (such as revenue or net profit) for a company and period, with currency and source.
- **Inflation figure**: official Egyptian inflation for a month.
- **Holiday**: a date when EGX does not trade, maintained by the owner.
- **User**: a signed-in person, identified through Google sign-in.
- **API key**: belongs to a user; stored as a hash and prefix with created and last-used times and status.
- **Holding**: a symbol, quantity, cost and date in one user's portfolio.
- **Price level**: a user's threshold for a symbol, direction, and the time it was last reported crossed.
- **Market event**: a recorded change (new NAV, big move, new listing, corporate action, disclosure, level crossed) with its time, used by "what changed since".
- **Source discrepancy**: a recorded difference between primary and backup values for a symbol and session.
- **Usage record**: calls per tool per user per day.
- **Operator notice**: a stored message for the owner (new listing, failed job, corporate action awaiting a ratio, stale fund, source switch) with type, details, time and status (open or done).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The owner can get a labeled delayed answer for any of the active listed stocks and all supported indices; a test over every active symbol returns a quote or "no data yet" for 100 percent of them.
- **SC-002**: 100 percent of price, index and NAV answers include a delayed or end-of-day label, a data time and a source.
- **SC-003**: During trading hours, the served snapshot is never more than 3 minutes behind the latest values the source has published.
- **SC-004**: 95 percent of tool calls return within 2 seconds.
- **SC-005**: Removed (watchlist digest).
- **SC-006**: New listings appear as pending within one trading day of first appearing at the source.
- **SC-007**: Adjusted history shows no single-day drop caused by a bonus share or split, for 100 percent of applied corporate actions; actions not yet applied are labeled as not yet adjusted.
- **SC-008**: When the primary source fails, answers continue from stored data or the backup source with no user-visible errors other than a stale or source label.
- **SC-009**: A person who has not seen the project goes from the README to a first successful tool call in under 30 minutes, and the owner deploys from a clean Windows machine using only the README.
- **SC-010**: Monthly hosting cost is 0 USD in every month, whatever the number of users; load beyond free limits is refused, not billed.
- **SC-011**: No personal data of one user is ever returned to another user, verified by access tests across two accounts.

## Assumptions

- The owner is the first user, and sign-up is open to the public from the first release. All stories, including OAuth sign-in for MCP clients, are part of the first release; user story priorities set the build order inside that release, with the API key path built before OAuth.
- Data sources, as researched on 2026-10-25: the official EGX website's data endpoints are the primary stock source; the TradingView public scanner is the backup for stocks and serves indices, USD/EGP and global gold and silver; if the EGX endpoints are not usable from the hosting platform (checked by a probe during implementation), TradingView becomes primary and Mubasher Info the stock backup; Yahoo Finance is not used because its EGX stock data was frozen at 2024-07-23; Mubasher Info is the bulk fund NAV source (fund managers' own sites as fallback) and also supplies listings with Arabic names, corporate-action dates and the historical backfill; iSagha supplies Egypt gold and silver retail prices; the Central Bank of Egypt rate is not used in the first release because its site rejected automated requests, so USD/EGP is the TradingView market rate. These sources are free but unofficial or undocumented, and may change or block access without notice.
- The owner accepts the risk of serving data from these free sources to any signed-in user from the first release, before permission from EGX/EGID is obtained. Seeking that permission, or moving to a licensed feed, stays an open owner task, and the README states the sources and that the data is unofficial and delayed.
- Index history, intraday points, financial statements, news and disclosures, Nilex, bonds and fund data from the EGX website were seen but not working during research. Capabilities that depend only on them return "not available from current sources" until a working source is confirmed.
- The historical backfill source is Mubasher's public daily CSV per stock (chosen during planning), covering 5 years of daily data; corporate actions for the same period come from Mubasher, with bonus and split ratios entered by the owner.
- EGX trading days are Sunday to Thursday with continuous trading from 10:00 and a closing auction ending at 14:30 Cairo time; the session window in FR-005 is derived from these times.
- Egyptian inflation figures are the official monthly figures, entered or imported by the owner.
- Defaults chosen without explicit input: 5 consecutive missing trading days before a symbol is marked inactive; 2 percent threshold for recording source discrepancies; 5 percent threshold for a "big move"; unusual volume means more than 2 times the 20-session average; up to 20 symbols per quote request; revoked keys stop working within 2 minutes.
- Financial statement extraction from disclosure PDFs is out of scope because it needs paid processing. Figures like equity and debt, and therefore P/B, are available only if a free source publishes them.
- The owner will never pay for hosting (constitution Principle IV, Zero-Cost Operation).
- The project constitution applies in full.
- Out of scope: real-time or tick data and its storage, any real-time guarantee, buy or sell recommendations, push alerts, a server-side scheduler for users, scheduled-task setup or guides, paid data feeds in the first release, and technical analysis (moving averages, RSI, volatility, drawdown, correlation), which is planned for a later release using stored history.
