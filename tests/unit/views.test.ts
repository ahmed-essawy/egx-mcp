import { describe, expect, it } from "vitest";
import {
  consentView,
  dashboardView,
  escapeHtml,
  HOME_PATH,
  landingView,
  MCP_PATH,
  mcpUrl,
  page,
  PRIVACY_PATH,
  STYLESHEET,
  TERMS_PATH,
  type DashboardInput,
} from "../../src/http/views";
import { AFFILIATION, FOOTER_NAV, ICON_LINKS, SITE_HEADER } from "../helpers/html";

const SCRIPT_PAYLOAD = "<script>alert(1)</script>";
const ESCAPED_SCRIPT_OPEN = "&lt;script&gt;";
const SCRIPT_OPEN_TAG = "<script";
const CSRF = "csrf-token-value";
const SAFE_EMAIL = "reader@example.com";
const KEY_ID = "key-1";
const KEY_PREFIX = "egx_abcd";
const CREATED_AT = 1700000000;
const CALL_COUNT = 3;
const REVOKED_AT = 1700000000;
const NEW_KEY = "egx_new-key-value";
const FORM_CONTROL_PATTERN = /<(input|select|textarea)\b[^>]*>/gi;
const HIDDEN_INPUT_PATTERN = /type="hidden"/i;
const ID_ATTRIBUTE_PATTERN = /\bid="([^"]+)"/i;
const SIGN_IN_AGREEMENT = "By signing in you agree to the";
const AUTHORIZE_AGREEMENT = "By authorizing you agree to the";
const AGREEMENT_PARAGRAPH_PATTERN = /<p class="agreement">By [^<]*you agree to the[\s\S]*?<\/p>/;

const MCP_URL = "https://egx.example.com/mcp";
const HOSTILE_URL = 'https://x.test/"><script>';
const VALUE_LINE = "Ask your AI assistant about Egyptian Exchange stocks and indices. Data is delayed.";
const BEARER_HEADER = "Authorization: Bearer &lt;your key&gt;";
const CONNECT_NOTE =
  "Create your key after signing in. Works in Claude (custom connector, no sign-in, add the header), Claude Code and Cursor.";
const NOTICE =
  "Data is delayed, unofficial and for information only, not financial advice. Sources: EGX website, TradingView, Mubasher Info, iSagha.";
const GITHUB_LINK = '<a href="https://github.com/ahmed-essawy/egx-mcp">GitHub</a>';
const REMOVED_TEXT = [
  "What you can ask",
  "Connect in 3 steps",
  "What is covered",
  "Data sources",
  "Read the docs",
  "cannot send a header",
  "<ol",
  "<h3",
];
const H2_PATTERN = /<h2[^>]*>([^<]+)<\/h2>/g;
const ARIA_LABELLEDBY_PATTERN = /aria-labelledby="([^"]+)"/g;
const HEX_DECLARATION_PATTERN = /([\w-]+):[^;{}]*#[0-9a-f]{3,8}\b/gi;

function dashboardInput(overrides: Partial<DashboardInput> = {}): DashboardInput {
  return {
    email: SAFE_EMAIL,
    keys: [
      {
        id: KEY_ID,
        prefix: KEY_PREFIX,
        name: "laptop",
        createdAt: CREATED_AT,
        lastUsedAt: null,
        revokedAt: null,
      },
    ],
    usage: [{ tool: "get_quote", calls: CALL_COUNT }],
    csrf: CSRF,
    ...overrides,
  };
}

function visibleFormControls(html: string): string[] {
  return (html.match(FORM_CONTROL_PATTERN) ?? []).filter((control) => !HIDDEN_INPUT_PATTERN.test(control));
}

function hasLabelFor(html: string, control: string): boolean {
  const id = ID_ATTRIBUTE_PATTERN.exec(control)?.[1];
  if (id === undefined) return false;
  return html.includes(`for="${id}"`);
}

describe("escapeHtml", () => {
  it("escapes markup, quotes and ampersands", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe("&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
  });
});

describe("dashboardView", () => {
  it("shows the logo header", () => {
    const html = dashboardView(dashboardInput());

    expect(html).toContain(SITE_HEADER);
    expect(html).toContain(ICON_LINKS);
  });

  it("escapes a script tag in the email", () => {
    const html = dashboardView(dashboardInput({ email: SCRIPT_PAYLOAD }));

    expect(html).toContain(ESCAPED_SCRIPT_OPEN);
    expect(html).not.toContain(SCRIPT_PAYLOAD);
  });

  it("escapes a script tag in a key name", () => {
    const keys = [{ id: KEY_ID, prefix: KEY_PREFIX, name: SCRIPT_PAYLOAD, createdAt: CREATED_AT, lastUsedAt: null, revokedAt: null }];

    const html = dashboardView(dashboardInput({ keys }));

    expect(html).toContain(ESCAPED_SCRIPT_OPEN);
    expect(html).not.toContain(SCRIPT_PAYLOAD);
  });

  it("escapes a script tag in the error message and the new key", () => {
    const html = dashboardView(dashboardInput({ error: SCRIPT_PAYLOAD, newKey: SCRIPT_PAYLOAD }));

    expect(html).not.toContain(SCRIPT_PAYLOAD);
  });

  it("introduces no script element beyond the page's own", () => {
    const withPayload = dashboardView(dashboardInput({ email: SCRIPT_PAYLOAD }));
    const withoutPayload = dashboardView(dashboardInput());

    expect(withPayload.split(SCRIPT_OPEN_TAG).length).toBe(withoutPayload.split(SCRIPT_OPEN_TAG).length);
  });

  it("gives every visible form control a label", () => {
    const html = dashboardView(dashboardInput());
    const controls = visibleFormControls(html);

    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      expect(hasLabelFor(html, control), control).toBe(true);
    }
  });

  it("shows a fallback other than never for an unknown creation date", () => {
    const keys = [{ id: KEY_ID, prefix: KEY_PREFIX, name: "laptop", createdAt: null, lastUsedAt: null, revokedAt: null }];

    const html = dashboardView(dashboardInput({ keys }));

    expect(html).toContain("<td>unknown</td><td>never</td>");
  });

  it("shows a new key once in a read-only labeled field", () => {
    const html = dashboardView(dashboardInput({ newKey: NEW_KEY }));

    expect(html).toMatch(/<input id="new-key"[^>]*readonly[^>]*value="egx_new-key-value"/);
    expect(html).toContain('for="new-key"');
  });

  it("labels the revoke button with the prefix of an unnamed key", () => {
    const keys = [{ id: KEY_ID, prefix: KEY_PREFIX, name: null, createdAt: CREATED_AT, lastUsedAt: null, revokedAt: null }];

    const html = dashboardView(dashboardInput({ keys }));

    expect(html).toContain(`aria-label="Revoke key ${KEY_PREFIX}"`);
  });

  it("labels the revoke button with the prefix and the name of a named key", () => {
    const html = dashboardView(dashboardInput());

    expect(html).toContain(`aria-label="Revoke key ${KEY_PREFIX} (laptop)"`);
  });

  it("shows the revocation date of a revoked key", () => {
    const keys = [{ id: KEY_ID, prefix: KEY_PREFIX, name: "laptop", createdAt: CREATED_AT, lastUsedAt: null, revokedAt: REVOKED_AT }];

    const html = dashboardView(dashboardInput({ keys }));

    expect(html).toContain("Revoked 2023-11-14");
    expect(html).not.toContain("/revoke");
  });

  it("carries the csrf token in its forms", () => {
    const html = dashboardView(dashboardInput());

    expect(html).toContain(`name="csrf" value="${CSRF}"`);
  });
});

describe("consentView", () => {
  it("escapes the client name and scopes", () => {
    const html = consentView({ clientName: SCRIPT_PAYLOAD, scopes: [SCRIPT_PAYLOAD], csrf: CSRF });

    expect(html).toContain(ESCAPED_SCRIPT_OPEN);
    expect(html).not.toContain(SCRIPT_PAYLOAD);
  });

  it("shows the agreement notice with both policy links", () => {
    const html = consentView({ clientName: "Client", scopes: ["read"], csrf: CSRF });
    const notice = AGREEMENT_PARAGRAPH_PATTERN.exec(html)?.[0] ?? "";

    expect(notice).toContain(AUTHORIZE_AGREEMENT);
    expect(notice).toContain('href="/terms"');
    expect(notice).toContain('href="/privacy"');
  });
});

describe("landingView", () => {
  const html = landingView(MCP_URL);

  it("has exactly one h1 with the product name", () => {
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('<h1 id="hero-title">EGX MCP</h1>');
  });

  it("states the value line and offers one sign in button", () => {
    expect(html).toContain(VALUE_LINE);
    expect(html).toContain('<a class="button" href="/dashboard">Sign in</a>');
    expect(html.match(/class="button"/g)).toHaveLength(1);
  });

  it("shows the agreement notice with both policy links after the dashboard link", () => {
    const notice = AGREEMENT_PARAGRAPH_PATTERN.exec(html)?.[0] ?? "";

    expect(notice).toContain(SIGN_IN_AGREEMENT);
    expect(notice).toContain('href="/terms"');
    expect(notice).toContain('href="/privacy"');
    expect(html.indexOf(SIGN_IN_AGREEMENT)).toBeGreaterThan(html.indexOf('href="/dashboard"'));
  });

  it("has only the connection heading", () => {
    expect([...html.matchAll(H2_PATTERN)].map((match) => match[1])).toEqual(["Connect your assistant"]);
  });

  it("points every aria-labelledby at a heading id", () => {
    const labelledBy = [...html.matchAll(ARIA_LABELLEDBY_PATTERN)].map((match) => match[1]);

    expect(labelledBy.length).toBeGreaterThan(0);
    for (const id of labelledBy) {
      expect(html, id).toMatch(new RegExp(`<h[12] id="${id}"`));
    }
  });

  it("shows the server url and the bearer header in their own boxes with the connect note", () => {
    expect(html).toContain(`<code>${MCP_URL}</code>`);
    expect(html).toContain(`<code>${BEARER_HEADER}</code>`);
    expect(html).toContain(CONNECT_NOTE);
    expect(html.indexOf(BEARER_HEADER)).toBeGreaterThan(html.indexOf(MCP_URL));
  });

  it("escapes the server url", () => {
    const output = landingView(HOSTILE_URL);

    expect(output).not.toContain(SCRIPT_OPEN_TAG);
    expect(output).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("shows the independence and data notice with the sources", () => {
    expect(html).toContain(NOTICE);
  });

  it("states the affiliation once", () => {
    expect(html.split(AFFILIATION)).toHaveLength(2);
  });

  it("links the privacy policy, terms and GitHub in the footer", () => {
    expect(html).toContain(FOOTER_NAV);
    expect(html).toContain(GITHUB_LINK);
  });

  it("drops the removed sections and the false connector claim", () => {
    for (const text of REMOVED_TEXT) {
      expect(html).not.toContain(text);
    }
    expect(html).not.toMatch(/cannot (send|take)/i);
  });

  it("has no script, style element or inline style and only the GitHub external link", () => {
    expect(html).not.toContain(SCRIPT_OPEN_TAG);
    expect(html).not.toContain("<style");
    expect(html).not.toContain("style=");
    expect([...html.matchAll(/href="(http[^"]+)"/g)].map((match) => match[1])).toEqual([
      "https://github.com/ahmed-essawy/egx-mcp",
    ]);
  });
});

describe("path constants", () => {
  it("names the home, privacy and terms paths", () => {
    expect(HOME_PATH).toBe("/");
    expect(PRIVACY_PATH).toBe("/privacy");
    expect(TERMS_PATH).toBe("/terms");
    expect(MCP_PATH).toBe("/mcp");
  });

  it("builds the mcp url from an origin", () => {
    expect(mcpUrl("https://egx.example.com")).toBe("https://egx.example.com/mcp");
  });
});

describe("STYLESHEET", () => {
  it("styles the header row without external images", () => {
    expect(STYLESHEET).toContain("header, main, footer {");
    expect(STYLESHEET).toContain("header { display: flex;");
    expect(STYLESHEET).toContain(".affiliation");
  });

  it("styles the footer like the main content and separates it with a border", () => {
    expect(STYLESHEET).toContain("main, footer {");
    expect(STYLESHEET).toContain("footer { border-top");
  });

  it("supports light and dark color schemes", () => {
    expect(STYLESHEET).toContain("color-scheme: light dark");
    expect(STYLESHEET).toContain("@media (prefers-color-scheme: dark)");
  });

  it("loads nothing external", () => {
    expect(STYLESHEET).not.toContain("@import");
    expect(STYLESHEET).not.toContain("url(");
  });

  it("declares hex colors only in custom properties", () => {
    const declarations = [...STYLESHEET.matchAll(HEX_DECLARATION_PATTERN)];

    expect(declarations.length).toBeGreaterThan(0);
    for (const declaration of declarations) {
      expect(declaration[1], declaration[0]).toMatch(/^--/);
    }
  });
});

describe("page", () => {
  const html = page("Title", "<p>body</p>");

  it("declares the English language", () => {
    expect(html).toContain('<html lang="en"');
  });

  it("starts the body with a skip link to the main content", () => {
    expect(html).toMatch(/<a [^>]*href="#main"[^>]*>[^<]*<\/a>/i);
    expect(html).toMatch(/<main [^>]*id="main"/i);
  });

  it("links the stylesheet and carries no inline styles", () => {
    expect(html).toContain('<link rel="stylesheet" href="/styles.css">');
    expect(html).not.toMatch(/<style/i);
    expect(html).not.toMatch(/style=/i);
  });

  it("links the favicons and the apple touch icon before the stylesheet", () => {
    expect(html).toContain(ICON_LINKS);
    expect(html.indexOf(ICON_LINKS)).toBeLessThan(html.indexOf('<link rel="stylesheet"'));
  });

  it("shows the linked logo with alt text and the affiliation in a header between the skip link and main", () => {
    expect(html).toContain(SITE_HEADER);
    expect(html.indexOf('href="#main"')).toBeLessThan(html.indexOf("<header>"));
    expect(html.indexOf("<header>")).toBeLessThan(html.indexOf("<main"));
  });

  it("escapes the title and keeps the body markup", () => {
    const output = page(SCRIPT_PAYLOAD, "<p>body</p>");

    expect(output).toContain(ESCAPED_SCRIPT_OPEN);
    expect(output).toContain("<p>body</p>");
  });

  it("ends with the site footer navigation after the main content", () => {
    expect(html).toContain(FOOTER_NAV);
    expect(html.indexOf("</main>")).toBeLessThan(html.indexOf("<footer>"));
  });
});
