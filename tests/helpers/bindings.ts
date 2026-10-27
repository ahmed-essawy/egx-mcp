import { env } from "cloudflare:test";
import { __resetConfigCache } from "../../src/config";

type BindingOverrides = Record<string, string>;

const originalBindings = new Map<string, unknown>();

export function setBindings(overrides: BindingOverrides): void {
  const bindings = env as unknown as Record<string, unknown>;
  for (const [name, value] of Object.entries(overrides)) {
    if (!originalBindings.has(name)) originalBindings.set(name, bindings[name]);
    bindings[name] = value;
  }
  __resetConfigCache();
}

export function restoreBindings(): void {
  const bindings = env as unknown as Record<string, unknown>;
  for (const [name, value] of originalBindings) bindings[name] = value;
  originalBindings.clear();
  __resetConfigCache();
}

export async function clearState(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM usage_daily"),
    env.DB.prepare("DELETE FROM usage_global"),
    env.DB.prepare("DELETE FROM daily_bars"),
    env.DB.prepare("DELETE FROM api_keys"),
    env.DB.prepare("DELETE FROM users"),
  ]);
}
