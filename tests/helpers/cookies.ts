const ATTRIBUTE_SEPARATOR = ";";

export function cookiePair(setCookie: string): string {
  const pair = setCookie.split(ATTRIBUTE_SEPARATOR)[0];
  if (pair === undefined || pair === "") throw new Error("Set-Cookie header has no cookie pair");
  return pair;
}

export function cookieHeader(...responses: Response[]): string {
  const jar = new Map<string, string>();
  for (const response of responses) {
    for (const setCookie of response.headers.getSetCookie()) {
      const pair = cookiePair(setCookie);
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (value === "") jar.delete(name);
      else jar.set(name, value);
    }
  }
  return Array.from(jar, ([name, value]) => `${name}=${value}`).join("; ");
}
