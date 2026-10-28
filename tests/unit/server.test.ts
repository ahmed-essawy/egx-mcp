import { InMemoryTransport, type McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthProps } from "../../src/auth/api-keys";
import { NOTICE } from "../../src/mcp/envelope";
import { createServer, defineTool, type ToolContext } from "../../src/mcp/server";

const mocks = vi.hoisted(() => ({
  checkLimits: vi.fn(),
  finishCall: vi.fn(),
  loadConfig: vi.fn(),
}));

vi.mock("../../src/limits/usage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/limits/usage")>()),
  checkLimits: mocks.checkLimits,
  finishCall: mocks.finishCall,
}));

vi.mock("../../src/config", () => ({ loadConfig: mocks.loadConfig }));

const ENV = {} as Env;
const AUTH: AuthProps = { userId: "u1", email: "a@example.com", via: "key", keyId: "k1", scopes: [] };
const CFG = { userDailyCalls: 100 };
const USAGE = { globalCalls: 1, globalRowsRead: 2, personalRows: 0, userCalls: 3, accountActive: true, rowsRead: 4 };
const RETRY_AT = "2026-10-28T00:00:00.000Z";
const NOW_MS = Date.UTC(2026, 9, 27, 10, 0, 0);
const NOW_SECONDS = NOW_MS / 1000;
const TOOL_RESULT = { content: [{ type: "text" as const, text: "done" }] };

type Registration = {
  name: string;
  config: { description: string; annotations: { readOnlyHint: boolean } };
  callback: (args: { symbol: string }) => Promise<unknown>;
};

function stubServer(): { server: McpServer; registered: Registration[] } {
  const registered: Registration[] = [];
  const registerTool = vi.fn((name: string, config: Registration["config"], callback: Registration["callback"]) => {
    registered.push({ name, config, callback });
  });
  return { server: { registerTool } as unknown as McpServer, registered };
}

function define(server: McpServer, handler: (args: { symbol: string }, ctx: ToolContext) => Promise<typeof TOOL_RESULT>) {
  defineTool(
    server,
    {
      name: "search",
      description: "Search symbols.",
      inputSchema: z.object({ symbol: z.string() }),
      outputSchema: z.object({}),
      readOnly: true,
      handler,
    },
    ENV,
    AUTH,
  );
}

describe("defineTool", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
    mocks.loadConfig.mockReturnValue(CFG);
    mocks.checkLimits.mockResolvedValue({ ok: true, usage: USAGE });
    mocks.finishCall.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("appends the notice to the description and sets the read-only hint", () => {
    const { server, registered } = stubServer();
    define(server, async () => TOOL_RESULT);
    expect(registered[0]?.name).toBe("search");
    expect(registered[0]?.config.description).toBe(`Search symbols. ${NOTICE}`);
    expect(registered[0]?.config.annotations).toEqual({ readOnlyHint: true });
  });

  it("runs the handler with the context and then finishes the call", async () => {
    const { server, registered } = stubServer();
    const handler = vi.fn(async () => TOOL_RESULT);
    define(server, handler);
    const result = await registered[0]?.callback({ symbol: "COMI" });
    expect(result).toBe(TOOL_RESULT);
    const [args, ctx] = handler.mock.calls[0] as unknown as [{ symbol: string }, ToolContext];
    expect(args).toEqual({ symbol: "COMI" });
    expect(ctx).toMatchObject({ env: ENV, cfg: CFG, auth: AUTH, usage: USAGE, now: NOW_SECONDS });
    expect(mocks.checkLimits).toHaveBeenCalledWith(ENV, CFG, AUTH, NOW_SECONDS, ctx.rows);
    expect(mocks.finishCall).toHaveBeenCalledWith(ENV, AUTH, "search", ctx.rows, NOW_SECONDS, USAGE);
  });

  it("returns the refusal as an error envelope without calling the handler or finishing", async () => {
    mocks.checkLimits.mockResolvedValue({ ok: false, code: "rate_limited", message: "Slow down.", retryAt: RETRY_AT });
    const { server, registered } = stubServer();
    const handler = vi.fn(async () => TOOL_RESULT);
    define(server, handler);
    const result = (await registered[0]?.callback({ symbol: "COMI" })) as {
      isError: boolean;
      structuredContent: unknown;
    };
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      error: { code: "rate_limited", message: "Slow down.", retryAt: RETRY_AT },
      meta: expect.objectContaining({ label: "delayed", source: null }),
      notice: NOTICE,
    });
    expect(handler).not.toHaveBeenCalled();
    expect(mocks.finishCall).not.toHaveBeenCalled();
  });

  it("maps an input schema failure to the invalid_input envelope", async () => {
    const { server, registered } = stubServer();
    const handler = vi.fn(async () => TOOL_RESULT);
    define(server, handler);
    const standard = (registered[0]?.config as unknown as { inputSchema: z.ZodType }).inputSchema["~standard"];
    const validated = await standard.validate({ symbol: 5 });
    const result = (await registered[0]?.callback((validated as { value: { symbol: string } }).value)) as {
      isError: boolean;
      structuredContent: { error: { code: string } };
    };
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error.code).toBe("invalid_input");
    expect(handler).not.toHaveBeenCalled();
    expect(mocks.checkLimits).not.toHaveBeenCalled();
  });

  describe("failures", () => {
    const SECRET_TEXT = "database password is hunter2";
    const GENERIC_ERROR = {
      error: { code: "not_available", message: "Temporarily unavailable.", retryAt: null },
      meta: expect.objectContaining({ label: "delayed", source: null }),
      notice: NOTICE,
    };

    beforeEach(() => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
    });

    it("still finishes the call and hides the original text when the handler throws", async () => {
      const { server, registered } = stubServer();
      define(server, async () => {
        throw new Error(SECRET_TEXT);
      });
      const result = (await registered[0]?.callback({ symbol: "COMI" })) as {
        isError: boolean;
        structuredContent: unknown;
        content: { text: string }[];
      };
      expect(mocks.finishCall).toHaveBeenCalledTimes(1);
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual(GENERIC_ERROR);
      expect(JSON.stringify(result)).not.toContain(SECRET_TEXT);
    });

    it("finishes once and logs both failures when the handler and finishing both throw", async () => {
      const handlerText = "handler broke";
      const finishText = "finish broke";
      mocks.finishCall.mockRejectedValue(new Error(finishText));
      const { server, registered } = stubServer();
      define(server, async () => {
        throw new Error(handlerText);
      });
      const result = (await registered[0]?.callback({ symbol: "COMI" })) as { structuredContent: unknown };
      expect(mocks.finishCall).toHaveBeenCalledTimes(1);
      expect(console.error).toHaveBeenCalledWith("tool_failed", "search", handlerText);
      expect(console.error).toHaveBeenCalledWith("tool_failed", "search", finishText);
      expect(result.structuredContent).toEqual(GENERIC_ERROR);
      expect(JSON.stringify(result)).not.toContain(handlerText);
      expect(JSON.stringify(result)).not.toContain(finishText);
    });

    it("returns the generic envelope when finishing the call throws", async () => {
      mocks.finishCall.mockRejectedValue(new Error(SECRET_TEXT));
      const { server, registered } = stubServer();
      define(server, async () => TOOL_RESULT);
      const result = (await registered[0]?.callback({ symbol: "COMI" })) as { structuredContent: unknown };
      expect(result.structuredContent).toEqual(GENERIC_ERROR);
      expect(JSON.stringify(result)).not.toContain(SECRET_TEXT);
    });
  });
});

describe("createServer", () => {
  it("advertises tools and lists every registered tool", async () => {
    const server = createServer(ENV, AUTH);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const responses: Record<number, { result?: Record<string, unknown> }> = {};
    clientTransport.onmessage = (message) => {
      const response = message as { id?: number; result?: Record<string, unknown> };
      if (response.id !== undefined) responses[response.id] = response;
    };
    await server.connect(serverTransport);
    await clientTransport.start();
    await clientTransport.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } },
    });
    await clientTransport.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    await clientTransport.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    await vi.waitFor(() => expect(responses[2]).toBeDefined());
    expect(responses[1]?.result?.capabilities).toMatchObject({ tools: {} });
    const tools = responses[2]?.result?.tools as { name: string }[];
    expect(tools.map((tool) => tool.name)).toEqual([
      "search",
      "get_quotes",
      "get_market_overview",
      "get_indices",
      "get_daily_summary",
      "get_movers",
      "get_52_week_range",
      "get_sector_performance",
      "get_metals",
      "get_usd_egp",
      "portfolio_get",
      "portfolio_upsert_holding",
      "portfolio_remove_holding",
      "price_level_set",
      "price_level_remove",
      "price_levels_list",
      "what_changed_since",
      "get_price_history",
      "compare_symbols",
    ]);
  });
});
