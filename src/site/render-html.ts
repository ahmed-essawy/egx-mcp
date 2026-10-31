import { legalBody } from "../http/legal";
import { baseHeadTags, connectSection, documentBody, escapeHtml, heroSection, htmlDocument } from "../http/views";
import type { Block, PageContent, QuestionAnswer, Section, SiteContext } from "./content-model";
import { LOCALIZED, SITE, type Lang } from "./identity";
import { markdownPath, PREVIEW_IMAGE_PATH } from "./paths";
import { legalSectionsOf, pageById, type PublicPage } from "./pages";
import { breadcrumbTrail, structuredDataJson } from "./structured-data";

const CODE_SPAN_PATTERN = /`([^`]+)`/g;
const DIRECTIONS: Readonly<Record<Lang, "ltr" | "rtl">> = { en: "ltr" };
const OPEN_GRAPH_LOCALES: Readonly<Record<Lang, string>> = { en: "en_US" };
const DEFAULT_SECTION_LEVEL = 2;
const RELATED_ID = "related";
const FAQ_ID_PREFIX = "faq-";

function inline(text: string): string {
  return escapeHtml(text).replace(CODE_SPAN_PATTERN, "<code>$1</code>");
}

function listItems(items: readonly string[]): string {
  return items.map((item) => `<li>${inline(item)}</li>`).join("\n");
}

function linkItem({ href, label, note }: { href: string; label: string; note?: string }): string {
  const suffix = note === undefined ? "" : `: ${inline(note)}`;
  return `<li><a href="${escapeHtml(href)}">${escapeHtml(label)}</a>${suffix}</li>`;
}

function tableBlock(head: readonly string[], rows: readonly (readonly string[])[]): string {
  const headCells = head.map((cell) => `<th scope="col">${inline(cell)}</th>`).join("");
  const bodyRows = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`)
    .join("\n");
  return `<table>\n<thead><tr>${headCells}</tr></thead>\n<tbody>\n${bodyRows}\n</tbody>\n</table>`;
}

function toolBlock(block: Extract<Block, { kind: "tool" }>): string {
  return [
    `<h3><code>${escapeHtml(block.name)}</code></h3>`,
    `<p>${inline(block.description)}</p>`,
    `<p>${escapeHtml(block.askLabel)} ${inline(`"${block.example}"`)}</p>`,
    `<p>${escapeHtml(block.returnsLabel)} ${inline(block.returns)}</p>`,
  ].join("\n");
}

function renderBlock(block: Block): string {
  switch (block.kind) {
    case "paragraph":
      return `<p>${inline(block.text)}</p>`;
    case "list":
      return `<ul>\n${listItems(block.items)}\n</ul>`;
    case "steps":
      return `<ol>\n${listItems(block.items)}\n</ol>`;
    case "table":
      return tableBlock(block.head, block.rows);
    case "code":
      return `<pre><code>${escapeHtml(block.text)}</code></pre>`;
    case "links":
      return `<ul>\n${block.items.map(linkItem).join("\n")}\n</ul>`;
    case "tool":
      return toolBlock(block);
  }
}

function renderSection({ id, heading, blocks, level = DEFAULT_SECTION_LEVEL }: Section): string {
  return `<section aria-labelledby="${id}">\n<h${level} id="${id}">${inline(heading)}</h${level}>\n${blocks.map(renderBlock).join("\n")}\n</section>`;
}

function renderQuestion({ question, answer }: QuestionAnswer, index: number): string {
  const id = `${FAQ_ID_PREFIX}${index + 1}`;
  return `<section aria-labelledby="${id}">\n<h2 id="${id}">${inline(question)}</h2>\n<p>${inline(answer)}</p>\n</section>`;
}

function relatedSection(page: PublicPage): string {
  const links = page.related.map((id) => {
    const related = pageById(id);
    return `<li><a href="${escapeHtml(related.path)}">${escapeHtml(related.heading)}</a></li>`;
  });
  return `<section aria-labelledby="${RELATED_ID}">\n<h2 id="${RELATED_ID}">${escapeHtml(LOCALIZED[page.lang].relatedHeading)}</h2>\n<ul>\n${links.join("\n")}\n</ul>\n</section>`;
}

function noticeParagraph(lang: Lang): string {
  return `<p class="notice">${escapeHtml(LOCALIZED[lang].notice)}</p>`;
}

function updatedParagraph(page: PublicPage): string {
  const date = escapeHtml(page.updated);
  return `<p class="updated">${escapeHtml(LOCALIZED[page.lang].lastUpdated)}: <time datetime="${date}">${date}</time></p>`;
}

function breadcrumbNav(page: PublicPage): string {
  const trail = breadcrumbTrail(page);
  const last = trail.length - 1;
  const items = trail.map(({ name, path }, index) =>
    index === last
      ? `<li aria-current="page">${escapeHtml(name)}</li>`
      : `<li><a href="${escapeHtml(path)}">${escapeHtml(name)}</a></li>`,
  );
  const label = escapeHtml(LOCALIZED[page.lang].breadcrumbLabel);
  return `<nav aria-label="${label}">\n<ol class="breadcrumb">\n${items.join("\n")}\n</ol>\n</nav>`;
}

function bodySections(content: PageContent): string[] {
  return [
    ...content.lead.map((paragraph) => `<p>${inline(paragraph)}</p>`),
    ...content.sections.map(renderSection),
    ...(content.faq ?? []).map(renderQuestion),
  ];
}

function legalMain(page: PublicPage): string {
  return [breadcrumbNav(page), legalBody(page.heading, legalSectionsOf(page))].join("\n");
}

function mainContent(page: PublicPage, ctx: SiteContext): string {
  if (page.kind === "legal") return legalMain(page);
  const content = page.content(ctx);
  const opening =
    page.kind === "home"
      ? [heroSection(), connectSection(ctx.mcpUrl)]
      : [breadcrumbNav(page), `<h1>${escapeHtml(page.heading)}</h1>`];
  const related = page.related.length === 0 ? [] : [relatedSection(page)];
  return [...opening, ...bodySections(content), ...related, noticeParagraph(page.lang), updatedParagraph(page)].join("\n");
}

function metaName(name: string, content: string): string {
  return `<meta name="${name}" content="${escapeHtml(content)}">`;
}

function metaProperty(property: string, content: string): string {
  return `<meta property="${property}" content="${escapeHtml(content)}">`;
}

function headTags(page: PublicPage, ctx: SiteContext): string {
  const title = page.title(ctx);
  const url = `${ctx.origin}${page.path}`;
  const image = `${ctx.origin}${PREVIEW_IMAGE_PATH}`;
  return [
    ...baseHeadTags(),
    `<title>${escapeHtml(title)}</title>`,
    metaName("description", page.description),
    `<link rel="canonical" href="${escapeHtml(url)}">`,
    `<link rel="alternate" type="text/markdown" href="${escapeHtml(`${ctx.origin}${markdownPath(page.path)}`)}">`,
    metaProperty("og:site_name", SITE.name),
    metaProperty("og:type", "website"),
    metaProperty("og:locale", OPEN_GRAPH_LOCALES[page.lang]),
    metaProperty("og:title", title),
    metaProperty("og:description", page.description),
    metaProperty("og:url", url),
    metaProperty("og:image", image),
    metaProperty("og:image:width", String(SITE.previewImageWidth)),
    metaProperty("og:image:height", String(SITE.previewImageHeight)),
    metaProperty("og:image:type", "image/png"),
    metaProperty("og:image:alt", SITE.previewImageAlt),
    metaName("twitter:card", "summary_large_image"),
    metaName("twitter:title", title),
    metaName("twitter:description", page.description),
    metaName("twitter:image", image),
    metaName("twitter:image:alt", SITE.previewImageAlt),
    `<script type="application/ld+json">${structuredDataJson(page, ctx)}</script>`,
  ].join("\n");
}

export function renderPageHtml(page: PublicPage, ctx: SiteContext): string {
  return htmlDocument({
    lang: page.lang,
    dir: DIRECTIONS[page.lang],
    head: headTags(page, ctx),
    body: documentBody(page.lang, mainContent(page, ctx)),
  });
}
