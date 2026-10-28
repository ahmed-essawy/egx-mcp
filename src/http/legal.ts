import { DATA_SOURCES, PRIVACY_LINK, TERMS_LINK, page } from "./views";

export const LEGAL_LAST_UPDATED = "2026-10-28";
export const OPERATOR_NAME = "Ahmed M. Essawy";
export const CONTACT_EMAIL = "ahm.elessawy@gmail.com";
export const GOVERNING_LAW_TEXT = "These terms do not limit rights you have under mandatory laws where you live.";

type LegalSection = { id: string; title: string; paragraphs: string[] };

const CONTACT_LINK = `<a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>`;

function section({ id, title, paragraphs }: LegalSection): string {
  const body = paragraphs.map((text) => `<p>${text}</p>`).join("\n");
  return `<section aria-labelledby="${id}">
<h2 id="${id}">${title}</h2>
${body}
</section>`;
}

function legalPage(title: string, sections: LegalSection[]): string {
  const body = sections.map(section).join("\n");
  return page(title, `<h1>${title}</h1>\n<p>Last updated: ${LEGAL_LAST_UPDATED}</p>\n${body}`);
}

function contactSection(): LegalSection {
  return {
    id: "contact",
    title: "Contact",
    paragraphs: [`${OPERATOR_NAME}, ${CONTACT_LINK}.`],
  };
}

const PRIVACY_SECTIONS: LegalSection[] = [
  {
    id: "operator",
    title: "Who runs this service",
    paragraphs: [
      `EGX MCP is run by ${OPERATOR_NAME}. You can reach the operator at ${CONTACT_LINK}.`,
      "The service is free and has no ads.",
    ],
  },
  {
    id: "collected",
    title: "What we collect and why",
    paragraphs: [
      "When you sign in with Google (scopes openid email profile) we receive your Google account identifier, your email address and your display name. We use the identifier and email address to identify your account, show who is signed in and apply the limits that the operator sets for individual accounts. Your display name is stored with your account and is not shown or shared.",
      "We keep a record for each API key you create (see how API keys are stored) and a count of your calls per tool per day (see usage records and limits).",
      "If you use the portfolio and price-level features, the holdings (symbol, quantity, cost per share, acquisition date) and price levels (symbol, above or below, level, last crossing time) you save will be used only to answer your own requests and will be visible only to you.",
    ],
  },
  {
    id: "not-collected",
    title: "What we do not collect",
    paragraphs: [
      "We do not receive your Google password, your contacts, Drive, Gmail or other Google data, payment data or your location. We use no advertising or analytics trackers and no third-party scripts.",
      "The questions you type into your AI assistant are not received. We receive only the tool calls it makes, and their arguments are not stored.",
      "Personal data is never sold or shared for advertising.",
    ],
  },
  {
    id: "cookies",
    title: "Cookies",
    paragraphs: [
      "The cookie __Host-egx_session is signed, HttpOnly and Secure, lasts 12 hours and keeps you signed in to the dashboard. The cookie __Host-egx_login lasts 10 minutes and protects the Google sign-in step.",
      "Both are strictly necessary. We set no other cookies.",
    ],
  },
  {
    id: "storage",
    title: "Where data is stored and who processes it",
    paragraphs: [
      "The service runs on Cloudflare (Workers, the D1 database and KV storage). As host, Cloudflare processes request data such as IP addresses under its own privacy policy, and data may be stored or processed outside your country.",
      "Google processes your sign-in under its own privacy policy. Market data sources never receive your personal data.",
    ],
  },
  {
    id: "api-keys",
    title: "How API keys are stored",
    paragraphs: [
      "The full key is shown once and is never stored. We keep only a SHA-256 hash of it, the 8 characters that follow egx_, the name you give it and its created, last used and revoked times. You can revoke a key at any time in the dashboard.",
    ],
  },
  {
    id: "usage",
    title: "Usage records and limits",
    paragraphs: [
      "We record the number of calls per tool per account per UTC day. They are used to apply the daily limits and are shown on your dashboard. Short-lived per-minute rate counters are kept per account.",
    ],
  },
  {
    id: "retention",
    title: "How long we keep data",
    paragraphs: [
      "Your account and API key records are kept until your account is deleted. If you use the portfolio and price-level features, your holdings and price levels are kept until your account is deleted.",
      "Daily usage counters are kept for operating the limits, and we aim to delete them after 90 days. Sign-in sessions last 12 hours. Cloudflare keeps its own logs under its own policy.",
    ],
  },
  {
    id: "choices",
    title: "Your choices and account deletion",
    paragraphs: [
      "In the dashboard you can see your email, your keys and today's usage, and you can revoke keys. You can remove the app's access in your Google account settings.",
      `To delete your account and all its data, email ${CONTACT_LINK} from the address of the account. We handle requests within 30 days. This applies until a delete button is available in the dashboard.`,
    ],
  },
  {
    id: "children",
    title: "Children",
    paragraphs: ["The service is not intended for anyone under 18, and people under 18 may not use it."],
  },
  {
    id: "changes",
    title: "Changes to this policy",
    paragraphs: [
      `Changes are posted on this page with a new "Last updated" date. Using the service is also subject to the ${TERMS_LINK}.`,
    ],
  },
  contactSection(),
];

const TERMS_SECTIONS: LegalSection[] = [
  {
    id: "acceptance",
    title: "Acceptance",
    paragraphs: [
      `By using the service, signing in or creating an API key you accept these terms and the ${PRIVACY_LINK}.`,
      "EGX MCP is not affiliated with, endorsed by or sponsored by the Egyptian Exchange.",
    ],
  },
  {
    id: "service",
    title: "The service",
    paragraphs: [
      `EGX MCP is a free MCP server and dashboard run by ${OPERATOR_NAME}. It answers questions about Egyptian Exchange market data from stored data. It may change, be limited or stop at any time without notice.`,
    ],
  },
  {
    id: "data",
    title: "Delayed and unofficial data",
    paragraphs: [
      "Data is delayed (not real-time), unofficial and informational only.",
      `It comes, or will come, from free public sources (${DATA_SOURCES.join(", ")}) and the Egyptian Exchange has not given permission to redistribute it. It can be late, wrong or missing. Check an official source before acting.`,
    ],
  },
  {
    id: "advice",
    title: "Not investment advice",
    paragraphs: [
      "Nothing from the service is financial, investment, tax or legal advice, or a buy, sell or hold recommendation. Decisions are yours.",
    ],
  },
  {
    id: "warranty",
    title: "No warranty",
    paragraphs: ["The service is provided as is and as available, without warranties of any kind."],
  },
  {
    id: "liability",
    title: "Limitation of liability",
    paragraphs: [
      "To the extent the law allows, the operator is not liable for any loss from the use of the service or its data, including trading losses.",
    ],
  },
  {
    id: "use",
    title: "Acceptable use and limits",
    paragraphs: [
      "By default each account has a daily limit and a per-minute limit on tool calls (100 calls per day and 10 per minute); the operator may set other limits for some accounts, and sets a global daily cap. When a call is refused, the message says when to retry.",
      "Do not bypass the limits (for example with several accounts or shared keys), copy the data in bulk or resell it, attack the service, or try to reach other users' data.",
    ],
  },
  {
    id: "keys",
    title: "API keys and your account",
    paragraphs: [
      "Keep your API keys secret. You are responsible for calls made with them. Revoke a leaked key at once in the dashboard. One person per account.",
    ],
  },
  {
    id: "termination",
    title: "Suspension and termination",
    paragraphs: [
      `You may stop using the service at any time and ask for your account to be deleted (see the ${PRIVACY_LINK}). The operator may revoke keys or block accounts that break these terms.`,
    ],
  },
  {
    id: "law",
    title: "Governing law",
    paragraphs: [GOVERNING_LAW_TEXT],
  },
  {
    id: "changes",
    title: "Changes to these terms",
    paragraphs: ["Changes are posted here with a new date. Continued use means you accept them."],
  },
  contactSection(),
];

export function privacyView(): string {
  return legalPage("Privacy policy", PRIVACY_SECTIONS);
}

export function termsView(): string {
  return legalPage("Terms of use", TERMS_SECTIONS);
}
