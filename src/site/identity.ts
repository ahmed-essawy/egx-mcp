export type Lang = "en";

export type SiteIdentity = {
  readonly name: string;
  readonly oneLine: string;
  readonly registryDescription: string;
  readonly shortDescription: string;
  readonly audience: string;
  readonly longDescription: string;
  readonly keywords: readonly string[];
  readonly publisherName: string;
  readonly repositoryUrl: string;
  readonly issuesUrl: string;
  readonly registryName: string;
  readonly previewImageAlt: string;
  readonly previewImageWidth: number;
  readonly previewImageHeight: number;
  readonly indexNowKey: string;
  readonly transportLabel: string;
  readonly signInMethods: string;
  readonly dataLimits: string;
};

export type LocalizedText = {
  readonly affiliation: string;
  readonly skipLink: string;
  readonly notice: string;
  readonly homeLabel: string;
  readonly breadcrumbLabel: string;
  readonly relatedHeading: string;
  readonly lastUpdated: string;
};

export const SITE: SiteIdentity = {
  name: "EGX MCP",
  oneLine:
    "EGX MCP is a free MCP server that lets AI assistants answer questions about Egyptian Exchange stocks, indices and funds with delayed data.",
  registryDescription: "Delayed Egyptian Exchange (EGX) stocks, indices, funds, gold and USD/EGP data for AI assistants.",
  shortDescription:
    "Free MCP server for Claude, ChatGPT, Claude Code and Cursor: delayed EGX stocks, indices, funds, gold and USD/EGP. Informational only, not advice.",
  audience:
    "It is for investors, analysts and developers who want to ask Claude, ChatGPT, Claude Code or Cursor about the Egyptian Exchange in plain English or Arabic.",
  longDescription:
    "EGX MCP connects AI assistants to stored Egyptian Exchange data through the Model Context Protocol. It answers questions about EGX stocks, the EGX30, EGX70 and EGX100 indices, Egyptian mutual funds, dividends and company figures, Egyptian gold and silver prices and the USD/EGP rate. Every answer carries the data time, the source and a delayed label. It is free, independent and for information only.",
  keywords: [
    "EGX",
    "Egyptian Exchange",
    "EGX30",
    "EGX70",
    "Egyptian stocks",
    "Egypt stock market",
    "MCP server",
    "Model Context Protocol",
    "Claude",
    "ChatGPT",
    "Claude Code",
    "Cursor",
    "Egyptian mutual funds",
    "gold price Egypt",
    "USD EGP",
    "البورصة المصرية",
    "الأسهم المصرية",
  ],
  publisherName: "EGX MCP",
  repositoryUrl: "https://github.com/ahmed-essawy/egx-mcp",
  issuesUrl: "https://github.com/ahmed-essawy/egx-mcp/issues",
  registryName: "io.github.ahmed-essawy/egx-mcp",
  previewImageAlt: "EGX MCP logo with the words Egyptian Exchange data for AI assistants",
  previewImageWidth: 1200,
  previewImageHeight: 630,
  indexNowKey: "c60c57998197b5e5b4a9fc2f935a3c44",
  transportLabel: "Streamable HTTP",
  signInMethods: "Google sign-in (OAuth) or an API key sent as `Authorization: Bearer <your key>`",
  dataLimits:
    "Data is delayed (about 15 minutes during the session), unofficial and for information only. It is not investment advice, and EGX MCP is not affiliated with the Egyptian Exchange.",
};

export const RATE_LIMIT_PER_MINUTE = 10;

export const INDEXNOW_KEY_PATH = `/${SITE.indexNowKey}.txt`;

export const LOCALIZED: Readonly<Record<Lang, LocalizedText>> = {
  en: {
    affiliation: "Independent service, not affiliated with the Egyptian Exchange.",
    skipLink: "Skip to main content",
    notice:
      "Data is delayed, unofficial and for information only, not financial advice. Sources: EGX website, TradingView, Mubasher Info, iSagha.",
    homeLabel: "Home",
    breadcrumbLabel: "Breadcrumb",
    relatedHeading: "Related pages",
    lastUpdated: "Last updated",
  },
};
