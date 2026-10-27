import { TOOL_NAMES } from "../src/mcp/tool-names.ts";

interface NodeFs {
  readFileSync(path: string, encoding: "utf8"): string;
}

declare const process: {
  argv: string[];
  exit(code: number): never;
  getBuiltinModule(id: "node:fs"): NodeFs;
};

const { readFileSync } = process.getBuiltinModule("node:fs");

const README_PATH = process.argv[2] ?? "README.md";
const TOOLS_HEADING = "Tools";

const REQUIRED_HEADINGS = [
  "Overview",
  "Data sources and limits",
  "Connect from Claude",
  "Connect from ChatGPT",
  "Connect from Cursor",
  TOOLS_HEADING,
  "Limits and fair use",
  "Install and deploy from a clean Windows machine",
  "Owner tasks",
  "Troubleshooting",
];

const REQUIRED_TEXTS = [
  "delayed",
  "unofficial",
  "informational only",
  "EGX",
  "TradingView",
  "Mubasher",
  "iSagha",
];

const HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

const FENCE_MARKER = "```";

interface Heading {
  level: number;
  title: string;
  line: number;
}

function parseHeadings(lines: string[]): Heading[] {
  const headings: Heading[] = [];
  let insideFence = false;
  lines.forEach((text, line) => {
    if (text.startsWith(FENCE_MARKER)) {
      insideFence = !insideFence;
      return;
    }
    if (insideFence) return;
    const match = HEADING_PATTERN.exec(text);
    if (match?.[1] && match[2]) {
      headings.push({ level: match[1].length, title: match[2], line });
    }
  });
  return headings;
}

function sectionLines(lines: string[], headings: Heading[], title: string): string[] {
  const index = headings.findIndex((heading) => heading.title === title);
  const start = headings[index];
  if (!start) return [];
  const end = headings.slice(index + 1).find((heading) => heading.level <= start.level);
  return lines.slice(start.line + 1, end?.line);
}

function mentionsWithQuestion(lines: string[], name: string): boolean {
  const namePattern = new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`);
  return lines.some((line) => namePattern.test(line) && line.includes("?"));
}

function findProblems(readme: string, toolNames: readonly string[]): string[] {
  const lines = readme.split(/\r?\n/);
  const headings = parseHeadings(lines);
  const titles = new Set(headings.map((heading) => heading.title));
  const lowerReadme = readme.toLowerCase();
  const toolsSection = sectionLines(lines, headings, TOOLS_HEADING);

  return [
    ...REQUIRED_HEADINGS.filter((title) => !titles.has(title)).map((title) => `missing heading: ${title}`),
    ...toolNames
      .filter((name) => !mentionsWithQuestion(toolsSection, name))
      .map((name) => `tool missing from the Tools section with an example question: ${name}`),
    ...REQUIRED_TEXTS.filter((text) => !lowerReadme.includes(text.toLowerCase())).map(
      (text) => `missing text: ${text}`,
    ),
  ];
}

function main(): void {
  const problems = findProblems(readFileSync(README_PATH, "utf8"), TOOL_NAMES);
  if (problems.length === 0) {
    console.log("README check passed");
    return;
  }
  console.error(`README check failed (${problems.length}):`);
  problems.forEach((problem) => console.error(`- ${problem}`));
  process.exit(1);
}

main();
