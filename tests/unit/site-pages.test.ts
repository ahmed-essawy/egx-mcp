import { describe, expect, it } from "vitest";
import { LEGAL_LAST_UPDATED } from "../../src/http/legal";
import { TOOL_NAMES } from "../../src/mcp/tool-names";
import type { Block, PageContent, Section } from "../../src/site/content-model";
import { RATE_LIMIT_PER_MINUTE, SITE } from "../../src/site/identity";
import { FOOTER_LINKS } from "../../src/site/paths";
import { alternatesOf, homeOf, legalSectionsOf, PAGES, pageByPath, type PublicPage } from "../../src/site/pages";
import { MAX_ACTIVE_KEYS } from "../../src/store/d1/users";
import { MAX_ITEMS_PER_USER } from "../../src/store/d1/personal";
import { TEST_CONTEXT } from "../helpers/site";

const CTX = TEST_CONTEXT;
const MCP_URL = CTX.mcpUrl;
const DASHBOARD_URL = CTX.dashboardUrl;
const TITLE_MAX = 60;
const DESCRIPTION_MIN = 70;
const DESCRIPTION_MAX = 160;
const PATH_PATTERN = /^\/[a-z0-9/-]*$/;
const PLACEHOLDER_PATTERN = /\{[A-Za-z]+\}/;
const MAX_HOPS = 2;
const GUIDE_STEP_COUNT = 4;
const MIN_FAQ_PAIRS = 15;

type ExpectedPage = {
  id: string;
  path: string;
  title: string;
  heading: string;
  description: string;
  breadcrumb: string;
  kind: PublicPage["kind"];
  related: string[];
};

const EXPECTED_PAGES: ExpectedPage[] = [
  {
    id: "home",
    path: "/",
    title: "EGX MCP: Egyptian Exchange data for AI assistants",
    heading: "EGX MCP",
    description:
      "Free MCP server for Claude, ChatGPT, Claude Code and Cursor: ask about EGX stocks, indices, funds, gold and USD/EGP. Delayed data, not advice.",
    breadcrumb: "Home",
    kind: "home",
    related: [],
  },
  {
    id: "tools",
    path: "/tools",
    title: `Tool catalog: the ${TOOL_NAMES.length} EGX MCP tools and what they return`,
    heading: "Tool catalog",
    description:
      "Every EGX MCP tool with a plain description, an example question and what it returns: quotes, indices, history, funds, company data and more.",
    breadcrumb: "Tools",
    kind: "content",
    related: ["connect-claude", "faq", "data"],
  },
  {
    id: "connect-claude",
    path: "/connect/claude",
    title: "Connect EGX MCP to Claude: custom connector steps",
    heading: "Connect EGX MCP to Claude",
    description:
      "Add EGX MCP to Claude as a custom connector in four steps, with Google sign-in or an API key, and what to do if the connection fails.",
    breadcrumb: "Connect Claude",
    kind: "guide",
    related: ["connect-chatgpt", "connect-claude-code", "connect-cursor", "tools", "faq"],
  },
  {
    id: "connect-chatgpt",
    path: "/connect/chatgpt",
    title: "Connect EGX MCP to ChatGPT: developer mode steps",
    heading: "Connect EGX MCP to ChatGPT",
    description:
      "Add EGX MCP to ChatGPT in developer mode with Google sign-in, ask about Egyptian stocks, and fix the most common connection problems.",
    breadcrumb: "Connect ChatGPT",
    kind: "guide",
    related: ["connect-claude", "connect-claude-code", "connect-cursor", "tools", "faq"],
  },
  {
    id: "connect-claude-code",
    path: "/connect/claude-code",
    title: "Connect EGX MCP to Claude Code: one command setup",
    heading: "Connect EGX MCP to Claude Code",
    description:
      "Add EGX MCP to Claude Code with one claude mcp add command, sign in with Google or pass an API key header, then check it with /mcp.",
    breadcrumb: "Connect Claude Code",
    kind: "guide",
    related: ["connect-claude", "connect-chatgpt", "connect-cursor", "tools", "faq"],
  },
  {
    id: "connect-cursor",
    path: "/connect/cursor",
    title: "Connect EGX MCP to Cursor: mcp.json setup steps",
    heading: "Connect EGX MCP to Cursor",
    description:
      "Add EGX MCP to Cursor through mcp.json with the server address and an API key header, reload the MCP list and ask about EGX stocks.",
    breadcrumb: "Connect Cursor",
    kind: "guide",
    related: ["connect-claude", "connect-chatgpt", "connect-claude-code", "tools", "faq"],
  },
  {
    id: "faq",
    path: "/faq",
    title: "Questions and answers about EGX MCP: data, cost, privacy",
    heading: "Questions and answers",
    description:
      "Straight answers about EGX MCP: is it free, how delayed the data is, which sources and assistants it uses, privacy, account deletion and advice.",
    breadcrumb: "Questions",
    kind: "faq",
    related: ["tools", "data", "connect-claude"],
  },
  {
    id: "data",
    path: "/data",
    title: "Data sources and limits of EGX MCP: delayed, unofficial",
    heading: "Data sources and limits",
    description:
      "Where EGX MCP data comes from, how late it is, what it covers and what it does not, and the daily limits of the free service.",
    breadcrumb: "Data and limits",
    kind: "content",
    related: ["faq", "tools", "privacy"],
  },
  {
    id: "privacy",
    path: "/privacy",
    title: "Privacy policy: EGX MCP",
    heading: "Privacy policy",
    description:
      "How EGX MCP handles your Google sign-in data, API keys, usage counts, portfolio and price levels, and how to delete your account.",
    breadcrumb: "Privacy policy",
    kind: "legal",
    related: [],
  },
  {
    id: "terms",
    path: "/terms",
    title: "Terms of use: EGX MCP",
    heading: "Terms of use",
    description:
      "The terms for using EGX MCP: a free service with delayed, unofficial data for information only, fair use limits, and no investment advice.",
    breadcrumb: "Terms of use",
    kind: "legal",
    related: [],
  },
];

const EXPECTED_QUESTIONS = [
  "What is EGX MCP?",
  "Is EGX MCP free?",
  "Is the data real-time?",
  "Where does the data come from?",
  "Which AI assistants work with EGX MCP?",
  "How do I connect my assistant?",
  "Do I need an API key?",
  "Does EGX MCP give investment advice?",
  "Is EGX MCP affiliated with the Egyptian Exchange?",
  "What can I ask?",
  "How is my data kept private?",
  "How do I delete my account?",
  "How is this different from asking an assistant to search the web?",
  "What are the usage limits?",
  "Does it cover mutual funds, gold and the dollar rate?",
  "What happens when the service is at capacity?",
  "Is the source code public?",
];

const FILLED_ANSWERS: Record<string, string> = {
  "What is EGX MCP?":
    "EGX MCP is a free MCP server that lets AI assistants answer questions about Egyptian Exchange stocks, indices and funds with delayed data. You connect it once to Claude, ChatGPT, Claude Code or Cursor and then ask in plain English or Arabic.",
  "How do I connect my assistant?": `Add the server address ${MCP_URL} in your assistant's connector or MCP settings and sign in with Google, or send an API key header. Each connection guide on this site has numbered steps.`,
  "Do I need an API key?": `Not for Claude or ChatGPT, which sign in with Google. Claude Code can do either, and Cursor uses a key. You create keys after signing in at ${DASHBOARD_URL}; each key is shown once and you can have up to ${MAX_ACTIVE_KEYS} active keys.`,
  "How do I delete my account?": `Sign in at ${DASHBOARD_URL} and use Delete account. It removes your account, keys, holdings, price levels and usage records and revokes your assistant connections.`,
  "What are the usage limits?": `Each account can make 100 tool calls per day and ${RATE_LIMIT_PER_MINUTE} per minute, and all users together share 15,000 calls per day. Limits reset at 00:00 UTC.`,
  "Is the source code public?": `Yes. The code is on GitHub at ${SITE.repositoryUrl}, where you can also report problems through the issues page.`,
};

const EXPECTED_EXAMPLES = [
  "How did the EGX30 close in the last session?",
  "Show the delayed quote for Commercial International Bank (COMI).",
  "Which EGX stocks gained the most today, and what time is the data from?",
  "What is the gold 21K price per gram in Egypt today?",
  "Compare the one-year return of two Egyptian mutual funds.",
];

const EXPECTED_STEPS: Record<string, { name: string; items: string[] }> = {
  "connect-claude": {
    name: "Add EGX MCP to Claude",
    items: [
      "In Claude, open Settings, then Connectors, and choose Add custom connector.",
      `Enter the name EGX MCP and the server address \`${MCP_URL}\`, leave the advanced settings empty, and choose Add.`,
      "Choose Connect. Sign in with Google, check the app name and the address on the EGX MCP consent page, and approve.",
      'In a chat, open the tools menu, turn on EGX MCP and ask "What is the delayed price of COMI?".',
    ],
  },
  "connect-chatgpt": {
    name: "Add EGX MCP to ChatGPT",
    items: [
      "In ChatGPT, open Settings, then Apps (called Apps and Connectors on some plans), open Advanced settings and turn on Developer mode.",
      `Choose Create app, enter the name EGX MCP and the server address \`${MCP_URL}\`, and choose OAuth as the sign-in method.`,
      "Choose Connect. Sign in with Google, check the EGX MCP consent page, and approve.",
      'In a chat, turn on EGX MCP from the tools menu and ask "What is the delayed price of COMI?".',
    ],
  },
  "connect-claude-code": {
    name: "Add EGX MCP to Claude Code",
    items: [
      `In a terminal, run \`claude mcp add --transport http egx ${MCP_URL}\`.`,
      "Start Claude Code and run `/mcp`, choose egx and choose Authenticate.",
      "Sign in with Google in the browser that opens, check the EGX MCP consent page, and approve.",
      'Back in Claude Code, ask "What is the delayed price of COMI?".',
    ],
  },
  "connect-cursor": {
    name: "Add EGX MCP to Cursor",
    items: [
      `Open ${DASHBOARD_URL}, sign in with Google and create a key with a name. Copy it now; it is shown only once.`,
      "Open Cursor's mcp.json (the project file `.cursor/mcp.json` or your user file) and add the egx server shown below.",
      "Restart Cursor or reload the MCP servers list; the egx server shows its tools.",
      'In the chat, ask "What is the delayed price of COMI?".',
    ],
  },
};

const EXPECTED_SOURCES = [
  ["EGX website", "Stock quotes, used only while it is reachable and verified."],
  [
    "TradingView",
    "Delayed stock quotes (about 15 minutes), index values, the USD/EGP market rate and global gold and silver prices.",
  ],
  [
    "Mubasher Info",
    "Backup stock quotes, the listing directory with Arabic names and sectors, mutual funds and NAVs, corporate actions and price history.",
  ],
  ["iSagha", "Egyptian gold and silver prices per gram and the gold pound."],
  ["Fund managers' own sites", "Fund NAVs when Mubasher does not have them."],
];

const EXPECTED_LIMITS = [
  `100 tool calls per account per day and ${RATE_LIMIT_PER_MINUTE} per minute.`,
  "15,000 tool calls per day for all users together; when reached, calls are refused until 00:00 UTC.",
  `Up to ${MAX_ACTIVE_KEYS} active API keys and up to ${MAX_ITEMS_PER_USER} holdings and ${MAX_ITEMS_PER_USER} price levels per account.`,
];

function pageById(id: string): PublicPage {
  const page = PAGES.find((candidate) => candidate.id === id);
  if (page === undefined) throw new Error(`missing page ${id}`);
  return page;
}

function contentOf(id: string): PageContent {
  return pageById(id).content(CTX);
}

function sectionOf(content: PageContent, id: string): Section {
  const section = content.sections.find((candidate) => candidate.id === id);
  if (section === undefined) throw new Error(`missing section ${id}`);
  return section;
}

function blocksOfKind<K extends Block["kind"]>(section: Section, kind: K): Extract<Block, { kind: K }>[] {
  return section.blocks.filter((block): block is Extract<Block, { kind: K }> => block.kind === kind);
}

function allBlocks(content: PageContent): Block[] {
  return content.sections.flatMap((section) => [...section.blocks]);
}

function pageIdsReachableWithin(hops: number): Set<string> {
  const reached = new Set<string>(["home"]);
  let frontier = ["home"];
  for (let hop = 0; hop < hops; hop += 1) {
    const next = frontier.flatMap((id) => linkedPageIds(pageById(id)));
    frontier = next.filter((id) => !reached.has(id));
    for (const id of frontier) reached.add(id);
  }
  return reached;
}

function linkedPageIds(page: PublicPage): string[] {
  const hrefs = [
    ...page.content(CTX).sections.flatMap((section) =>
      section.blocks.flatMap((block) => (block.kind === "links" ? block.items.map((item) => item.href) : [])),
    ),
    ...FOOTER_LINKS.en.map((link) => link.href),
    ...page.related.map((id) => pageById(id).path),
  ];
  return hrefs.flatMap((href) => PAGES.filter((candidate) => candidate.path === href).map((candidate) => candidate.id));
}

describe("public page records", () => {
  it("lists the pages of the page set in order", () => {
    expect(PAGES.map((page) => [page.id, page.path])).toEqual(EXPECTED_PAGES.map((page) => [page.id, page.path]));
  });

  for (const expected of EXPECTED_PAGES) {
    it(`holds the published text of ${expected.id}`, () => {
      const page = pageById(expected.id);
      expect(page.title(CTX)).toBe(expected.title);
      expect(page.heading).toBe(expected.heading);
      expect(page.description).toBe(expected.description);
      expect(page.breadcrumb).toBe(expected.breadcrumb);
      expect(page.kind).toBe(expected.kind);
      expect(page.related).toEqual(expected.related);
      expect(page.lang).toBe("en");
    });
  }

  it("keeps ids, paths, titles, headings and descriptions unique", () => {
    for (const read of [
      (page: PublicPage) => page.id,
      (page: PublicPage) => page.path,
      (page: PublicPage) => page.title(CTX),
      (page: PublicPage) => page.heading,
      (page: PublicPage) => page.description,
    ]) {
      const values = PAGES.map(read);
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it("keeps titles and descriptions within search result limits", () => {
    for (const page of PAGES) {
      expect(page.title(CTX).length).toBeLessThanOrEqual(TITLE_MAX);
      expect(page.description.length).toBeGreaterThanOrEqual(DESCRIPTION_MIN);
      expect(page.description.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    }
  });

  it("uses lower-case paths without a trailing slash", () => {
    for (const page of PAGES) {
      expect(page.path).toMatch(PATH_PATTERN);
      if (page.path !== "/") expect(page.path.endsWith("/")).toBe(false);
    }
  });

  it("relates only to pages that exist", () => {
    const ids = new Set(PAGES.map((page) => page.id));
    for (const page of PAGES) for (const related of page.related) expect(ids.has(related)).toBe(true);
  });

  it("dates every page in ISO form and the legal pages with the legal date", () => {
    for (const page of PAGES) expect(page.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(pageById("privacy").updated).toBe(LEGAL_LAST_UPDATED);
    expect(pageById("terms").updated).toBe(LEGAL_LAST_UPDATED);
  });

  it("finds a page by path and by home", () => {
    expect(pageByPath("/tools")?.id).toBe("tools");
    expect(pageByPath("/missing")).toBeUndefined();
    expect(homeOf("en").id).toBe("home");
  });

  it("has no translations yet", () => {
    for (const page of PAGES) expect(alternatesOf(page)).toEqual([]);
  });

  it("reaches every page from the home page within two hops", () => {
    expect(pageIdsReachableWithin(MAX_HOPS)).toEqual(new Set(PAGES.map((page) => page.id)));
  });

  it("leaves no placeholder in any rendered content", () => {
    for (const page of PAGES) expect(JSON.stringify(page.content(CTX))).not.toMatch(PLACEHOLDER_PATTERN);
  });
});

describe("home content", () => {
  it("lists exactly the five published example questions", () => {
    const examples = sectionOf(contentOf("home"), "examples");
    expect(examples.heading).toBe("Example questions");
    expect(examples.blocks[0]).toEqual({
      kind: "paragraph",
      text: "Ask your assistant in your own words. For example:",
    });
    expect(blocksOfKind(examples, "list")).toEqual([{ kind: "list", items: EXPECTED_EXAMPLES }]);
  });

  it("links every other page exactly once under Learn more", () => {
    const learnMore = sectionOf(contentOf("home"), "learn-more");
    expect(learnMore.heading).toBe("Learn more");
    const links = blocksOfKind(learnMore, "links").flatMap((block) => block.items);
    const otherPaths = PAGES.filter((page) => page.id !== "home").map((page) => page.path);
    expect(links.map((link) => link.href)).toEqual(otherPaths);
    expect(links[0]).toEqual({
      href: "/tools",
      label: "Tool catalog",
      note: `all ${TOOL_NAMES.length} tools and what they return`,
    });
    expect(links.at(-1)).toEqual({ href: "/terms", label: "Terms of use" });
  });
});

describe("tools content", () => {
  it("opens with the two published lead paragraphs", () => {
    expect(contentOf("tools").lead).toEqual([
      `EGX MCP gives your assistant ${TOOL_NAMES.length} tools. Your assistant picks the tool; you ask in plain English or Arabic. Every answer states the data time, the source and that the data is delayed.`,
      "Symbols can be a ticker, an ISIN, or an Arabic or English name. Tools marked read only never change anything; the personal tools change only your own portfolio and price levels.",
    ]);
  });

  it("holds one tool block per tool", () => {
    const names = allBlocks(contentOf("tools")).flatMap((block) => (block.kind === "tool" ? [block.name] : []));
    expect([...names].sort()).toEqual([...TOOL_NAMES].sort());
  });
});

describe("guide content", () => {
  for (const [id, expected] of Object.entries(EXPECTED_STEPS)) {
    it(`holds the published steps of ${id}`, () => {
      const content = contentOf(id);
      const steps = allBlocks(content).filter((block) => block.kind === "steps");
      expect(steps).toEqual([{ kind: "steps", name: expected.name, items: expected.items }]);
      expect(steps[0]).toMatchObject({ items: { length: GUIDE_STEP_COUNT } });
    });
  }

  it("holds the Cursor configuration as a json code block with the server address", () => {
    const code = allBlocks(contentOf("connect-cursor")).filter((block) => block.kind === "code");
    expect(code).toEqual([
      {
        kind: "code",
        language: "json",
        text: `{\n  "mcpServers": {\n    "egx": {\n      "url": "${MCP_URL}",\n      "headers": {\n        "Authorization": "Bearer <your key>"\n      }\n    }\n  }\n}`,
      },
    ]);
  });

  it("offers the API key section on every guide except Cursor", () => {
    for (const id of ["connect-claude", "connect-chatgpt", "connect-claude-code"]) {
      expect(sectionOf(contentOf(id), "api-key").heading).toBe("Use an API key instead");
    }
    expect(contentOf("connect-cursor").sections.map((section) => section.id)).toEqual(["steps", "troubleshooting"]);
  });

  it("ends every guide with the troubleshooting list", () => {
    for (const id of Object.keys(EXPECTED_STEPS)) {
      const troubleshooting = contentOf(id).sections.at(-1);
      expect(troubleshooting?.id).toBe("troubleshooting");
      expect(troubleshooting?.heading).toBe("If it does not work");
      expect(blocksOfKind(troubleshooting as Section, "list")).toHaveLength(1);
    }
  });

  it("fills the dashboard address and key limit in the Claude Code API key section", () => {
    const apiKey = sectionOf(contentOf("connect-claude-code"), "api-key");
    expect(apiKey.blocks).toEqual([
      {
        kind: "paragraph",
        text: `Create a key at ${DASHBOARD_URL}, then run \`claude mcp add --transport http egx ${MCP_URL} --header "Authorization: Bearer <your key>"\`. The key is shown only once; you can have up to ${MAX_ACTIVE_KEYS} active keys.`,
      },
    ]);
  });
});

describe("faq content", () => {
  it("holds the published questions in order", () => {
    const faq = contentOf("faq").faq ?? [];
    expect(faq.length).toBeGreaterThanOrEqual(MIN_FAQ_PAIRS);
    expect(faq.map((pair) => pair.question)).toEqual(EXPECTED_QUESTIONS);
  });

  it("fills the placeholders of the answers", () => {
    const faq = contentOf("faq").faq ?? [];
    for (const [question, answer] of Object.entries(FILLED_ANSWERS)) {
      expect(faq.find((pair) => pair.question === question)?.answer).toBe(answer);
    }
  });
});

describe("data content", () => {
  it("holds the source table rows", () => {
    const sources = sectionOf(contentOf("data"), "sources");
    expect(sources.heading).toBe("Where the data comes from");
    expect(blocksOfKind(sources, "table")).toEqual([
      { kind: "table", head: ["Source", "What it provides"], rows: EXPECTED_SOURCES },
    ]);
  });

  it("lists the limits from the context and the store constants", () => {
    const limits = sectionOf(contentOf("data"), "limits");
    expect(limits.heading).toBe("Limits of the free service");
    expect(limits.blocks).toEqual([{ kind: "list", items: EXPECTED_LIMITS }]);
  });

  it("holds the published sections in order", () => {
    expect(contentOf("data").sections.map((section) => section.id)).toEqual([
      "sources",
      "freshness",
      "coverage",
      "not-covered",
      "limits",
    ]);
  });
});

describe("legal content", () => {
  it("holds sections for every legal page", () => {
    for (const page of PAGES.filter((candidate) => candidate.kind === "legal")) {
      expect(legalSectionsOf(page).length).toBeGreaterThan(0);
    }
  });

  it("refuses a page without legal text", () => {
    expect(() => legalSectionsOf(pageById("home"))).toThrow("no legal text for home");
  });
});
