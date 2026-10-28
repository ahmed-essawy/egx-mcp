import { describe, expect, it } from "vitest";
import {
  CONTACT_EMAIL,
  GOVERNING_LAW_TEXT,
  LEGAL_LAST_UPDATED,
  OPERATOR_NAME,
  privacyView,
  termsView,
} from "../../src/http/legal";
import { DATA_SOURCES } from "../../src/http/views";
import { FOOTER_NAV } from "../helpers/html";

const LAST_UPDATED_DATE = "2026-10-28";
const OPERATOR = "Ahmed M. Essawy";
const CONTACT = "ahm.elessawy@gmail.com";
const MAILTO_LINK = `href="mailto:${CONTACT}"`;
const H2_PATTERN = /<h2[^>]*>([^<]+)<\/h2>/g;
const SECTION_PATTERN = /<section\b[^>]*>/g;
const ARIA_LABELLEDBY_PATTERN = /aria-labelledby="([^"]+)"/;
const FORBIDDEN_MARKUP = ["<script", "<style", "style=", "<form"];

const PRIVACY_HEADINGS = [
  "Who runs this service",
  "What we collect and why",
  "What we do not collect",
  "Cookies",
  "Where data is stored and who processes it",
  "How API keys are stored",
  "Usage records and limits",
  "How long we keep data",
  "Your choices and account deletion",
  "Children",
  "Changes to this policy",
  "Contact",
];

const TERMS_HEADINGS = [
  "Acceptance",
  "The service",
  "Delayed and unofficial data",
  "Not investment advice",
  "No warranty",
  "Limitation of liability",
  "Acceptable use and limits",
  "API keys and your account",
  "Suspension and termination",
  "Governing law",
  "Changes to these terms",
  "Contact",
];

const PRIVACY_FACTS = [
  OPERATOR,
  MAILTO_LINK,
  "Google account identifier",
  "email address",
  "display name",
  "SHA-256",
  "90 days",
  "12 hours",
  "Cloudflare",
  "__Host-egx_session",
  "under 18",
  "30 days",
  "Delete account",
  "Cloudflare KV",
  "24 hours",
  'href="/terms"',
];

const TERMS_FACTS = [
  OPERATOR,
  MAILTO_LINK,
  "delayed",
  "unofficial",
  "informational only",
  "buy, sell or hold",
  "as is",
  'href="/privacy"',
];

function headingsOf(html: string): string[] {
  return Array.from(html.matchAll(H2_PATTERN), (match) => match[1] ?? "");
}

function sectionLabelsOf(html: string): string[] {
  return Array.from(html.matchAll(SECTION_PATTERN), (match) => ARIA_LABELLEDBY_PATTERN.exec(match[0])?.[1] ?? "");
}

function expectBasePageRules(html: string): void {
  for (const markup of FORBIDDEN_MARKUP) {
    expect(html).not.toContain(markup);
  }
  expect(html).toContain(FOOTER_NAV);
  expect(html).toContain(`Last updated: ${LAST_UPDATED_DATE}`);
  const labels = sectionLabelsOf(html);
  expect(labels.length).toBeGreaterThan(0);
  for (const label of labels) {
    expect(label).not.toBe("");
    expect(html).toMatch(new RegExp(`<h2[^>]*\\bid="${label}"`));
  }
}

describe("legal constants", () => {
  it("pins the operator, contact and last updated date", () => {
    expect(LEGAL_LAST_UPDATED).toBe(LAST_UPDATED_DATE);
    expect(OPERATOR_NAME).toBe(OPERATOR);
    expect(CONTACT_EMAIL).toBe(CONTACT);
  });
});

describe("privacyView", () => {
  const html = privacyView();

  it("renders the title heading", () => {
    expect(html).toContain("<h1>Privacy policy</h1>");
  });

  it("lists the twelve sections in order", () => {
    expect(headingsOf(html)).toEqual(PRIVACY_HEADINGS);
  });

  it.each(PRIVACY_FACTS)("states %s", (fact) => {
    expect(html).toContain(fact);
  });

  it("follows the shared page rules", () => {
    expectBasePageRules(html);
  });
});

describe("privacyView account deletion", () => {
  const html = privacyView();

  it("no longer defers deletion to a future button", () => {
    expect(html).not.toContain("until a delete button is available");
  });
});

describe("termsView", () => {
  const html = termsView();

  it("renders the title heading", () => {
    expect(html).toContain("<h1>Terms of use</h1>");
  });

  it("lists the twelve sections in order", () => {
    expect(headingsOf(html)).toEqual(TERMS_HEADINGS);
  });

  it.each(TERMS_FACTS)("states %s", (fact) => {
    expect(html).toContain(fact);
  });

  it.each(DATA_SOURCES)("names the data source %s", (source) => {
    expect(html).toContain(source);
  });

  it("states the governing law text", () => {
    expect(html).toContain(GOVERNING_LAW_TEXT);
  });

  it("follows the shared page rules", () => {
    expectBasePageRules(html);
  });
});
