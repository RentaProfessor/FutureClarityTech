/**
 * report-v2: the signed-in user's garden report.
 *
 * 1. Validate the caller's JWT with Supabase Auth.
 * 2. Read their Ecowitt keys, gateways, zones, plants and preferences through
 *    PostgREST *with the caller's JWT*, so row-level security scopes every
 *    query to their own rows.
 * 3. Fetch live readings per gateway and the forecast, in parallel.
 * 4. Look up last-seen times for sensors that are not reporting.
 * 5. Build the report with the shared, pure advice engine.
 */

import {
  type EcowittCredentials,
  fetchGatewayReadings,
  fetchLastSeen,
  type FetchLike,
} from "../_shared/ecowitt.ts";
import { fetchForecast, forecastLocation } from "../_shared/forecast.ts";
import { bearerToken, json, preflight } from "../_shared/http.ts";
import {
  buildReport,
  type GatewayResult,
  type GatewayRow,
  type PlantRow,
  plantsAwaitingLastSeen,
  type ZoneRow,
} from "../_shared/report.ts";
import { getUser, HttpError, restClient, type SupabaseEnv } from "../_shared/supabase.ts";

export interface ReportDeps {
  fetch: FetchLike;
  env: () => SupabaseEnv;
  now: () => Date;
}

interface EcowittAccountRow {
  app_key: string;
  api_key: string;
}

interface PrefsRow {
  notify_mode?: string;
  notify_offline?: boolean;
  weather_lat?: number | string | null;
  weather_lon?: number | string | null;
  layout?: string;
}

export function createReportHandler(deps: ReportDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    const early = preflight(req, ["GET"]);
    if (early) return early;
    if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

    const authorization = bearerToken(req);
    if (!authorization) return json({ error: "Not signed in" }, 401);

    try {
      const env = deps.env();
      const user = await getUser(deps.fetch, env, authorization);
      if (!user) return json({ error: "Not signed in" }, 401);

      const db = restClient(deps.fetch, env, authorization);
      const [accounts, gateways, zones, plants, prefRows] = await Promise.all([
        db.select<EcowittAccountRow>("ecowitt_accounts?select=app_key,api_key"),
        // select=* rather than a column list: gateways.latitude/longitude/timezone
        // only exist once the 20261006 migration has run, and the report should
        // keep working (without a gateway-based forecast) if functions deploy first.
        db.select<GatewayRow>("gateways?select=*&order=id"),
        db.select<ZoneRow>("zones?select=id,name,sort&order=sort,id"),
        db.select<PlantRow>("plants?select=*&hidden=eq.false"),
        db.select<PrefsRow>(
          "user_prefs?select=notify_mode,notify_offline,weather_lat,weather_lon,layout",
        ),
      ]);

      const account = accounts[0];
      if (!account) {
        return json({ error: "No Ecowitt credentials set", needs_onboarding: true });
      }
      if (plants.length === 0) {
        return json({ error: "No plants configured", needs_onboarding: true });
      }

      const creds: EcowittCredentials = { appKey: account.app_key, apiKey: account.api_key };
      const now = deps.now();
      const prefs = prefRows[0] ?? {};
      const location = forecastLocation(prefs, gateways);

      const [gatewayResults, weather] = await Promise.all([
        fetchAllGateways(deps.fetch, creds, gateways),
        location ? fetchForecast(deps.fetch, location, now) : Promise.resolve(null),
      ]);

      const gatewaysById = new Map(gateways.map((g) => [g.id, g]));
      const lastSeen: Record<number, string | null> = {};
      await Promise.all(
        plantsAwaitingLastSeen(plants, gatewayResults).map(async (plant) => {
          const gateway = gatewaysById.get(plant.gateway_id);
          if (!gateway) return;
          lastSeen[plant.id] = await fetchLastSeen(
            deps.fetch,
            creds,
            gateway.mac,
            plant.channel,
            now,
            gateway.timezone,
          );
        }),
      );

      const report = buildReport({
        generatedAt: now,
        plants,
        gateways,
        zones,
        gatewayResults,
        weather,
        lastSeen,
        user: { email: user.email, prefs: { ...prefs } },
      });
      return json(report, 200, { "Cache-Control": "no-store" });
    } catch (err) {
      if (err instanceof HttpError) {
        console.error(err.message);
        return json({ error: err.publicMessage }, err.status);
      }
      console.error(err);
      return json({ error: "Unexpected server error" }, 500);
    }
  };
}

/** One live-data request per distinct MAC, mapped back to every gateway row using it. */
async function fetchAllGateways(
  fetchFn: FetchLike,
  creds: EcowittCredentials,
  gateways: GatewayRow[],
): Promise<Record<number, GatewayResult>> {
  const byMac = new Map<string, Promise<GatewayResult>>();
  for (const g of gateways) {
    if (!byMac.has(g.mac)) byMac.set(g.mac, fetchGatewayReadings(fetchFn, creds, g.mac));
  }
  const results: Record<number, GatewayResult> = {};
  await Promise.all(gateways.map(async (g) => {
    results[g.id] = await byMac.get(g.mac)!;
  }));
  return results;
}
