import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { ECOWITT_API } from "../_shared/ecowitt.ts";
import {
  fakeFetch,
  jsonResponse,
  on,
  type RecordedCall,
  type Route,
} from "../_shared/fake_fetch.ts";
import { OPEN_METEO_URL } from "../_shared/forecast.ts";
import type { Report } from "../_shared/report.ts";
import { readSupabaseEnv } from "../_shared/supabase.ts";
import { createReportHandler } from "./handler.ts";

const SUPABASE = "https://project-ref.supabase.test";
const ANON_KEY = "anon-key";
const USER_JWT = "Bearer user-a.jwt";
const NOW = new Date("2026-10-06T12:00:00Z");

interface Db {
  ecowitt_accounts: unknown[];
  gateways: unknown[];
  zones: unknown[];
  plants: unknown[];
  user_prefs: unknown[];
}

// Gateway coordinates below are an example location (London city centre).
function defaultDb(): Db {
  return {
    ecowitt_accounts: [{ app_key: "APP", api_key: "API" }],
    gateways: [
      {
        id: 1,
        mac: "00:00:5E:00:53:01",
        name: "Garden hub",
        latitude: 51.50722,
        longitude: -0.1275,
      },
      { id: 2, mac: "00:00:5E:00:53:02", name: "Patio hub", latitude: null, longitude: null },
    ],
    zones: [{ id: 10, name: "Orchard", sort: 0 }],
    plants: [
      plantRow(1, 1, 1, "Lemon tree"),
      plantRow(2, 1, 2, "Mandarin"), // channel 2 is offline
      plantRow(3, 2, 1, "Avocado"), // on the gateway whose key fails below
    ],
    user_prefs: [{
      notify_mode: "dry",
      notify_offline: true,
      weather_lat: null,
      weather_lon: null,
    }],
  };
}

function plantRow(id: number, gateway_id: number, channel: number, name: string) {
  return {
    id,
    gateway_id,
    channel,
    name,
    species: "citrus",
    zone_id: 10,
    ideal_low: null,
    ideal_high: null,
    display_order: id,
    notify: false,
  };
}

const goTrue: Route = on(
  `${SUPABASE}/auth/v1/user`,
  (call) =>
    call.headers.get("Authorization") === USER_JWT
      ? jsonResponse({ id: "user-a", email: "gardener@example.com" })
      : jsonResponse({ msg: "invalid JWT" }, 401),
);

function postgrest(db: Db): Route {
  return on(`${SUPABASE}/rest/v1/`, (call) => {
    const table = call.url.pathname.split("/").pop() as keyof Db;
    return jsonResponse(db[table]);
  });
}

const ecowitt: Route = on(ECOWITT_API, (call) => {
  const mac = call.url.searchParams.get("mac");
  if (call.url.pathname.endsWith("/real_time")) {
    if (mac === "00:00:5E:00:53:02") {
      return jsonResponse({ code: 40011, msg: "Illegal Api_Key Parameter", data: [] });
    }
    return jsonResponse({
      code: 0,
      msg: "success",
      data: { soil_ch1: { soilmoisture: { value: "44" } } },
    });
  }
  // history: channel 2 last reported at a known time
  return jsonResponse({
    code: 0,
    msg: "success",
    data: { soil_ch2: { soilmoisture: { list: { "1791200000": "36" } } } },
  });
});

const openMeteo: Route = on(OPEN_METEO_URL, () =>
  jsonResponse({
    current: { temperature_2m: 61, relative_humidity_2m: 70 },
    hourly: {
      time: [NOW.getTime() / 1000 + 3600],
      precipitation: [0.02],
      precipitation_probability: [20],
    },
    daily: {
      temperature_2m_max: [66, 64],
      temperature_2m_min: [50, 49],
      precipitation_sum: [0, 0],
    },
  }));

function setup(db: Db = defaultDb(), ...extra: Route[]) {
  const fake = fakeFetch(...extra, goTrue, postgrest(db), ecowitt, openMeteo);
  const handler = createReportHandler({
    fetch: fake.fetch,
    env: () => ({ url: SUPABASE, anonKey: ANON_KEY }),
    now: () => NOW,
  });
  return { handler, calls: fake.calls };
}

const get = (headers: Record<string, string> = { Authorization: USER_JWT }) =>
  new Request("https://fn.test/report-v2", { headers });

const restCalls = (calls: RecordedCall[]) =>
  calls.filter((c) => c.url.href.startsWith(`${SUPABASE}/rest/v1/`));

Deno.test("report-v2: rejects missing, malformed and invalid tokens", async () => {
  const { handler, calls } = setup();
  assertEquals((await handler(get({}))).status, 401);
  assertEquals((await handler(get({ Authorization: "Basic abc" }))).status, 401);
  assertEquals(calls.length, 0, "no upstream calls without a bearer token");

  const res = await handler(get({ Authorization: "Bearer someone-else" }));
  assertEquals(res.status, 401);
  assertEquals(restCalls(calls).length, 0, "the database is not queried for an invalid token");
});

Deno.test("report-v2: CORS preflight and method check", async () => {
  const { handler } = setup();
  const preflight = await handler(new Request("https://fn.test", { method: "OPTIONS" }));
  assertEquals(preflight.status, 204);
  assertEquals(preflight.headers.get("Access-Control-Allow-Origin"), "*");
  const post = await handler(new Request("https://fn.test", { method: "POST" }));
  assertEquals(post.status, 405);
});

Deno.test("report-v2: every database query runs with the caller's JWT", async () => {
  const { handler, calls } = setup();
  const res = await handler(get());
  assertEquals(res.status, 200);
  const rest = restCalls(calls);
  assertEquals(rest.length, 5);
  for (const call of rest) {
    assertEquals(call.headers.get("Authorization"), USER_JWT, call.url.pathname);
    assertEquals(call.headers.get("apikey"), ANON_KEY);
  }
});

Deno.test("report-v2: builds the report, enriches offline sensors, flags the failed gateway", async () => {
  const { handler, calls } = setup();
  const res = await handler(get());
  assertEquals(res.headers.get("Cache-Control"), "no-store");
  const report = await res.json() as Report;

  const lemon = report.readings.find((r) => r.name === "Lemon tree")!;
  assertEquals([lemon.moisture, lemon.status], [44, "good"]);

  const mandarin = report.readings.find((r) => r.name === "Mandarin")!;
  assertEquals(mandarin.status, "no_reading");
  assertEquals(mandarin.last_seen, new Date(1791200000 * 1000).toISOString());

  const avocado = report.readings.find((r) => r.name === "Avocado")!;
  assertEquals(avocado.headline, "No data");
  assertStringIncludes(avocado.offline_cause ?? "", "rejected the saved API keys");
  assertEquals(report.source_errors.map((e) => [e.gateway_name, e.kind]), [["Patio hub", "auth"]]);

  // History is only requested for the quiet channel on the healthy gateway.
  const history = calls.filter((c) => c.url.pathname.endsWith("/device/history"));
  assertEquals(history.map((c) => c.url.searchParams.get("call_back")), ["soil_ch2"]);

  // The forecast uses the gateway's location, rounded, and reaches the report.
  const forecast = calls.find((c) => c.url.href.startsWith(OPEN_METEO_URL))!;
  assertEquals(forecast.url.searchParams.get("latitude"), "51.51");
  assertEquals(report.weather.available, true);
  assertEquals(report.weather.temp_now_f, 61);
  assertEquals(report.user?.email, "gardener@example.com");
});

Deno.test("report-v2: new users are sent to onboarding", async () => {
  const noKeys = setup({ ...defaultDb(), ecowitt_accounts: [] });
  const a = await (await noKeys.handler(get())).json();
  assertEquals(a.needs_onboarding, true);

  const noPlants = setup({ ...defaultDb(), plants: [] });
  const b = await (await noPlants.handler(get())).json();
  assertEquals(b.needs_onboarding, true);
  assertEquals(
    noPlants.calls.filter((c) => c.url.href.startsWith(ECOWITT_API)).length,
    0,
    "no Ecowitt calls before onboarding",
  );
});

Deno.test("report-v2: a database failure is a 502, not 'needs onboarding'", async () => {
  const failing: Route = on(
    `${SUPABASE}/rest/v1/ecowitt_accounts`,
    () => new Response("boom", { status: 500 }),
  );
  const { handler } = setup(defaultDb(), failing);
  const res = await handler(get());
  assertEquals(res.status, 502);
  const body = await res.json();
  assertEquals(body, { error: "Database request failed" });
  assert(!("needs_onboarding" in body));
});

Deno.test("report-v2: missing server configuration is reported clearly", async () => {
  const handler = createReportHandler({
    fetch: fakeFetch().fetch,
    env: () => readSupabaseEnv(() => undefined),
    now: () => NOW,
  });
  const res = await handler(get());
  assertEquals(res.status, 500);
  assertStringIncludes((await res.json()).error, "SUPABASE_URL");
});
