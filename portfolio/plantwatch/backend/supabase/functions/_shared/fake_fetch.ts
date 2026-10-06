/** Test helper: a recording, routable stand-in for fetch. Not imported by any function. */

import type { FetchLike } from "./ecowitt.ts";

export interface RecordedCall {
  url: URL;
  method: string;
  headers: Headers;
  body: string | null;
}

export type Route = (call: RecordedCall) => Response | Promise<Response> | undefined;

/** Routes are tried in order; the first one that returns a Response answers the call. */
export function fakeFetch(...routes: Route[]): { fetch: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetch: FetchLike = async (input, init) => {
    const call: RecordedCall = {
      url: new URL(input instanceof Request ? input.url : String(input)),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : null,
    };
    calls.push(call);
    for (const route of routes) {
      const response = await route(call);
      if (response) return response;
    }
    throw new Error(`fakeFetch: no route for ${call.method} ${call.url}`);
  };
  return { fetch, calls };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A route matching a URL prefix (and optionally a method). */
export function on(
  prefix: string,
  respond: (call: RecordedCall) => Response | Promise<Response>,
  method?: string,
): Route {
  return (call) =>
    call.url.href.startsWith(prefix) && (!method || call.method === method)
      ? respond(call)
      : undefined;
}
