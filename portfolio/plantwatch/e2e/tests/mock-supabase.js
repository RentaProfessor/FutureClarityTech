// A stand-in for the Supabase APIs the web client calls, installed with
// page.route(). Reports are built with the same engine bundle the app uses
// (web/js/engine.js), so they have exactly the shape report-v2 returns.

import fs from "node:fs";
import vm from "node:vm";

export const SUPABASE_URL = "https://mock-project.supabase.co";

const engineSource = fs.readFileSync(
  new URL("../../web/js/engine.js", import.meta.url),
  "utf8",
);
const sandbox = {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(engineSource, sandbox);
const engine = sandbox.PlantWatchEngine;

const GATEWAY = {
  mac: "00:00:5E:00:53:01", // documentation-range MAC (RFC 7042)
  name: "GW1100A",
  station_type: "GW1100A",
  latitude: 51.5,
  longitude: -0.12,
  timezone: "Europe/London",
};
const CHANNELS = {
  1: { moisture: 33, battery: 1.5 },
  2: { moisture: 45, battery: 1.6 },
};

/**
 * Installs the mock on a page and returns a handle for inspecting calls and
 * steering behaviour (refresh failures, a rejected Ecowitt key, ...).
 */
export async function mockSupabase(page, options = {}) {
  const state = {
    calls: [],
    refresh: "ok", // "ok" | "unavailable" | "rejected"
    reportUnauthorizedOnce: Boolean(options.reportUnauthorizedOnce),
    gatewayError: options.gatewayError ?? null,
    onboarded: Boolean(options.onboarded),
    token: 1,
    gateways: [],
    zones: [],
    plants: [],
    prefs: { notify_mode: "off", notify_offline: false },
  };
  if (state.onboarded) seed(state);

  await page.route("**/config.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body:
        `window.PLANTWATCH_CONFIG = { supabaseUrl: "${SUPABASE_URL}", supabaseAnonKey: "anon-key" };`,
    }));

  await page.route(`${SUPABASE_URL}/**`, (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const body = request.postData() ? JSON.parse(request.postData()) : null;
    state.calls.push({
      method: request.method(),
      path: url.pathname,
      search: url.search,
      authorization: request.headers()["authorization"] ?? null,
      apikey: request.headers()["apikey"] ?? null,
      body,
    });
    const json = (status, data) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: data === undefined ? "" : JSON.stringify(data),
      });

    switch (url.pathname) {
      case "/auth/v1/token":
        if (url.searchParams.get("grant_type") === "password") {
          return json(200, session(state));
        }
        if (state.refresh === "unavailable") {
          return json(503, { msg: "upstream unavailable" });
        }
        if (state.refresh === "rejected") {
          return json(400, {
            error: "invalid_grant",
            error_description: "Invalid Refresh Token",
          });
        }
        state.token++;
        return json(200, session(state));
      case "/auth/v1/logout":
        return json(204);
      case "/functions/v1/report-v2":
        if (state.reportUnauthorizedOnce) {
          state.reportUnauthorizedOnce = false;
          return json(401, { error: "Not signed in" });
        }
        if (!state.onboarded) {
          return json(200, { error: "No plants", needs_onboarding: true });
        }
        return json(200, report(state));
      case "/functions/v1/ecowitt-devices":
        if (body.api_key !== "GOOD") {
          return json(400, {
            error: "Ecowitt rejected these keys: Illegal Api_Key Parameter",
            ecowitt_code: 40011,
          });
        }
        state.gatewayError = null;
        return json(200, {
          gateways: [{
            ...GATEWAY,
            channels: Object.entries(CHANNELS).map(([ch, r]) => ({
              channel: Number(ch),
              ...r,
            })),
            error: null,
          }],
        });
      case "/rest/v1/rpc/complete_onboarding":
        completeOnboarding(state, body);
        return json(200, {
          gateways: 1,
          zones_created: state.zones.length,
          plants: body.p_plants.length,
        });
      case "/rest/v1/rpc/set_plant_order":
        return json(204);
      case "/rest/v1/plants": {
        const id = Number(url.searchParams.get("id").replace("eq.", ""));
        Object.assign(state.plants.find((p) => p.id === id), body);
        return json(204);
      }
      case "/rest/v1/zones": {
        const zone = {
          id: state.zones.length + 1,
          name: body.name,
          sort: body.sort,
        };
        state.zones.push(zone);
        return json(201, [zone]);
      }
      case "/rest/v1/user_prefs":
        Object.assign(state.prefs, body);
        return json(204);
      default:
        return json(404, {
          message: `Not mocked: ${request.method()} ${url.pathname}`,
        });
    }
  });

  return state;
}

function session(state) {
  return {
    access_token: `jwt-${state.token}`,
    refresh_token: `refresh-${state.token}`,
    expires_in: 3600,
    token_type: "bearer",
    user: { id: "user-a", email: "gardener@example.com" },
  };
}

function completeOnboarding(state, { p_gateways, p_plants }) {
  state.onboarded = true;
  state.gateways = [{
    id: 1,
    mac: p_gateways[0].mac,
    name: p_gateways[0].name,
  }];
  const zoneNames = [...new Set(p_plants.map((p) => p.zone))];
  state.zones = zoneNames.map((name, i) => ({ id: i + 1, name, sort: i }));
  state.plants = p_plants.map((p, i) => ({
    id: 100 + i,
    gateway_id: 1,
    channel: p.channel,
    name: p.name || `Channel ${p.channel}`,
    species: p.species,
    zone_id: state.zones.find((z) => z.name === p.zone).id,
    ideal_low: null,
    ideal_high: null,
    display_order: i + 1,
    notify: false,
  }));
}

function seed(state) {
  completeOnboarding(state, {
    p_gateways: [GATEWAY],
    p_plants: [
      {
        mac: GATEWAY.mac,
        channel: 1,
        name: "Lemon tree",
        species: "citrus",
        zone: "Orchard",
      },
      {
        mac: GATEWAY.mac,
        channel: 2,
        name: "Lavender",
        species: "lavender",
        zone: "Orchard",
      },
    ],
  });
}

function report(state) {
  const result = state.gatewayError
    ? { ok: false, error: state.gatewayError }
    : { ok: true, channels: CHANNELS };
  return engine.buildReport({
    generatedAt: new Date(),
    plants: state.plants,
    gateways: state.gateways,
    zones: state.zones,
    gatewayResults: { 1: result },
    weather: null,
    lastSeen: {},
    user: { email: "gardener@example.com", prefs: state.prefs },
  });
}

/** Stores a session in localStorage before the app loads, as if signed in earlier. */
export function signedIn(page, { expired = false } = {}) {
  return page.addInitScript((isExpired) => {
    if (sessionStorage.getItem("seeded")) return; // only on the first load
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem(
      "pw-session",
      JSON.stringify({
        access_token: "jwt-1",
        refresh_token: "refresh-1",
        expires_at: Math.floor(Date.now() / 1000) + (isExpired ? -10 : 3600),
        user: { id: "user-a", email: "gardener@example.com" },
      }),
    );
  }, expired);
}
