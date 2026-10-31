const REGEX_METACHARACTERS = /[.*+?^${}()|[\]\\]/g;

export type RouteHandler = (request: Request, env: Env, params: string[]) => Response | Promise<Response>;
export type Route = { method: string; pattern: RegExp; handler: RouteHandler };

export const READ_METHODS = ["GET", "HEAD"];

export function getAndHead(pattern: RegExp, handler: RouteHandler): Route[] {
  return READ_METHODS.map((method) => ({ method, pattern, handler }));
}

export function exactPath(path: string): RegExp {
  return new RegExp(`^${path.replace(REGEX_METACHARACTERS, "\\$&")}$`);
}
