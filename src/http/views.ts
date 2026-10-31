import { CSRF_FIELD } from "../auth/session";
import { utcDay } from "../domain/calendar";
import type { ApiKeySummary } from "../store/d1/users";
import { LOCALIZED, SITE, type Lang } from "../site/identity";
import { FOOTER_LINKS, type FooterLink, HOME_PATH, PRIVACY_PATH, TERMS_PATH } from "../site/paths";
import { LOGO_PATH, PAGE_ICONS, type PageIcon } from "./icons";

export const KEY_NAME_MAX_LENGTH = 40;
const NEVER_USED = "never";
const UNKNOWN_DATE = "unknown";
export const STYLESHEET_PATH = "/styles.css";
const LOGO_SIZE = 48;
export const MCP_PATH = "/mcp";
export const DASHBOARD_PATH = "/dashboard";
export const BEARER_HEADER = "Authorization: Bearer <your key>";
export const VALUE_LINE = "Ask your AI assistant about Egyptian Exchange stocks and indices. Data is delayed.";
export const CONNECT_NOTE =
  "Claude and ChatGPT connect with Google sign-in, Claude Code with either, and Cursor with an API key header. Create your key after signing in.";
const UNVERIFIED_CLIENT_NOTICE = "This app registered itself; its name is not verified.";
const LOOPBACK_WARNING = "Access will be sent to an app on your own computer. Any program on this computer could receive it.";
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
:root { color-scheme: light dark; --text: #14202b; --muted: #52606d; --background: #f8fafb; --surface: #eef2f6; --border: #7d8996; --link: #1d4f91; --on-link: #ffffff; --error: #9b1c1c; }
@media (prefers-color-scheme: dark) { :root { --text: #e7edf3; --muted: #9aa8b5; --background: #0f1720; --surface: #17212b; --border: #66798b; --link: #8db4f0; --on-link: #0f1720; --error: #ff8a80; } }
body { font-family: system-ui, sans-serif; line-height: 1.6; margin: 0; color: var(--text); background: var(--background); }
header, main, footer { max-width: 38rem; margin: 0 auto; padding: 1.5rem 1rem; }
footer { border-top: 1px solid var(--border); }
footer nav { display: flex; flex-wrap: wrap; gap: 1rem; }
header { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; padding-bottom: 0; }
.brand { display: flex; align-items: center; gap: 0.5rem; color: var(--text); font-weight: 600; font-size: 1.125rem; text-decoration: none; }
.brand img { display: block; }
.affiliation { margin: 0; }
a { color: var(--link); }
.skip-link { position: absolute; left: -999px; }
.skip-link:focus { left: 1rem; top: 1rem; background: var(--background); padding: 0.5rem; }
a:focus-visible, button:focus-visible, input:focus-visible { outline: 3px solid var(--link); outline-offset: 2px; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid var(--border); }
.error { color: var(--error); }
#new-key { width: 100%; font-family: ui-monospace, monospace; }
code { font-family: ui-monospace, monospace; overflow-wrap: anywhere; }
.hero, .connect, .notice { margin-block: 2.5rem; }
.hero h1, .lead { font-family: ui-serif, Georgia, "Times New Roman", serif; letter-spacing: -0.02em; }
.hero h1 { font-size: 3rem; line-height: 1.1; margin: 0 0 1rem; }
.lead { font-size: 1.5rem; line-height: 1.3; margin: 0 0 2.5rem; }
.button { display: inline-block; padding: 0.75rem 1.5rem; border-radius: 0.25rem; font-weight: 600; text-decoration: none; background: var(--link); color: var(--on-link); }
.agreement, .notice, .affiliation { color: var(--muted); font-size: 0.875rem; }
.connect { padding: 1.25rem; border: 1px solid var(--border); background: var(--surface); }
.connect h2 { font-size: 1rem; margin: 0 0 0.5rem; }
.connect code { display: block; margin-block: 0.5rem; padding: 0.5rem 0.75rem; border: 1px solid var(--border); background: var(--background); }
.connect p { margin-block: 0.75rem 0; }
[dir="rtl"] th, [dir="rtl"] td { text-align: right; }
pre { overflow-x: auto; padding: 0.75rem; border: 1px solid var(--border); background: var(--surface); }
.updated { color: var(--muted); font-size: 0.875rem; }
h3 code { font-size: 1rem; }
.breadcrumb { display: flex; flex-wrap: wrap; gap: 0.5rem; list-style: none; padding: 0; margin: 0 0 1rem; font-size: 0.875rem; }
`;

export const SECURITY_HEADERS: Record<string, string> = {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
};

export const HTML_HEADERS: Record<string, string> = {
  ...SECURITY_HEADERS,
  "cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow",
};

export type DocumentParts = { lang: Lang; dir: "ltr" | "rtl"; head: string; body: string };

export type ConsentInput = {
  clientName: string;
  clientDomain?: string;
  redirectHost: string;
  redirectIsLoopback: boolean;
  scopes: string[];
  handle: string;
};

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

export function htmlDocument({ lang, dir, head, body }: DocumentParts): string {
  return `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
${head}
</head>
<body>
${body}
</body>
</html>`;
}

export function documentBody(lang: Lang, mainHtml: string): string {
  return `<a class="skip-link" href="#main">${escapeHtml(LOCALIZED[lang].skipLink)}</a>
${siteHeader(lang)}
<main id="main">
${mainHtml}
</main>
${siteFooter(lang)}`;
}

export function baseHeadTags(): string[] {
  return [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    iconLinks(),
    `<link rel="stylesheet" href="${STYLESHEET_PATH}">`,
  ];
}

export function page(title: string, bodyHtml: string): string {
  const head = [
    ...baseHeadTags(),
    '<meta name="robots" content="noindex, nofollow">',
    `<title>${escapeHtml(title)}</title>`,
  ].join("\n");
  return htmlDocument({ lang: "en", dir: "ltr", head, body: documentBody("en", bodyHtml) });
}

export function messageView(title: string, text: string): string {
  return page(title, `<h1>${escapeHtml(title)}</h1>\n<p>${escapeHtml(text)}</p>\n<p><a href="/">Back to the start</a></p>`);
}

export function mcpUrl(origin: string): string {
  return new URL(MCP_PATH, origin).href;
}

export function consentView(input: ConsentInput): string {
  const scopes = input.scopes.map((scope) => `<li>${escapeHtml(scope)}</li>`).join("\n");
  return page(
    "Authorize access",
    `<h1>Authorize access</h1>
<p>${escapeHtml(input.clientName)} requests access to your EGX MCP account with these scopes.</p>
${destinationNotices(input)}
<ul>
${scopes}
</ul>
<p>${escapeHtml(DISCLAIMER)}</p>
${agreementNotice("authorizing")}
${consentForm(input.handle)}`,
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
    deleteAccountForm(input.email, input.csrf),
    logoutForm(input.csrf),
  ];
  return page("Dashboard", body.filter((section) => section !== "").join("\n"));
}

export function heroSection(): string {
  return `<section class="hero" aria-labelledby="hero-title">
<h1 id="hero-title">${escapeHtml(SITE.name)}</h1>
<p class="lead">${escapeHtml(VALUE_LINE)}</p>
<p><a class="button" href="${DASHBOARD_PATH}">Sign in</a></p>
${agreementNotice("signing in")}
</section>`;
}

export function connectSection(serverUrl: string): string {
  return `<section class="connect" aria-labelledby="connect-title">
<h2 id="connect-title">Connect your assistant</h2>
<code>${escapeHtml(serverUrl)}</code>
<code>${escapeHtml(BEARER_HEADER)}</code>
<p>${escapeHtml(CONNECT_NOTE)}</p>
</section>`;
}

function iconLink(icon: PageIcon): string {
  const typeAttribute = icon.rel === "icon" ? ` type="${icon.contentType}"` : "";
  return `<link rel="${icon.rel}"${typeAttribute} sizes="${icon.sizes}" href="${icon.path}">`;
}

export function iconLinks(): string {
  return PAGE_ICONS.map(iconLink).join("\n");
}

export function siteHeader(lang: Lang): string {
  return `<header><a class="brand" href="${HOME_PATH}"><img src="${LOGO_PATH}" alt="" width="${LOGO_SIZE}" height="${LOGO_SIZE}">${escapeHtml(SITE.name)}</a><p class="affiliation">${escapeHtml(LOCALIZED[lang].affiliation)}</p></header>`;
}

function footerLink({ label, href }: FooterLink): string {
  return `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
}

export function siteFooter(lang: Lang): string {
  return `<footer><nav aria-label="Site">${FOOTER_LINKS[lang].map(footerLink).join(" ")}</nav></footer>`;
}

function agreementNotice(action: string): string {
  return `<p class="agreement">By ${action} you agree to the ${TERMS_LINK} and acknowledge the ${PRIVACY_LINK}.</p>`;
}

function csrfField(csrf: string): string {
  return `<input type="hidden" name="${CSRF_FIELD}" value="${escapeHtml(csrf)}">`;
}

function destinationNotices(input: ConsentInput): string {
  const origin = input.clientDomain === undefined
    ? UNVERIFIED_CLIENT_NOTICE
    : `This app is published by ${input.clientDomain}.`;
  const notices = [
    `<p>${escapeHtml(origin)}</p>`,
    `<p>Access will be sent to <strong>${escapeHtml(input.redirectHost)}</strong>.</p>`,
  ];
  if (input.redirectIsLoopback) notices.push(`<p class="error" role="alert">${escapeHtml(LOOPBACK_WARNING)}</p>`);
  return notices.join("\n");
}

function consentForm(handle: string): string {
  return `<form method="post" action="/authorize">
<input type="hidden" name="handle" value="${escapeHtml(handle)}">
<button type="submit" name="decision" value="approve">Approve</button>
<button type="submit" name="decision" value="deny">Deny</button>
</form>`;
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

function deleteAccountForm(email: string, csrf: string): string {
  return `<section aria-labelledby="delete-title">
<h2 id="delete-title">Delete account</h2>
<p>This permanently deletes your account, API keys, holdings, price levels and usage records, and revokes your assistant connections. Type your email address, ${escapeHtml(email)}, to confirm.</p>
<form method="post" action="/dashboard/account/delete">
${csrfField(csrf)}
<label for="delete-confirm">Confirm your email</label>
<input id="delete-confirm" name="confirm" type="email" autocomplete="off" required>
<button type="submit">Delete account</button>
</form>
</section>`;
}

function logoutForm(csrf: string): string {
  return `<form method="post" action="/dashboard/logout">${csrfField(csrf)}<button type="submit">Sign out</button></form>`;
}
