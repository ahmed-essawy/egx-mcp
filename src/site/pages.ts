import { LEGAL_LAST_UPDATED, PRIVACY_SECTIONS, TERMS_SECTIONS, type LegalSection } from "../http/legal";
import { TOOL_NAMES } from "../mcp/tool-names";
import type { PageContent, SiteContext } from "./content-model";
import { dataContent, faqContent, guideContent, homeContent, toolsContent } from "./content/en";
import type { Lang } from "./identity";
import {
  CONNECT_CHATGPT_PATH,
  CONNECT_CLAUDE_CODE_PATH,
  CONNECT_CLAUDE_PATH,
  CONNECT_CURSOR_PATH,
  DATA_PATH,
  FAQ_PATH,
  HOME_PATH,
  PRIVACY_PATH,
  TERMS_PATH,
  TOOLS_PATH,
} from "./paths";

export type PageKind = "home" | "content" | "guide" | "faq" | "legal";

export type PublicPage = {
  id: string;
  topic: string;
  lang: Lang;
  path: string;
  title: (ctx: SiteContext) => string;
  heading: string;
  description: string;
  breadcrumb: string;
  updated: string;
  kind: PageKind;
  related: readonly string[];
  content: (ctx: SiteContext) => PageContent;
};

export const LEGAL_SECTIONS: Readonly<Record<string, readonly LegalSection[]>> = {
  privacy: PRIVACY_SECTIONS,
  terms: TERMS_SECTIONS,
};

const SITE_PAGES_UPDATED = "2026-10-31";
const CONNECT_GUIDES = ["connect-claude", "connect-chatgpt", "connect-claude-code", "connect-cursor"];

function otherGuides(id: string): string[] {
  return CONNECT_GUIDES.filter((guide) => guide !== id);
}

const NO_CONTENT: PageContent = { lead: [], sections: [] };

export const PAGES: readonly PublicPage[] = [
  {
    id: "home",
    topic: "home",
    lang: "en",
    path: HOME_PATH,
    title: () => "EGX MCP: Egyptian Exchange data for AI assistants",
    heading: "EGX MCP",
    description:
      "Free MCP server for Claude, ChatGPT, Claude Code and Cursor: ask about EGX stocks, indices, funds, gold and USD/EGP. Delayed data, not advice.",
    breadcrumb: "Home",
    updated: SITE_PAGES_UPDATED,
    kind: "home",
    related: [],
    content: homeContent,
  },
  {
    id: "tools",
    topic: "tools",
    lang: "en",
    path: TOOLS_PATH,
    title: () => `Tool catalog: the ${TOOL_NAMES.length} EGX MCP tools and what they return`,
    heading: "Tool catalog",
    description:
      "Every EGX MCP tool with a plain description, an example question and what it returns: quotes, indices, history, funds, company data and more.",
    breadcrumb: "Tools",
    updated: SITE_PAGES_UPDATED,
    kind: "content",
    related: ["connect-claude", "faq", "data"],
    content: toolsContent,
  },
  {
    id: "connect-claude",
    topic: "connect-claude",
    lang: "en",
    path: CONNECT_CLAUDE_PATH,
    title: () => "Connect EGX MCP to Claude: custom connector steps",
    heading: "Connect EGX MCP to Claude",
    description:
      "Add EGX MCP to Claude as a custom connector in four steps, with Google sign-in or an API key, and what to do if the connection fails.",
    breadcrumb: "Connect Claude",
    updated: SITE_PAGES_UPDATED,
    kind: "guide",
    related: [...otherGuides("connect-claude"), "tools", "faq"],
    content: (ctx) => guideContent("claude", ctx),
  },
  {
    id: "connect-chatgpt",
    topic: "connect-chatgpt",
    lang: "en",
    path: CONNECT_CHATGPT_PATH,
    title: () => "Connect EGX MCP to ChatGPT: developer mode steps",
    heading: "Connect EGX MCP to ChatGPT",
    description:
      "Add EGX MCP to ChatGPT in developer mode with Google sign-in, ask about Egyptian stocks, and fix the most common connection problems.",
    breadcrumb: "Connect ChatGPT",
    updated: SITE_PAGES_UPDATED,
    kind: "guide",
    related: [...otherGuides("connect-chatgpt"), "tools", "faq"],
    content: (ctx) => guideContent("chatgpt", ctx),
  },
  {
    id: "connect-claude-code",
    topic: "connect-claude-code",
    lang: "en",
    path: CONNECT_CLAUDE_CODE_PATH,
    title: () => "Connect EGX MCP to Claude Code: one command setup",
    heading: "Connect EGX MCP to Claude Code",
    description:
      "Add EGX MCP to Claude Code with one claude mcp add command, sign in with Google or pass an API key header, then check it with /mcp.",
    breadcrumb: "Connect Claude Code",
    updated: SITE_PAGES_UPDATED,
    kind: "guide",
    related: [...otherGuides("connect-claude-code"), "tools", "faq"],
    content: (ctx) => guideContent("claude-code", ctx),
  },
  {
    id: "connect-cursor",
    topic: "connect-cursor",
    lang: "en",
    path: CONNECT_CURSOR_PATH,
    title: () => "Connect EGX MCP to Cursor: mcp.json setup steps",
    heading: "Connect EGX MCP to Cursor",
    description:
      "Add EGX MCP to Cursor through mcp.json with the server address and an API key header, reload the MCP list and ask about EGX stocks.",
    breadcrumb: "Connect Cursor",
    updated: SITE_PAGES_UPDATED,
    kind: "guide",
    related: [...otherGuides("connect-cursor"), "tools", "faq"],
    content: (ctx) => guideContent("cursor", ctx),
  },
  {
    id: "faq",
    topic: "faq",
    lang: "en",
    path: FAQ_PATH,
    title: () => "Questions and answers about EGX MCP: data, cost, privacy",
    heading: "Questions and answers",
    description:
      "Straight answers about EGX MCP: is it free, how delayed the data is, which sources and assistants it uses, privacy, account deletion and advice.",
    breadcrumb: "Questions",
    updated: SITE_PAGES_UPDATED,
    kind: "faq",
    related: ["tools", "data", "connect-claude"],
    content: faqContent,
  },
  {
    id: "data",
    topic: "data",
    lang: "en",
    path: DATA_PATH,
    title: () => "Data sources and limits of EGX MCP: delayed, unofficial",
    heading: "Data sources and limits",
    description:
      "Where EGX MCP data comes from, how late it is, what it covers and what it does not, and the daily limits of the free service.",
    breadcrumb: "Data and limits",
    updated: SITE_PAGES_UPDATED,
    kind: "content",
    related: ["faq", "tools", "privacy"],
    content: dataContent,
  },
  {
    id: "privacy",
    topic: "privacy",
    lang: "en",
    path: PRIVACY_PATH,
    title: () => "Privacy policy: EGX MCP",
    heading: "Privacy policy",
    description:
      "How EGX MCP handles your Google sign-in data, API keys, usage counts, portfolio and price levels, and how to delete your account.",
    breadcrumb: "Privacy policy",
    updated: LEGAL_LAST_UPDATED,
    kind: "legal",
    related: [],
    content: () => NO_CONTENT,
  },
  {
    id: "terms",
    topic: "terms",
    lang: "en",
    path: TERMS_PATH,
    title: () => "Terms of use: EGX MCP",
    heading: "Terms of use",
    description:
      "The terms for using EGX MCP: a free service with delayed, unofficial data for information only, fair use limits, and no investment advice.",
    breadcrumb: "Terms of use",
    updated: LEGAL_LAST_UPDATED,
    kind: "legal",
    related: [],
    content: () => NO_CONTENT,
  },
];

export function pageById(id: string): PublicPage {
  const page = PAGES.find((candidate) => candidate.id === id);
  if (page === undefined) throw new Error(`unknown page ${id}`);
  return page;
}

export function legalSectionsOf(page: PublicPage): readonly LegalSection[] {
  const sections = LEGAL_SECTIONS[page.id];
  if (sections === undefined) throw new Error(`no legal text for ${page.id}`);
  return sections;
}

export function pageByPath(path: string): PublicPage | undefined {
  return PAGES.find((page) => page.path === path);
}

export function alternatesOf(page: PublicPage): readonly PublicPage[] {
  const translations = PAGES.filter((candidate) => candidate.topic === page.topic);
  return translations.length >= 2 ? translations : [];
}

export function homeOf(lang: Lang): PublicPage {
  const home = PAGES.find((page) => page.kind === "home" && page.lang === lang);
  if (home === undefined) throw new Error(`no home page for ${lang}`);
  return home;
}

export function newestUpdated(): string {
  return PAGES.reduce((newest, page) => (page.updated > newest ? page.updated : newest), "");
}
