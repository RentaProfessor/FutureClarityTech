/**
 * Just enough of Supabase Auth and PostgREST for the edge functions, over
 * plain fetch (no SDK import, so cold starts stay small).
 *
 * Every request carries the *caller's* JWT, never the service-role key, so
 * Postgres row-level security decides what each request can see or change.
 * A bug in a query can therefore not leak another user's rows.
 */

import type { FetchLike } from "./ecowitt.ts";

export interface SupabaseEnv {
  url: string;
  anonKey: string;
}

/** An error with the status to return and a message that is safe to show the caller. */
export class HttpError extends Error {
  constructor(readonly status: number, readonly publicMessage: string, detail?: string) {
    super(detail ?? publicMessage);
    this.name = "HttpError";
  }
}

/** Reads the variables the Supabase platform injects into every function. */
export function readSupabaseEnv(get: (key: string) => string | undefined): SupabaseEnv {
  const url = get("SUPABASE_URL");
  const anonKey = get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) {
    throw new HttpError(
      500,
      "Server misconfigured: SUPABASE_URL or SUPABASE_ANON_KEY is not set",
    );
  }
  return { url: url.replace(/\/+$/, ""), anonKey };
}

export interface AuthUser {
  id: string;
  email: string | null;
}

/** Validates the caller's token with Supabase Auth; null when it is not accepted. */
export async function getUser(
  fetchFn: FetchLike,
  env: SupabaseEnv,
  authorization: string,
): Promise<AuthUser | null> {
  const response = await fetchFn(`${env.url}/auth/v1/user`, {
    headers: { apikey: env.anonKey, Authorization: authorization },
  });
  if (!response.ok) {
    await response.body?.cancel();
    return null;
  }
  const user = await response.json() as { id?: unknown; email?: unknown };
  return typeof user.id === "string"
    ? { id: user.id, email: typeof user.email === "string" ? user.email : null }
    : null;
}

/** A PostgREST client bound to one caller's token. */
export function restClient(fetchFn: FetchLike, env: SupabaseEnv, authorization: string) {
  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetchFn(`${env.url}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: env.anonKey,
        Authorization: authorization,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      const table = path.split("?")[0];
      // An expired token surfaces as 401; anything else is a server-side problem
      // (for example a migration that has not been applied yet).
      throw response.status === 401
        ? new HttpError(401, "Not signed in", `PostgREST 401 on ${table}`)
        : new HttpError(
          502,
          "Database request failed",
          `PostgREST ${response.status} on ${table}: ${detail.slice(0, 300)}`,
        );
    }
    return response;
  }

  return {
    /** GET rows; throws HttpError instead of pretending an error is an empty result. */
    async select<T>(path: string): Promise<T[]> {
      return await (await request(path)).json() as T[];
    },
    /** Insert-or-update one row, resolving conflicts on the given columns. */
    async upsert(table: string, row: Record<string, unknown>, onConflict: string): Promise<void> {
      const response = await request(`${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(row),
      });
      await response.body?.cancel();
    },
  };
}
