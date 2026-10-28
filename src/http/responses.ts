import { CAPACITY_MESSAGE } from "../limits/usage";
import { STATUS_SERVICE_UNAVAILABLE } from "./status";
import { htmlResponse, messageView, withCookies } from "./views";

export function messageResponse(title: string, text: string, status: number, cookies: string[] = []): Response {
  return htmlResponse(messageView(title, text), status, cookies);
}

export function redirect(location: string, status: number, cookies: string[] = []): Response {
  return new Response(null, { status, headers: withCookies(new Headers({ location }), cookies) });
}

export function capacityResponse(cookies: string[] = []): Response {
  return messageResponse("Service at capacity", CAPACITY_MESSAGE, STATUS_SERVICE_UNAVAILABLE, cookies);
}
