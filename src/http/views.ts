import { CSRF_FIELD } from "../auth/session";
import { utcDay } from "../domain/calendar";
import type { ApiKeySummary } from "../store/d1/users";

export const KEY_NAME_MAX_LENGTH = 40;
const NEVER_USED = "never";
const UNKNOWN_DATE = "unknown";
export const HOME_PATH = "/";
export const PRIVACY_PATH = "/privacy";
export const TERMS_PATH = "/terms";
const STYLESHEET_PATH = "/styles.css";
const README_URL = "https://github.com/ahmed-essawy/egx-mcp#readme";
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

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export const STYLESHEET = `
body { font-family: system-ui, sans-serif; line-height: 1.5; margin: 0; color: #1a1a1a; background: #ffffff; }
main, footer { max-width: 48rem; margin: 0 auto; padding: 1rem; }
footer { border-top: 1px solid #767676; }
a { color: #0b4f9c; }
.skip-link { position: absolute; left: -999px; }
.skip-link:focus { left: 1rem; top: 1rem; background: #ffffff; padding: 0.5rem; }
a:focus-visible, button:focus-visible, input:focus-visible { outline: 3px solid #0b4f9c; outline-offset: 2px; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #767676; }
.error { color: #9b1c1c; }
#new-key { width: 100%; font-family: monospace; }
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

export function landingView(): string {
  return page(
    "EGX MCP",
    `<h1>EGX MCP</h1>
<p>Egyptian Exchange market data for your AI assistant, through the Model Context Protocol.</p>
<p>${escapeHtml(DISCLAIMER)}</p>
<h2>Data sources</h2>
<ul>
${DATA_SOURCES.map((source) => `<li>${escapeHtml(source)}</li>`).join("\n")}
</ul>
<p><a href="${README_URL}">Read the README</a></p>
<p><a href="/dashboard">Sign in to manage your API keys</a></p>
${agreementNotice("signing in")}`,
  );
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
