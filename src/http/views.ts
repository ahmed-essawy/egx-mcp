import { CSRF_FIELD } from "../auth/session";
import { utcDay } from "../domain/calendar";
import { MAX_SYMBOLS } from "../mcp/tools/quotes";
import type { ToolName } from "../mcp/tool-names";
import type { ApiKeySummary } from "../store/d1/users";

export const KEY_NAME_MAX_LENGTH = 40;
const NEVER_USED = "never";
const UNKNOWN_DATE = "unknown";
export const HOME_PATH = "/";
export const PRIVACY_PATH = "/privacy";
export const TERMS_PATH = "/terms";
const STYLESHEET_PATH = "/styles.css";
export const MCP_PATH = "/mcp";
export const DASHBOARD_PATH = "/dashboard";
const CONNECT_ID = "connect";
const BEARER_HEADER = "Authorization: Bearer <your key>";
const PRODUCT_NAME = "EGX MCP";
const VALUE_LINE =
  "Ask your AI assistant about Egyptian Exchange stocks and indices, with delayed data through the Model Context Protocol.";
export const DATA_SOURCES = [
  "EGX website",
  "TradingView",
  "Mubasher Info",
  "iSagha",
  "Fund managers' own sites",
];
export const TERMS_LINK = `<a href="${TERMS_PATH}">Terms of use</a>`;
export const PRIVACY_LINK = `<a href="${PRIVACY_PATH}">Privacy policy</a>`;
const DISCLAIMER = "Data is delayed, unofficial and informational only.";
export const EXAMPLE_PROMPTS = [
  "Find the ticker for Talaat Moustafa.",
  "What is the price of CIB and Talaat Moustafa?",
  "How is the EGX market doing today?",
  "What are EGX30 and EGX70 at?",
  "Give me a summary of the last session.",
];
export const COVERED_TOOLS: { name: ToolName; summary: string }[] = [
  { name: "search", summary: "Find Egyptian stocks by ticker, ISIN, or Arabic or English name. Mutual funds are coming later." },
  { name: "get_quotes", summary: `Delayed quotes for up to ${MAX_SYMBOLS} Egyptian stocks by ticker, ISIN, or Arabic or English name.` },
  {
    name: "get_market_overview",
    summary: "The delayed EGX market overview: indices, breadth, top movers, most active stocks and totals.",
  },
  { name: "get_indices", summary: "Delayed EGX index values by name or code." },
  {
    name: "get_daily_summary",
    summary: "A summary of the last completed session: indices, breadth, top movers and totals.",
  },
];
export const NOTICE_SENTENCES = [
  DISCLAIMER,
  "It is not real-time and can be late, wrong or missing. Check an official source before acting.",
  "Nothing here is financial advice or a buy, sell or hold recommendation.",
  `${PRODUCT_NAME} is not affiliated with, endorsed by or sponsored by the Egyptian Exchange.`,
];

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export const STYLESHEET = `
:root { color-scheme: light dark; --text: #1a1a1a; --background: #ffffff; --surface: #f2f4f7; --border: #767676; --link: #0b4f9c; --on-link: #ffffff; --error: #9b1c1c; }
@media (prefers-color-scheme: dark) { :root { --text: #e8e8e8; --background: #121212; --surface: #1e2329; --border: #8a8a8a; --link: #8ab4f8; --on-link: #121212; --error: #ff8a80; } }
body { font-family: system-ui, sans-serif; line-height: 1.5; margin: 0; color: var(--text); background: var(--background); }
main, footer { max-width: 48rem; margin: 0 auto; padding: 1rem; }
footer { border-top: 1px solid var(--border); }
footer nav { display: flex; flex-wrap: wrap; gap: 1rem; }
a { color: var(--link); }
.skip-link { position: absolute; left: -999px; }
.skip-link:focus { left: 1rem; top: 1rem; background: var(--background); padding: 0.5rem; }
a:focus-visible, button:focus-visible, input:focus-visible { outline: 3px solid var(--link); outline-offset: 2px; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid var(--border); }
.error { color: var(--error); }
#new-key { width: 100%; font-family: monospace; }
code { font-family: monospace; overflow-wrap: anywhere; }
.hero, section[id] { margin-block: 2rem; }
.hero h1 { font-size: 2.5rem; line-height: 1.2; margin-block: 1rem; }
.lead { font-size: 1.25rem; }
.actions { display: flex; flex-wrap: wrap; gap: 0.75rem; }
.button { display: inline-block; padding: 0.75rem 1.25rem; border: 2px solid var(--link); border-radius: 0.5rem; font-weight: 600; text-decoration: none; }
.button-primary { background: var(--link); color: var(--on-link); }
.steps li, .examples li { margin-block: 0.5rem; }
.tools { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: 1rem; padding: 0; list-style: none; }
.tools li { padding: 1rem; border: 1px solid var(--border); border-radius: 0.5rem; }
#notice { padding: 1rem; border-left: 4px solid var(--link); background: var(--surface); }
`;

export const HTML_HEADERS: Record<string, string> = {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "cache-control": "no-store",
};

export type ConsentInput = { clientName: string; scopes: string[]; csrf: string };

export type DashboardInput = {
  email: string;
  keys: ApiKeySummary[];
  usage: { tool: string; calls: number }[];
  csrf: string;
  newKey?: string;
  error?: string;
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

export function withCookies(headers: Headers, cookies: string[]): Headers {
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return headers;
}

export function htmlResponse(html: string, status: number, cookies: string[] = []): Response {
  return new Response(html, { status, headers: withCookies(new Headers(HTML_HEADERS), cookies) });
}

export function page(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${STYLESHEET_PATH}">
</head>
<body>
<a class="skip-link" href="#main">Skip to main content</a>
<main id="main">
${bodyHtml}
</main>
${siteFooter()}
</body>
</html>`;
}

export function messageView(title: string, text: string): string {
  return page(title, `<h1>${escapeHtml(title)}</h1>\n<p>${escapeHtml(text)}</p>\n<p><a href="/">Back to the start</a></p>`);
}

export function mcpUrl(origin: string): string {
  return new URL(MCP_PATH, origin).href;
}

export function landingView(serverUrl: string): string {
  const sections = [
    heroSection(),
    examplesSection(),
    connectSection(serverUrl),
    toolsSection(),
    sourcesSection(),
    noticeSection(),
  ];
  return page(PRODUCT_NAME, sections.join("\n"));
}

export function consentView(input: ConsentInput): string {
  const scopes = input.scopes.map((scope) => `<li>${escapeHtml(scope)}</li>`).join("\n");
  return page(
    "Authorize access",
    `<h1>Authorize access</h1>
<p>${escapeHtml(input.clientName)} requests access to your EGX MCP account with these scopes.</p>
<ul>
${scopes}
</ul>
<p>${escapeHtml(DISCLAIMER)}</p>
${agreementNotice("authorizing")}
${csrfField(input.csrf)}`,
  );
}

export function dashboardView(input: DashboardInput): string {
  const body = [
    "<h1>Dashboard</h1>",
    `<p>Signed in as ${escapeHtml(input.email)}.</p>`,
    errorSection(input.error),
    newKeySection(input.newKey),
    keysSection(input.keys, input.csrf),
    createKeyForm(input.csrf),
    usageSection(input.usage),
    logoutForm(input.csrf),
  ];
  return page("Dashboard", body.filter((section) => section !== "").join("\n"));
}

function listItems(items: string[]): string {
  return items.map((item) => `<li>${escapeHtml(item)}</li>`).join("\n");
}

function contentSection(id: string, title: string, bodyHtml: string): string {
  return `<section id="${id}" aria-labelledby="${id}-title">
<h2 id="${id}-title">${title}</h2>
${bodyHtml}
</section>`;
}

function heroSection(): string {
  return `<section class="hero" aria-labelledby="hero-title">
<h1 id="hero-title">${escapeHtml(PRODUCT_NAME)}</h1>
<p class="lead">${escapeHtml(VALUE_LINE)}</p>
<p class="actions"><a class="button button-primary" href="${DASHBOARD_PATH}">Sign in</a> <a class="button" href="#${CONNECT_ID}">Read the docs</a></p>
${agreementNotice("signing in")}
</section>`;
}

function examplesSection(): string {
  return contentSection("examples", "What you can ask", `<ul class="examples">\n${listItems(EXAMPLE_PROMPTS)}\n</ul>`);
}

function connectSection(serverUrl: string): string {
  const body = `<ol class="steps">
<li><a href="${DASHBOARD_PATH}">Sign in</a> with your Google account.</li>
<li>Create an API key in the dashboard and copy it. It is shown only once.</li>
<li>Add the server to an MCP client that lets you set a request header, such as Claude Code or Cursor.<br>Server URL: <code>${escapeHtml(serverUrl)}</code><br>Header: <code>${escapeHtml(BEARER_HEADER)}</code></li>
</ol>
<p>Claude.ai and Claude Desktop custom connectors cannot send a header. Sign-in from AI assistants is coming later.</p>`;
  return contentSection(CONNECT_ID, "Connect in 3 steps", body);
}

function toolsSection(): string {
  const tools = COVERED_TOOLS.map((tool) => `<li><code>${tool.name}</code> ${escapeHtml(tool.summary)}</li>`).join("\n");
  return contentSection(
    "tools",
    "What is covered",
    `<p>This build has these ${COVERED_TOOLS.length} tools.</p>\n<ul class="tools">\n${tools}\n</ul>`,
  );
}

function sourcesSection(): string {
  return contentSection(
    "sources",
    "Data sources",
    `<p>Data comes, or will come, from these free public sources. The Egyptian Exchange has not given permission to redistribute it.</p>\n<ul>\n${listItems(DATA_SOURCES)}\n</ul>`,
  );
}

function noticeSection(): string {
  return contentSection("notice", "Important notice", NOTICE_SENTENCES.map((sentence) => `<p>${escapeHtml(sentence)}</p>`).join("\n"));
}

function siteFooter(): string {
  return `<footer><nav aria-label="Site"><a href="${HOME_PATH}">Home</a> ${PRIVACY_LINK} ${TERMS_LINK}</nav></footer>`;
}

function agreementNotice(action: string): string {
  return `<p>By ${action} you agree to the ${TERMS_LINK} and acknowledge the ${PRIVACY_LINK}.</p>`;
}

function csrfField(csrf: string): string {
  return `<input type="hidden" name="${CSRF_FIELD}" value="${escapeHtml(csrf)}">`;
}

function errorSection(error: string | undefined): string {
  return error === undefined ? "" : `<p class="error" role="alert">${escapeHtml(error)}</p>`;
}

function newKeySection(newKey: string | undefined): string {
  if (newKey === undefined) return "";
  return `<section aria-labelledby="new-key-title">
<h2 id="new-key-title">Your new API key</h2>
<p>Select and copy it now. It is shown only once.</p>
<label for="new-key">New API key</label>
<input id="new-key" type="text" readonly value="${escapeHtml(newKey)}">
</section>`;
}

function formatDate(epochSeconds: number | null, fallback: string): string {
  if (epochSeconds === null) return fallback;
  return utcDay(epochSeconds);
}

function keyRow(key: ApiKeySummary, csrf: string): string {
  const name = escapeHtml(key.name ?? "");
  const revokeLabel = name === "" ? `Revoke key ${escapeHtml(key.prefix)}` : `Revoke key ${escapeHtml(key.prefix)} (${name})`;
  const action =
    key.revokedAt === null
      ? `<form method="post" action="/dashboard/keys/${encodeURIComponent(key.id)}/revoke">${csrfField(csrf)}<button type="submit" aria-label="${revokeLabel}">Revoke</button></form>`
      : `Revoked ${utcDay(key.revokedAt)}`;
  return `<tr><td>${name}</td><td><code>${escapeHtml(key.prefix)}</code></td><td>${formatDate(key.createdAt, UNKNOWN_DATE)}</td><td>${formatDate(key.lastUsedAt, NEVER_USED)}</td><td>${action}</td></tr>`;
}

function keysSection(keys: ApiKeySummary[], csrf: string): string {
  const rows = keys.map((key) => keyRow(key, csrf)).join("\n");
  return `<section aria-labelledby="keys-title">
<h2 id="keys-title">API keys</h2>
<table>
<thead><tr><th scope="col">Name</th><th scope="col">Prefix</th><th scope="col">Created</th><th scope="col">Last used</th><th scope="col">Action</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</section>`;
}

function createKeyForm(csrf: string): string {
  return `<section aria-labelledby="create-title">
<h2 id="create-title">Create a key</h2>
<form method="post" action="/dashboard/keys">
${csrfField(csrf)}
<label for="key-name">Key name</label>
<input id="key-name" name="name" type="text" maxlength="${KEY_NAME_MAX_LENGTH}" required>
<button type="submit">Create key</button>
</form>
</section>`;
}

function usageSection(usage: DashboardInput["usage"]): string {
  const rows = usage.map((entry) => `<tr><td>${escapeHtml(entry.tool)}</td><td>${entry.calls}</td></tr>`).join("\n");
  return `<section aria-labelledby="usage-title">
<h2 id="usage-title">Today's usage</h2>
<table>
<thead><tr><th scope="col">Tool</th><th scope="col">Calls</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</section>`;
}

function logoutForm(csrf: string): string {
  return `<form method="post" action="/dashboard/logout">${csrfField(csrf)}<button type="submit">Sign out</button></form>`;
}
