import { TOOL_NAMES } from "../../mcp/tool-names";
import { MAX_ITEMS_PER_USER } from "../../store/d1/personal";
import { MAX_ACTIVE_KEYS } from "../../store/d1/users";
import type { LinkItem, PageContent, QuestionAnswer, Section, SiteContext } from "../content-model";
import { RATE_LIMIT_PER_MINUTE, SITE } from "../identity";
import {
  CONNECT_CHATGPT_PATH,
  CONNECT_CLAUDE_CODE_PATH,
  CONNECT_CLAUDE_PATH,
  CONNECT_CURSOR_PATH,
  DATA_PATH,
  FAQ_PATH,
  PRIVACY_PATH,
  TERMS_PATH,
  TOOLS_PATH,
} from "../paths";
import { TOOL_GROUPS, toolEntries } from "../tool-catalog";

export type GuideAssistant = "claude" | "chatgpt" | "claude-code" | "cursor";

type GuideSpec = {
  lead: string;
  stepsHeading: string;
  steps: readonly string[];
  code?: string;
  apiKey?: string;
  troubleshooting: readonly string[];
};

const NUMBER_FORMAT = new Intl.NumberFormat("en-US");
const API_KEY_HEADING = "Use an API key instead";
const TROUBLESHOOTING_HEADING = "If it does not work";
const ASK_LABEL = "Ask:";
const RETURNS_LABEL = "Returns:";
const SAMPLE_QUESTION = 'ask "What is the delayed price of COMI?"';
const ISSUE_ADVICE = "If it keeps failing, open an issue on GitHub with the error text.";
const CAPACITY_ADVICE = "If you see that sign-in is at capacity, try again after 00:00 UTC.";
const REVOKE_ADVICE = "If a call says unauthorized after you revoke a key, wait up to 2 minutes and use a new key.";

const EXAMPLE_QUESTIONS = [
  "How did the EGX30 close in the last session?",
  "Show the delayed quote for Commercial International Bank (COMI).",
  "Which EGX stocks gained the most today, and what time is the data from?",
  "What is the gold 21K price per gram in Egypt today?",
  "Compare the one-year return of two Egyptian mutual funds.",
];

const DATA_SOURCE_ROWS = [
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

function listSection(id: string, heading: string, items: readonly string[]): Section {
  return { id, heading, blocks: [{ kind: "list", items }] };
}

function guideSpec(assistant: GuideAssistant, ctx: SiteContext): GuideSpec {
  const { mcpUrl, dashboardUrl } = ctx;
  const guides: Record<GuideAssistant, GuideSpec> = {
    claude: {
      lead: "You can add EGX MCP to Claude on the web and in the desktop app as a custom connector. You sign in with Google once; no key is needed.",
      stepsHeading: "Add EGX MCP to Claude",
      steps: [
        "In Claude, open Settings, then Connectors, and choose Add custom connector.",
        `Enter the name EGX MCP and the server address \`${mcpUrl}\`, leave the advanced settings empty, and choose Add.`,
        "Choose Connect. Sign in with Google, check the app name and the address on the EGX MCP consent page, and approve.",
        `In a chat, open the tools menu, turn on EGX MCP and ${SAMPLE_QUESTION}.`,
      ],
      apiKey: `If your Claude version shows a request headers field for custom connectors, you can connect without signing in: create a key at ${dashboardUrl}, then add the header \`Authorization\` with the value \`Bearer <your key>\`. The key is shown only once.`,
      troubleshooting: [
        "If Claude says it cannot connect, remove the connector, add it again and finish the Google sign-in in the same browser.",
        CAPACITY_ADVICE,
        "On Team and Enterprise plans an owner adds the connector first in the organization settings.",
        ISSUE_ADVICE,
      ],
    },
    chatgpt: {
      lead: "You can add EGX MCP to ChatGPT on the web as an app in developer mode. You sign in with Google once; no key is needed.",
      stepsHeading: "Add EGX MCP to ChatGPT",
      steps: [
        "In ChatGPT, open Settings, then Apps (called Apps and Connectors on some plans), open Advanced settings and turn on Developer mode.",
        `Choose Create app, enter the name EGX MCP and the server address \`${mcpUrl}\`, and choose OAuth as the sign-in method.`,
        "Choose Connect. Sign in with Google, check the EGX MCP consent page, and approve.",
        `In a chat, turn on EGX MCP from the tools menu and ${SAMPLE_QUESTION}.`,
      ],
      apiKey: `If your plan cannot use OAuth apps but the form accepts custom headers, create a key at ${dashboardUrl} and send it as \`Authorization: Bearer <your key>\`. The key is shown only once.`,
      troubleshooting: [
        "If you cannot find Developer mode, your plan or workspace may not offer it yet; ask your workspace admin.",
        "If only search and fetch tools appear, turn Developer mode on and add the app again.",
        CAPACITY_ADVICE,
        ISSUE_ADVICE,
      ],
    },
    "claude-code": {
      lead: "You can add EGX MCP to Claude Code with one command. Sign in with Google from Claude Code, or pass an API key header.",
      stepsHeading: "Add EGX MCP to Claude Code",
      steps: [
        `In a terminal, run \`claude mcp add --transport http egx ${mcpUrl}\`.`,
        "Start Claude Code and run `/mcp`, choose egx and choose Authenticate.",
        "Sign in with Google in the browser that opens, check the EGX MCP consent page, and approve.",
        `Back in Claude Code, ${SAMPLE_QUESTION}.`,
      ],
      apiKey: `Create a key at ${dashboardUrl}, then run \`claude mcp add --transport http egx ${mcpUrl} --header "Authorization: Bearer <your key>"\`. The key is shown only once; you can have up to ${MAX_ACTIVE_KEYS} active keys.`,
      troubleshooting: ["Run `claude mcp list` to check that egx is listed and connected.", REVOKE_ADVICE, ISSUE_ADVICE],
    },
    cursor: {
      lead: "You can add EGX MCP to Cursor in its mcp.json file with the server address and an API key header.",
      stepsHeading: "Add EGX MCP to Cursor",
      steps: [
        `Open ${dashboardUrl}, sign in with Google and create a key with a name. Copy it now; it is shown only once.`,
        "Open Cursor's mcp.json (the project file `.cursor/mcp.json` or your user file) and add the egx server shown below.",
        "Restart Cursor or reload the MCP servers list; the egx server shows its tools.",
        `In the chat, ${SAMPLE_QUESTION}.`,
      ],
      code: JSON.stringify(
        { mcpServers: { egx: { url: mcpUrl, headers: { Authorization: "Bearer <your key>" } } } },
        null,
        2,
      ),
      troubleshooting: [
        "If the server shows no tools, check the address ends in /mcp and the key starts with egx_.",
        REVOKE_ADVICE,
        ISSUE_ADVICE,
      ],
    },
  };
  return guides[assistant];
}

function learnMoreLinks(): LinkItem[] {
  return [
    { href: TOOLS_PATH, label: "Tool catalog", note: `all ${TOOL_NAMES.length} tools and what they return` },
    { href: CONNECT_CLAUDE_PATH, label: "Connect Claude", note: "custom connector steps" },
    { href: CONNECT_CHATGPT_PATH, label: "Connect ChatGPT", note: "developer mode steps" },
    { href: CONNECT_CLAUDE_CODE_PATH, label: "Connect Claude Code", note: "one command" },
    { href: CONNECT_CURSOR_PATH, label: "Connect Cursor", note: "mcp.json setup" },
    { href: FAQ_PATH, label: "Questions and answers", note: "cost, data, privacy and advice" },
    { href: DATA_PATH, label: "Data sources and limits", note: "where the data comes from and how late it is" },
    { href: PRIVACY_PATH, label: "Privacy policy" },
    { href: TERMS_PATH, label: "Terms of use" },
  ];
}

function faqPairs(ctx: SiteContext): QuestionAnswer[] {
  const { mcpUrl, dashboardUrl } = ctx;
  const { userDailyCalls, globalDailyCalls } = ctx.limits;
  const globalCalls = NUMBER_FORMAT.format(globalDailyCalls);
  return [
    {
      question: "What is EGX MCP?",
      answer:
        "EGX MCP is a free MCP server that lets AI assistants answer questions about Egyptian Exchange stocks, indices and funds with delayed data. You connect it once to Claude, ChatGPT, Claude Code or Cursor and then ask in plain English or Arabic.",
    },
    {
      question: "Is EGX MCP free?",
      answer:
        "Yes. EGX MCP is free and has no ads. It runs on free hosting with daily limits, so when a limit is reached requests are refused until the next day instead of being charged.",
    },
    {
      question: "Is the data real-time?",
      answer:
        "No. Stock and index data is delayed by about 15 minutes during the session, fund NAVs are daily values, and every answer states the data time and that the data is delayed.",
    },
    {
      question: "Where does the data come from?",
      answer:
        "From free public sources: the EGX website when it is reachable, TradingView, Mubasher Info, iSagha for Egyptian gold and silver, and fund managers' own sites. The sources are unofficial and the Egyptian Exchange has not given permission to redistribute the data.",
    },
    {
      question: "Which AI assistants work with EGX MCP?",
      answer:
        "Claude (web and desktop, as a custom connector), ChatGPT (developer mode apps), Claude Code and Cursor. Any client that supports remote MCP servers over Streamable HTTP with OAuth or a bearer header can connect.",
    },
    {
      question: "How do I connect my assistant?",
      answer: `Add the server address ${mcpUrl} in your assistant's connector or MCP settings and sign in with Google, or send an API key header. Each connection guide on this site has numbered steps.`,
    },
    {
      question: "Do I need an API key?",
      answer: `Not for Claude or ChatGPT, which sign in with Google. Claude Code can do either, and Cursor uses a key. You create keys after signing in at ${dashboardUrl}; each key is shown once and you can have up to ${MAX_ACTIVE_KEYS} active keys.`,
    },
    {
      question: "Does EGX MCP give investment advice?",
      answer:
        "No. EGX MCP reports and computes facts such as prices, returns and ratios. It never gives a buy, sell or hold recommendation, and nothing it returns is financial advice.",
    },
    {
      question: "Is EGX MCP affiliated with the Egyptian Exchange?",
      answer:
        "No. EGX MCP is an independent service and is not affiliated with, endorsed by or sponsored by the Egyptian Exchange.",
    },
    {
      question: "What can I ask?",
      answer:
        "Questions about stock quotes, indices, market movers, sectors, price history, mutual funds, dividends, corporate actions, company figures, gold and silver prices in Egypt and the dollar rate, plus your own portfolio and price levels. The tool catalog lists every tool with an example.",
    },
    {
      question: "How is my data kept private?",
      answer:
        "EGX MCP receives only the tool calls your assistant makes, not the questions you type, and does not store tool arguments. It keeps your Google account identifier, email and name, your API key hashes, daily call counts per tool, and any holdings and price levels you save, which only you can see. There are no trackers or third-party scripts.",
    },
    {
      question: "How do I delete my account?",
      answer: `Sign in at ${dashboardUrl} and use Delete account. It removes your account, keys, holdings, price levels and usage records and revokes your assistant connections.`,
    },
    {
      question: "How is this different from asking an assistant to search the web?",
      answer:
        "Web search returns pages that may be old or about other markets. EGX MCP returns stored EGX figures with the data time, the source and a delayed label in every answer, so your assistant can quote numbers together with their age.",
    },
    {
      question: "What are the usage limits?",
      answer: `Each account can make ${userDailyCalls} tool calls per day and ${RATE_LIMIT_PER_MINUTE} per minute, and all users together share ${globalCalls} calls per day. Limits reset at 00:00 UTC.`,
    },
    {
      question: "Does it cover mutual funds, gold and the dollar rate?",
      answer:
        "Yes. It covers Egyptian mutual funds listed by Mubasher with daily NAVs, Egyptian gold and silver prices per gram, the gold pound, global gold and silver in USD and the USD/EGP market rate.",
    },
    {
      question: "What happens when the service is at capacity?",
      answer:
        "Calls are refused with a message that says when to try again, usually after 00:00 UTC. Nothing is billed, because the service runs only on free hosting.",
    },
    {
      question: "Is the source code public?",
      answer: `Yes. The code is on GitHub at ${SITE.repositoryUrl}, where you can also report problems through the issues page.`,
    },
  ];
}

export function homeContent(): PageContent {
  return {
    lead: [],
    sections: [
      {
        id: "examples",
        heading: "Example questions",
        blocks: [
          { kind: "paragraph", text: "Ask your assistant in your own words. For example:" },
          { kind: "list", items: EXAMPLE_QUESTIONS },
        ],
      },
      { id: "learn-more", heading: "Learn more", blocks: [{ kind: "links", items: learnMoreLinks() }] },
    ],
  };
}

export function toolsContent(): PageContent {
  const entries = toolEntries();
  return {
    lead: [
      `EGX MCP gives your assistant ${TOOL_NAMES.length} tools. Your assistant picks the tool; you ask in plain English or Arabic. Every answer states the data time, the source and that the data is delayed.`,
      "Symbols can be a ticker, an ISIN, or an Arabic or English name. Tools marked read only never change anything; the personal tools change only your own portfolio and price levels.",
    ],
    sections: TOOL_GROUPS.map((group) => ({
      id: group.id,
      heading: group.label,
      blocks: [
        { kind: "paragraph", text: group.intro },
        ...entries
          .filter((entry) => entry.group === group.id)
          .map((entry) => ({
            kind: "tool" as const,
            name: entry.name,
            description: entry.description,
            askLabel: ASK_LABEL,
            example: entry.example,
            returnsLabel: RETURNS_LABEL,
            returns: entry.returns,
          })),
      ],
    })),
  };
}

export function guideContent(assistant: GuideAssistant, ctx: SiteContext): PageContent {
  const spec = guideSpec(assistant, ctx);
  const sections: Section[] = [
    {
      id: "steps",
      heading: spec.stepsHeading,
      blocks: [
        { kind: "steps", name: spec.stepsHeading, items: spec.steps },
        ...(spec.code === undefined ? [] : [{ kind: "code" as const, language: "json", text: spec.code }]),
      ],
    },
  ];
  if (spec.apiKey !== undefined) {
    sections.push({ id: "api-key", heading: API_KEY_HEADING, blocks: [{ kind: "paragraph", text: spec.apiKey }] });
  }
  sections.push(listSection("troubleshooting", TROUBLESHOOTING_HEADING, spec.troubleshooting));
  return { lead: [spec.lead], sections };
}

export function faqContent(ctx: SiteContext): PageContent {
  return {
    lead: ["Short, direct answers about EGX MCP. Each answer stands on its own."],
    sections: [],
    faq: faqPairs(ctx),
  };
}

export function dataContent(ctx: SiteContext): PageContent {
  const { userDailyCalls, globalDailyCalls } = ctx.limits;
  return {
    lead: ["EGX MCP serves stored, delayed data from free public sources. It is unofficial and for information only."],
    sections: [
      {
        id: "sources",
        heading: "Where the data comes from",
        blocks: [
          { kind: "table", head: ["Source", "What it provides"], rows: DATA_SOURCE_ROWS },
          {
            kind: "paragraph",
            text: "These sources are free but unofficial, and the Egyptian Exchange has not given permission to redistribute the data. Check an official source before acting.",
          },
        ],
      },
      listSection("freshness", "How late the data is", [
        "Stock and index snapshots are refreshed about every minute during the EGX session, Sunday to Thursday, and are delayed by about 15 minutes.",
        "End-of-day prices, index closes and fund NAVs are added once per day.",
        "Every answer states the data time, the source and that the data is delayed.",
      ]),
      listSection("coverage", "What it covers", [
        "Every active EGX stock in the directory, by ticker, ISIN, or Arabic or English name.",
        "The EGX30, EGX30 Capped, EGX70 EWI and EGX100 EWI indices.",
        "Egyptian mutual funds with daily NAVs.",
        "Gold 18K, 21K and 24K, the gold pound and silver 925 and 999 in Egypt, global gold and silver in USD, and the USD/EGP rate.",
        "Dividends, corporate actions and stored company figures.",
      ]),
      listSection("not-covered", "What it does not do", [
        "It is not real-time and stores no tick data.",
        "It never pushes alerts; price level crossings show when you ask.",
        "It gives no investment advice and no buy, sell or hold recommendation.",
        "It does not show live prices on this website; prices are answered only through your assistant.",
      ]),
      listSection("limits", "Limits of the free service", [
        `${userDailyCalls} tool calls per account per day and ${RATE_LIMIT_PER_MINUTE} per minute.`,
        `${NUMBER_FORMAT.format(globalDailyCalls)} tool calls per day for all users together; when reached, calls are refused until 00:00 UTC.`,
        `Up to ${MAX_ACTIVE_KEYS} active API keys and up to ${MAX_ITEMS_PER_USER} holdings and ${MAX_ITEMS_PER_USER} price levels per account.`,
      ]),
    ],
  };
}
