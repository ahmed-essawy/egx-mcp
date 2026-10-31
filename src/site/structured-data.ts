import { LARGE_ICON_PATH, LARGE_ICON_SIZE } from "../http/icons";
import type { Block, PageContent, SiteContext } from "./content-model";
import { LOCALIZED, SITE } from "./identity";
import { HOME_PATH, PREVIEW_IMAGE_PATH } from "./paths";
import { PAGES, type PublicPage } from "./pages";

type JsonNode = Record<string, unknown>;
type StepsBlock = Extract<Block, { kind: "steps" }>;

export type BreadcrumbItem = { name: string; path: string };

const SCHEMA_CONTEXT = "https://schema.org";
const CODE_MARKER_PATTERN = /`([^`]+)`/g;
const JSON_ESCAPES: Readonly<Record<string, string>> = { "<": "\\u003c", ">": "\\u003e", "&": "\\u0026" };
const JSON_ESCAPE_PATTERN = /[<>&]/g;

function plain(text: string): string {
  return text.replace(CODE_MARKER_PATTERN, "$1");
}

function reference(id: string): JsonNode {
  return { "@id": id };
}

export function breadcrumbTrail(page: PublicPage): BreadcrumbItem[] {
  return [
    { name: LOCALIZED[page.lang].homeLabel, path: HOME_PATH },
    { name: page.breadcrumb, path: page.path },
  ];
}

function organization(ctx: SiteContext): JsonNode {
  return {
    "@type": "Organization",
    "@id": `${ctx.origin}/#organization`,
    name: SITE.publisherName,
    url: `${ctx.origin}/`,
    logo: { "@type": "ImageObject", url: `${ctx.origin}${LARGE_ICON_PATH}`, width: LARGE_ICON_SIZE, height: LARGE_ICON_SIZE },
    sameAs: [SITE.repositoryUrl],
    contactPoint: { "@type": "ContactPoint", contactType: "customer support", url: SITE.issuesUrl },
  };
}

function website(ctx: SiteContext): JsonNode {
  return {
    "@type": "WebSite",
    "@id": `${ctx.origin}/#website`,
    name: SITE.name,
    url: `${ctx.origin}/`,
    inLanguage: [...new Set(PAGES.map((page) => page.lang))],
    publisher: reference(`${ctx.origin}/#organization`),
  };
}

function software(ctx: SiteContext): JsonNode {
  return {
    "@type": "SoftwareApplication",
    "@id": `${ctx.origin}/#software`,
    name: SITE.name,
    description: SITE.oneLine,
    url: `${ctx.origin}/`,
    image: `${ctx.origin}${PREVIEW_IMAGE_PATH}`,
    applicationCategory: "FinanceApplication",
    operatingSystem: "Any",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    publisher: reference(`${ctx.origin}/#organization`),
  };
}

function breadcrumbList(page: PublicPage, ctx: SiteContext): JsonNode {
  return {
    "@type": "BreadcrumbList",
    "@id": `${ctx.origin}${page.path}#breadcrumb`,
    itemListElement: breadcrumbTrail(page).map(({ name, path }, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name,
      item: `${ctx.origin}${path}`,
    })),
  };
}

function faqPage(page: PublicPage, ctx: SiteContext, content: PageContent): JsonNode {
  return {
    "@type": "FAQPage",
    "@id": `${ctx.origin}${page.path}#faq`,
    mainEntity: (content.faq ?? []).map(({ question, answer }) => ({
      "@type": "Question",
      name: plain(question),
      acceptedAnswer: { "@type": "Answer", text: plain(answer) },
    })),
  };
}

function stepsBlockOf(content: PageContent): StepsBlock | undefined {
  return content.sections
    .flatMap((section) => section.blocks)
    .find((block): block is StepsBlock => block.kind === "steps");
}

function howTo(page: PublicPage, ctx: SiteContext, steps: StepsBlock): JsonNode {
  return {
    "@type": "HowTo",
    "@id": `${ctx.origin}${page.path}#howto`,
    name: plain(steps.name),
    step: steps.items.map((item, index) => ({
      "@type": "HowToStep",
      position: index + 1,
      name: `Step ${index + 1}`,
      text: plain(item),
    })),
  };
}

function webPage(page: PublicPage, ctx: SiteContext): JsonNode {
  const base: JsonNode = {
    "@type": "WebPage",
    "@id": `${ctx.origin}${page.path}#webpage`,
    url: `${ctx.origin}${page.path}`,
    name: page.title(ctx),
    description: page.description,
    inLanguage: page.lang,
    dateModified: page.updated,
    isPartOf: reference(`${ctx.origin}/#website`),
  };
  if (page.kind === "home") return { ...base, about: reference(`${ctx.origin}/#software`) };
  const withBreadcrumb = { ...base, breadcrumb: reference(`${ctx.origin}${page.path}#breadcrumb`) };
  if (page.kind === "faq") return { ...withBreadcrumb, mainEntity: reference(`${ctx.origin}${page.path}#faq`) };
  return withBreadcrumb;
}

function graphNodes(page: PublicPage, ctx: SiteContext): JsonNode[] {
  if (page.kind === "home") return [organization(ctx), website(ctx), software(ctx), webPage(page, ctx)];
  const nodes = [webPage(page, ctx), breadcrumbList(page, ctx)];
  if (page.kind === "faq") return [...nodes, faqPage(page, ctx, page.content(ctx))];
  if (page.kind !== "guide") return nodes;
  const steps = stepsBlockOf(page.content(ctx));
  return steps === undefined ? nodes : [...nodes, howTo(page, ctx, steps)];
}

export function structuredDataJson(page: PublicPage, ctx: SiteContext): string {
  const graph = { "@context": SCHEMA_CONTEXT, "@graph": graphNodes(page, ctx) };
  return JSON.stringify(graph).replace(JSON_ESCAPE_PATTERN, (character) => JSON_ESCAPES[character] ?? character);
}
