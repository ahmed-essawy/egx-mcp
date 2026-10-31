import { absoluteHref } from "./paths";

const ANCHOR_PATTERN = /<a href="([^"]*)">([^<]*)<\/a>/g;

export function legalParagraphToMarkdown(html: string, origin: string): string {
  return html.replace(
    ANCHOR_PATTERN,
    (_anchor, href: string, label: string) => `[${label}](${absoluteHref(origin, href)})`,
  );
}
