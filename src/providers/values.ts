export function asString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

export function isPresent<T>(value: T | null): value is T {
  return value !== null;
}
