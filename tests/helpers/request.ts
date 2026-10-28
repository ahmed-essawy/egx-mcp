export function requestUrl(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : String(input);
}
