import { BEARER_HEADER, CONNECT_NOTE, VALUE_LINE } from "../http/views";
import type { Block, PageContent, QuestionAnswer, Section, SiteContext } from "./content-model";
import { LOCALIZED, SITE } from "./identity";
import { legalParagraphToMarkdown } from "./legal-text";
import { legalSectionsOf, newestUpdated, PAGES, pageById, type PublicPage } from "./pages";
import { absoluteHref, AI_CATALOG_PATH, LLMS_FULL_PATH, markdownPath, SERVER_CARD_PATH } from "./paths";
import { toolEntries } from "./tool-catalog";

const LISTED_KINDS: readonly PublicPage["kind"][] = ["home", "content", "guide", "faq"];
const CONNECT_HEADING = "Connect your assistant";
const CANONICAL_LABEL = "Canonical:";
const LEGAL_PAGES_HEADING = "Legal pages";
const SEPARATOR = "---";
const TABLE_PIPE_PATTERN = /\|/g;
const OPTIONAL_LINKS = [
  { path: LLMS_FULL_PATH, label: "Full content", note: "Every page, the tool list and the questions and answers in one file" },
  { path: SERVER_CARD_PATH, label: "MCP server card", note: "Machine-readable server address, transport and sign-in" },
  { path: AI_CATALOG_PATH, label: "AI catalog", note: "Discovery entry for the MCP server card" },
];

const englishPages = PAGES.filter((page) => page.lang === "en");

function absolute(ctx: SiteContext, href: string): string {
  return absoluteHref(ctx.origin, href);
}

function pageLink(page: PublicPage, ctx: SiteContext, path: string): string {
  return `- [${page.title(ctx)}](${absolute(ctx, path)}): ${page.description}`;
}

function tableCell(cell: string): string {
  return cell.replace(TABLE_PIPE_PATTERN, "\\|");
}

function tableRow(cells: readonly string[]): string {
  return `| ${cells.map(tableCell).join(" | ")} |`;
}

function fenced(language: string, text: string): string {
  return `\`\`\`${language}\n${text}\n\`\`\``;
}

function blockMarkdown(block: Block, ctx: SiteContext): string {
  switch (block.kind) {
    case "paragraph":
      return block.text;
    case "list":
      return block.items.map((item) => `- ${item}`).join("\n");
    case "steps":
      return block.items.map((item, index) => `${index + 1}. ${item}`).join("\n");
    case "table":
      return [tableRow(block.head), `|${block.head.map(() => "---").join("|")}|`, ...block.rows.map(tableRow)].join("\n");
    case "code":
      return fenced(block.language, block.text);
    case "links":
      return block.items
        .map((item) => `- [${item.label}](${absolute(ctx, item.href)})${item.note === undefined ? "" : `: ${item.note}`}`)
        .join("\n");
    case "tool":
      return [
        `### \`${block.name}\``,
        block.description,
        `${block.askLabel} "${block.example}"`,
        `${block.returnsLabel} ${block.returns}`,
      ].join("\n");
  }
}

function headingMarkdown(level: number, text: string): string {
  return `${"#".repeat(level)} ${text}`;
}

function sectionMarkdown(section: Section, ctx: SiteContext): string {
  const blocks = section.blocks.map((block) => blockMarkdown(block, ctx));
  return [headingMarkdown(section.level ?? 2, section.heading), ...blocks].join("\n\n");
}

function questionMarkdown({ question, answer }: QuestionAnswer): string {
  return `${headingMarkdown(2, question)}\n\n${answer}`;
}

function connectMarkdown(ctx: SiteContext): string {
  return [
    headingMarkdown(2, CONNECT_HEADING),
    fenced("text", ctx.mcpUrl),
    fenced("text", BEARER_HEADER),
    CONNECT_NOTE,
  ].join("\n\n");
}

function openingParts(page: PublicPage, content: PageContent, ctx: SiteContext): string[] {
  if (page.kind !== "home") return [...content.lead];
  return [VALUE_LINE, connectMarkdown(ctx)];
}

function relatedMarkdown(page: PublicPage, ctx: SiteContext): string[] {
  if (page.related.length === 0) return [];
  const links = page.related.map((id) => {
    const related = pageById(id);
    return pageLink(related, ctx, related.path);
  });
  return [`${headingMarkdown(2, LOCALIZED[page.lang].relatedHeading)}\n\n${links.join("\n")}`];
}

function legalMarkdown(page: PublicPage, ctx: SiteContext): string[] {
  return legalSectionsOf(page).map((section) =>
    [
      headingMarkdown(2, section.title),
      ...section.paragraphs.map((paragraph) => legalParagraphToMarkdown(paragraph, ctx.origin)),
    ].join("\n\n"),
  );
}

function pageBodyParts(page: PublicPage, ctx: SiteContext): string[] {
  if (page.kind === "legal") return legalMarkdown(page, ctx);
  const content = page.content(ctx);
  return [
    ...openingParts(page, content, ctx),
    ...content.sections.map((section) => sectionMarkdown(section, ctx)),
    ...(content.faq ?? []).map(questionMarkdown),
    ...relatedMarkdown(page, ctx),
    LOCALIZED[page.lang].notice,
  ];
}

function pageBody(page: PublicPage, ctx: SiteContext): string {
  return pageBodyParts(page, ctx).join("\n\n");
}

export function renderPageMarkdown(page: PublicPage, ctx: SiteContext): string {
  const footer = `${CANONICAL_LABEL} ${ctx.origin}${page.path}\n${LOCALIZED[page.lang].lastUpdated}: ${page.updated}`;
  return `${headingMarkdown(1, page.heading)}\n\n${pageBody(page, ctx)}\n\n${footer}\n`;
}

function summaryHeader(ctx: SiteContext): string {
  return [
    headingMarkdown(1, SITE.name),
    `> ${SITE.oneLine}`,
    `${SITE.audience} Server address: ${ctx.mcpUrl}. Transport: ${SITE.transportLabel}. Sign-in: ${SITE.signInMethods}. ${SITE.dataLimits}`,
    `${LOCALIZED.en.lastUpdated}: ${newestUpdated()}`,
  ].join("\n\n");
}

function listSection(heading: string, lines: readonly string[]): string {
  return `${headingMarkdown(2, heading)}\n\n${lines.join("\n")}`;
}

export function llmsTxt(ctx: SiteContext): string {
  const pages = englishPages.filter((page) => LISTED_KINDS.includes(page.kind));
  const legal = englishPages.filter((page) => page.kind === "legal");
  const optional = [
    ...legal.map((page) => pageLink(page, ctx, markdownPath(page.path))),
    ...OPTIONAL_LINKS.map(({ path, label, note }) => `- [${label}](${absolute(ctx, path)}): ${note}`),
  ];
  return `${[
    summaryHeader(ctx),
    listSection("Pages", pages.map((page) => pageLink(page, ctx, markdownPath(page.path)))),
    listSection(
      "Tools",
      toolEntries().map((entry) => `- \`${entry.name}\`: ${entry.description}`),
    ),
    listSection("Optional", optional),
  ].join("\n\n")}\n`;
}

function fullPageBlock(page: PublicPage, ctx: SiteContext): string {
  const source = `Source: ${ctx.origin}${page.path}\n${LOCALIZED[page.lang].lastUpdated}: ${page.updated}`;
  return [SEPARATOR, `${headingMarkdown(1, page.title(ctx))}\n\n${source}`, pageBody(page, ctx)].join("\n\n");
}

export function llmsFullTxt(ctx: SiteContext): string {
  const pages = englishPages.filter((page) => LISTED_KINDS.includes(page.kind));
  const legal = englishPages.filter((page) => page.kind === "legal");
  const legalBlock = [
    SEPARATOR,
    `${headingMarkdown(1, LEGAL_PAGES_HEADING)}\n\n${legal.map((page) => pageLink(page, ctx, page.path)).join("\n")}`,
  ].join("\n\n");
  return `${[summaryHeader(ctx), ...pages.map((page) => fullPageBlock(page, ctx)), legalBlock].join("\n\n")}\n`;
}
