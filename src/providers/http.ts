import { ProviderError } from "./types";

const PROVIDER_TIMEOUT_MS = 8000;
const USER_AGENT = "egx-mcp/1.0 (+https://github.com/ahmed-essawy/egx-mcp)";

export async function fetchJson(providerId: string, url: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  const headers = new Headers(init?.headers);
  headers.set("user-agent", USER_AGENT);
  try {
    response = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
  } catch (error) {
    throw new ProviderError(providerId, "network", error instanceof Error ? error.message : "request failed");
  }
  if (!response.ok) throw new ProviderError(providerId, "http", `${url} responded ${response.status}`);
  return parseBody(providerId, url, response);
}

async function parseBody(providerId: string, url: string, response: Response): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new ProviderError(providerId, "network", `${url} body read failed`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderError(providerId, "parse", `${url} did not return JSON`);
  }
}
