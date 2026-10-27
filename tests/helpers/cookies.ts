const ATTRIBUTE_SEPARATOR = ";";

export function cookiePair(setCookie: string): string {
  const pair = setCookie.split(ATTRIBUTE_SEPARATOR)[0];
  if (pair === undefined || pair === "") throw new Error("Set-Cookie header has no cookie pair");
  return pair;
}
