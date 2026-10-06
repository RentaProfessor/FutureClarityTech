/** Response helpers shared by the edge functions. */

// Requests carry a bearer token, not cookies, so a wildcard origin is safe.
export const CORS_HEADERS: Readonly<Record<string, string>> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json", ...headers },
  });
}

/** Answers CORS preflight requests; returns null for everything else. */
export function preflight(req: Request, methods: string[]): Response | null {
  if (req.method !== "OPTIONS") return null;
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS_HEADERS,
      "Access-Control-Allow-Methods": [...methods, "OPTIONS"].join(", "),
    },
  });
}

/** The caller's "Bearer <jwt>" header, or null when it is missing or malformed. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.get("Authorization");
  return header && /^Bearer \S+$/.test(header) ? header : null;
}
