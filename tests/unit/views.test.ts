import { describe, expect, it } from "vitest";
import {
  consentView,
  dashboardView,
  escapeHtml,
  HOME_PATH,
  landingView,
  page,
  PRIVACY_PATH,
  STYLESHEET,
  TERMS_PATH,
  type DashboardInput,
} from "../../src/http/views";
import { FOOTER_NAV } from "../helpers/html";

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
const AGREEMENT_PARAGRAPH_PATTERN = /<p>By [^<]*you agree to the[\s\S]*?<\/p>/;

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
  const html = landingView();

  it("lists the data sources", () => {
    for (const source of ["EGX website", "TradingView", "Mubasher Info", "iSagha"]) {
      expect(html).toContain(source);
    }
  });

  it("links the README and the dashboard", () => {
    expect(html).toMatch(/href="[^"]*#readme"/);
    expect(html).toContain('href="/dashboard"');
  });

  it("shows the agreement notice with both policy links after the dashboard link", () => {
    const notice = AGREEMENT_PARAGRAPH_PATTERN.exec(html)?.[0] ?? "";

    expect(notice).toContain(SIGN_IN_AGREEMENT);
    expect(notice).toContain('href="/terms"');
    expect(notice).toContain('href="/privacy"');
    expect(html.indexOf(SIGN_IN_AGREEMENT)).toBeGreaterThan(html.indexOf('href="/dashboard"'));
  });
});

describe("path constants", () => {
  it("names the home, privacy and terms paths", () => {
    expect(HOME_PATH).toBe("/");
    expect(PRIVACY_PATH).toBe("/privacy");
    expect(TERMS_PATH).toBe("/terms");
  });
});

describe("STYLESHEET", () => {
  it("styles the footer like the main content and separates it with a border", () => {
    expect(STYLESHEET).toContain("main, footer {");
    expect(STYLESHEET).toContain("footer { border-top");
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
