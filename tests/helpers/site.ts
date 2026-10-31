import wrangler from "../../wrangler.jsonc?raw";
import type { SiteContext } from "../../src/site/content-model";

const { vars } = JSON.parse(wrangler) as { vars: Record<string, string> };

export const TEST_CONTEXT: SiteContext = {
  origin: "https://egx.example.com",
  mcpUrl: "https://egx.example.com/mcp",
  dashboardUrl: "https://egx.example.com/dashboard",
  limits: { userDailyCalls: Number(vars.USER_DAILY_CALLS), globalDailyCalls: Number(vars.GLOBAL_DAILY_CALLS) },
};
