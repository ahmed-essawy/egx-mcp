export function decodeBase64Url(text: string): string {
  return atob(text.replaceAll("-", "+").replaceAll("_", "/"));
}

export function encodeBase64Url(text: string): string {
  return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
