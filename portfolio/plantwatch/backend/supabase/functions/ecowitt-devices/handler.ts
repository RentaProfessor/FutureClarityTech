/**
 * ecowitt-devices: onboarding discovery.
 *
 * Validates a user's Ecowitt keys (sent in the body, or the saved ones) and
 * returns their gateways with each gateway's active soil channels, so the setup
 * screen can show "here are your sensors". With `save: true`, keys that worked
 * are stored in ecowitt_accounts through PostgREST with the caller's JWT (RLS
 * limits the write to the caller's own row).
 */

import {
  type EcowittCredentials,
  fetchGatewayReadings,
  type FetchLike,
  listDevices,
} from "../_shared/ecowitt.ts";
import { bearerToken, json, preflight } from "../_shared/http.ts";
import { describeSourceError, speciesCatalog } from "../_shared/report.ts";
import { getUser, HttpError, restClient, type SupabaseEnv } from "../_shared/supabase.ts";

export interface DevicesDeps {
  fetch: FetchLike;
  env: () => SupabaseEnv;
  now: () => Date;
}

interface DevicesRequest {
  app_key?: unknown;
  api_key?: unknown;
  save?: unknown;
}

const MAX_KEY_LENGTH = 256;

export function createDevicesHandler(deps: DevicesDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    const early = preflight(req, ["POST"]);
    if (early) return early;
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const authorization = bearerToken(req);
    if (!authorization) return json({ error: "Not signed in" }, 401);

    try {
      const env = deps.env();
      const user = await getUser(deps.fetch, env, authorization);
      if (!user) return json({ error: "Not signed in" }, 401);
      const db = restClient(deps.fetch, env, authorization);

      const body = await req.json().catch(() => ({})) as DevicesRequest;
      let creds = credentialsFrom(body);
      const fromBody = creds !== null;
      if (!creds) {
        const saved = await db.select<{ app_key: string; api_key: string }>(
          "ecowitt_accounts?select=app_key,api_key",
        );
        if (saved[0]) creds = { appKey: saved[0].app_key, apiKey: saved[0].api_key };
      }
      if (!creds) return json({ error: "No Ecowitt keys provided or saved." }, 400);

      const listed = await listDevices(deps.fetch, creds);
      if (!listed.ok) {
        const rejected = listed.error.kind === "auth";
        return json(
          {
            error: rejected
              ? `Ecowitt rejected these keys: ${listed.error.message}`
              : `Couldn't list your Ecowitt devices: ${listed.error.message}`,
            ecowitt_code: listed.error.code,
          },
          rejected ? 400 : 502,
        );
      }

      const gateways = await Promise.all(listed.devices.map(async (device) => {
        const live = await fetchGatewayReadings(deps.fetch, creds, device.mac);
        const channels = live.ok
          ? Object.entries(live.channels)
            .map(([channel, r]) => ({ channel: Number(channel), ...r }))
            .sort((a, b) => a.channel - b.channel)
          : [];
        return {
          mac: device.mac,
          name: device.name,
          station_type: device.stationType,
          latitude: device.latitude,
          longitude: device.longitude,
          timezone: device.timeZone,
          channels,
          error: live.ok ? null : describeSourceError(live.error),
        };
      }));

      if (body.save === true && fromBody) {
        await db.upsert("ecowitt_accounts", {
          user_id: user.id,
          app_key: creds.appKey,
          api_key: creds.apiKey,
          updated_at: deps.now().toISOString(),
        }, "user_id");
      }

      return json({ gateways, species_catalog: speciesCatalog() });
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

function credentialsFrom(body: DevicesRequest): EcowittCredentials | null {
  const appKey = typeof body.app_key === "string" ? body.app_key.trim() : "";
  const apiKey = typeof body.api_key === "string" ? body.api_key.trim() : "";
  if (!appKey || !apiKey || appKey.length > MAX_KEY_LENGTH || apiKey.length > MAX_KEY_LENGTH) {
    return null;
  }
  return { appKey, apiKey };
}
