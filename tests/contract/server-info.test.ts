import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mcpIcons } from "../../src/http/icons";
import { clearState, restoreBindings } from "../helpers/bindings";
import { initialize } from "../helpers/mcp";
import { seedKey, seedUser } from "../helpers/seed";

const USER_EMAIL = "user@example.com";
const TEST_ORIGIN = "https://egx.test";

describe("MCP server info", () => {
  let userKey: string;

  beforeEach(async () => {
    await clearState();
    userKey = await seedKey(await seedUser(USER_EMAIL));
  });

  afterEach(() => {
    restoreBindings();
  });

  it("advertises the EGX MCP icons on the request origin", async () => {
    expect((await initialize(userKey)).serverInfo).toEqual({
      name: "egx-mcp",
      version: "1.0.0",
      icons: mcpIcons(TEST_ORIGIN),
    });
  });
});
