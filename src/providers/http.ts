import { ProviderError } from "./types";

const PROVIDER_TIMEOUT_MS = 8000;
const USER_AGENT = "egx-mcp/1.0 (+https://github.com/ahmed-essawy/egx-mcp)";

export async function fetchJson(providerId: string, url: string, init?: RequestInit): Promise<unknown> {
  const text = await fetchText(providerId, url, init);
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderError(providerId, "parse", `${url} did not return JSON`);
  }
}

export async function fetchText(providerId: string, url: string, init?: RequestInit): Promise<string> {
  let response: Response;
  const headers = new Headers(init?.headers);
  headers.set("user-agent", USER_AGENT);
  try {
    response = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
  } catch (error) {
    throw new ProviderError(providerId, "network", error instanceof Error ? error.message : "request failed");
  }
  if (!response.ok) throw new ProviderError(providerId, "http", `${url} responded ${response.status}`);
  try {
    return await response.text();
  } catch {
    throw new ProviderError(providerId, "network", `${url} body read failed`);
  }
}
