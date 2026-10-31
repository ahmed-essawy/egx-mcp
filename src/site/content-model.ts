export type SiteContext = {
  origin: string;
  mcpUrl: string;
  dashboardUrl: string;
  limits: { userDailyCalls: number; globalDailyCalls: number };
};

export type LinkItem = { href: string; label: string; note?: string };

export type Block =
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: readonly string[] }
  | { kind: "steps"; name: string; items: readonly string[] }
  | { kind: "table"; head: readonly string[]; rows: readonly (readonly string[])[] }
  | { kind: "code"; language: string; text: string }
  | { kind: "links"; items: readonly LinkItem[] }
  | {
      kind: "tool";
      name: string;
      description: string;
      askLabel: string;
      example: string;
      returnsLabel: string;
      returns: string;
    };

export type Section = { id: string; heading: string; blocks: readonly Block[]; level?: 2 | 3 };

export type QuestionAnswer = { question: string; answer: string };

export type PageContent = {
  lead: readonly string[];
  sections: readonly Section[];
  faq?: readonly QuestionAnswer[];
};
