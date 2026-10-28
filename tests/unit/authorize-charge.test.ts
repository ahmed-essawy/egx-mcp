import { AuthorizationError } from "@cloudflare/workers-oauth-provider";
import { env as workerEnv } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { authorizeDecisionHandler, authorizeHandler, googleCallbackHandler } from "../../src/http/authorize";

const ORIGIN = "https://egx.example";
const CAP = 1;
const HANDLE = "consent-handle";
const REJECTED = new AuthorizationError("invalid_request", { description: "rejected" });
const ORIGINAL_REQUEST = { redirectUri: "https://client.example/callback", state: "client-state", scope: ["mcp:read"] };
const VARS = {
  GLOBAL_DAILY_CALLS: "15000",
  GLOBAL_DAILY_ROWS_READ: "3500000",
  USER_DAILY_CALLS: "100",
  OWNER_EMAILS: "",
  UNLIMITED_EMAILS: "",
  STOCK_PROVIDERS: "tradingview,mubasher",
  SNAPSHOT_EVERY_MINUTES: "1",
  BACKFILL_MAX_ROWS_PER_DAY: "36000",
  ADJUST_MAX_ROWS_PER_DAY: "10000",
  ADJUST_MAX_ACTIONS_PER_RUN: "2",
  PERSONAL_DAILY_ROWS: "5000",
  PUBLIC_ORIGIN: ORIGIN,
  GOOGLE_CLIENT_ID: "client-id",
};

function rejecting(): never {
  throw REJECTED;
}

function decisionRequest(decision: string): Request {
  return new Request(`${ORIGIN}/authorize`, {
    method: "POST",
    body: new URLSearchParams({ handle: HANDLE, decision }),
  });
}

describe("authorize handlers kv write charge", () => {
  let provider: Record<string, unknown>;

  beforeEach(async () => {
    await workerEnv.DB.prepare("DELETE FROM usage_global").run();
    provider = {
      parseAuthRequest: async () => ({ scope: ["mcp:read"] }),
      describeConsent: async () => ({ clientName: "App", redirectHost: "app.example", redirectIsLoopback: false }),
      beginConsent: async () => ({ handle: HANDLE, headers: new Headers() }),
      approveConsent: async () => ({ request: ORIGINAL_REQUEST, headers: new Headers() }),
      denyConsent: async () => ({ headers: new Headers({ location: "https://client.example/callback?error=access_denied" }) }),
      beginUpstream: async () => ({ state: "upstream-state", headers: new Headers() }),
      finishUpstream: async () => ({ request: ORIGINAL_REQUEST, data: { verifier: "v" }, headers: new Headers() }),
    };
  });

  function env(oauthDailyKvWrites = 600): Env {
    return {
      ...VARS,
      OAUTH_DAILY_KV_WRITES: String(oauthDailyKvWrites),
      DB: workerEnv.DB,
      OAUTH_PROVIDER: provider,
    } as unknown as Env;
  }

  async function charged(): Promise<number> {
    const row = await workerEnv.DB.prepare("SELECT COALESCE(SUM(oauth_kv_writes), 0) AS n FROM usage_global").first<{
      n: number;
    }>();
    return row?.n ?? 0;
  }

  describe("GET /authorize", () => {
    it("charges one write once the request is validated", async () => {
      const response = await authorizeHandler(new Request(`${ORIGIN}/authorize`), env());

      expect(response.status).toBe(200);
      expect(await charged()).toBe(1);
    });

    it("charges nothing when validation refuses the request", async () => {
      provider.parseAuthRequest = async () => rejecting();

      const response = await authorizeHandler(new Request(`${ORIGIN}/authorize?x=1`), env());

      expect(response.status).toBe(400);
      expect(await charged()).toBe(0);
    });

    it("answers 503 at the cap without starting the consent", async () => {
      let began = false;
      provider.beginConsent = async () => ((began = true), { handle: HANDLE, headers: new Headers() });
      await authorizeHandler(new Request(`${ORIGIN}/authorize`), env(CAP));
      began = false;

      const response = await authorizeHandler(new Request(`${ORIGIN}/authorize`), env(CAP));

      expect(response.status).toBe(503);
      expect(began).toBe(false);
      expect(await charged()).toBe(CAP);
    });
  });

  describe("POST /authorize", () => {
    it("charges one write after the consent is approved", async () => {
      const response = await authorizeDecisionHandler(decisionRequest("approve"), env());

      expect(response.status).toBe(302);
      expect(await charged()).toBe(1);
    });

    it("charges one write after the consent is denied", async () => {
      const response = await authorizeDecisionHandler(decisionRequest("deny"), env());

      expect(response.status).toBe(302);
      expect(await charged()).toBe(1);
    });

    it.each(["approve", "deny"])("charges nothing when the %s handle is refused", async (decision) => {
      provider.approveConsent = async () => rejecting();
      provider.denyConsent = async () => rejecting();

      const response = await authorizeDecisionHandler(decisionRequest(decision), env());

      expect(response.status).toBe(400);
      expect(await charged()).toBe(0);
    });
  });

  describe("GET /callback/google", () => {
    it("charges one write once the upstream state is accepted", async () => {
      const response = await googleCallbackHandler(new Request(`${ORIGIN}/callback/google?error=access_denied`), env());

      expect(response.status).toBe(302);
      expect(await charged()).toBe(1);
    });

    it("charges nothing when the upstream state is refused", async () => {
      provider.finishUpstream = async () => rejecting();

      const response = await googleCallbackHandler(new Request(`${ORIGIN}/callback/google?code=x&state=bad`), env());

      expect(response.status).toBe(400);
      expect(await charged()).toBe(0);
    });
  });
});
