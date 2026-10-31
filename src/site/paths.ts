import { SITE, type Lang } from "./identity";

export const HOME_PATH = "/";
export const TOOLS_PATH = "/tools";
export const CONNECT_CLAUDE_PATH = "/connect/claude";
export const CONNECT_CHATGPT_PATH = "/connect/chatgpt";
export const CONNECT_CLAUDE_CODE_PATH = "/connect/claude-code";
export const CONNECT_CURSOR_PATH = "/connect/cursor";
export const FAQ_PATH = "/faq";
export const DATA_PATH = "/data";
export const PRIVACY_PATH = "/privacy";
export const TERMS_PATH = "/terms";
export const ROBOTS_PATH = "/robots.txt";
export const SITEMAP_PATH = "/sitemap.xml";
export const LLMS_PATH = "/llms.txt";
export const LLMS_FULL_PATH = "/llms-full.txt";
export const AI_CATALOG_PATH = "/.well-known/ai-catalog.json";
export const SERVER_CARD_PATH = "/mcp/server-card";
export const PREVIEW_IMAGE_PATH = "/og-image.png";
export const MARKDOWN_SUFFIX = ".md";
export const HOME_MARKDOWN_PATH = "/index.md";

export type FooterLink = { label: string; href: string };

export function absoluteHref(origin: string, href: string): string {
  return href.startsWith("/") ? `${origin}${href}` : href;
}

export function markdownPath(path: string): string {
  return path === HOME_PATH ? HOME_MARKDOWN_PATH : `${path}${MARKDOWN_SUFFIX}`;
}

export const FOOTER_LINKS: Readonly<Record<Lang, readonly FooterLink[]>> = {
  en: [
    { label: "Home", href: HOME_PATH },
    { label: "Tools", href: TOOLS_PATH },
    { label: "Connect Claude", href: CONNECT_CLAUDE_PATH },
    { label: "Connect ChatGPT", href: CONNECT_CHATGPT_PATH },
    { label: "Connect Claude Code", href: CONNECT_CLAUDE_CODE_PATH },
    { label: "Connect Cursor", href: CONNECT_CURSOR_PATH },
    { label: "Questions", href: FAQ_PATH },
    { label: "Data and limits", href: DATA_PATH },
    { label: "Privacy policy", href: PRIVACY_PATH },
    { label: "Terms of use", href: TERMS_PATH },
    { label: "GitHub", href: SITE.repositoryUrl },
  ],
};
