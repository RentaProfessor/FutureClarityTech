import { assertEquals, assertStringIncludes } from "@std/assert";
import { ECOWITT_API } from "../_shared/ecowitt.ts";
import {
  fakeFetch,
  jsonResponse,
  on,
  type RecordedCall,
  type Route,
} from "../_shared/fake_fetch.ts";
import { createDevicesHandler } from "./handler.ts";

const SUPABASE = "https://project-ref.supabase.test";
const USER_JWT = "Bearer user-a.jwt";
const NOW = new Date("2026-10-06T12:00:00Z");

const goTrue: Route = on(`${SUPABASE}/auth/v1/user`, () => jsonResponse({ id: "user-a" }));

const ecowitt: Route = on(ECOWITT_API, (call) => {
  if (call.url.searchParams.get("api_key") !== "GOOD") {
    return jsonResponse({ code: 40011, msg: "Illegal Api_Key Parameter" });
  }
  if (call.url.pathname.endsWith("/device/list")) {
    return jsonResponse({
      code: 0,
      msg: "success",
      data: { list: [{ mac: "00:00:5E:00:53:01", name: "Garden hub", stationtype: "GW1100A" }] },
    });
  }
  return jsonResponse({
    code: 0,
    msg: "success",
    data: {
      soil_ch3: { soilmoisture: { value: "41" } },
      soil_ch1: { soilmoisture: { value: "35" } },
      battery: { soilmoisture_sensor_ch1: { value: "1.5" } },
    },
  });
});

function setup(savedKeys: unknown[] = []) {
  const fake = fakeFetch(
    goTrue,
    on(`${SUPABASE}/rest/v1/ecowitt_accounts`, () => jsonResponse(savedKeys), "GET"),
    on(`${SUPABASE}/rest/v1/ecowitt_accounts`, () => new Response(null, { status: 201 }), "POST"),
    ecowitt,
  );
  const handler = createDevicesHandler({
    fetch: fake.fetch,
    env: () => ({ url: SUPABASE, anonKey: "anon-key" }),
    now: () => NOW,
  });
  return { handler, calls: fake.calls };
}

const post = (body: unknown) =>
  new Request("https://fn.test/ecowitt-devices", {
    method: "POST",
    headers: { Authorization: USER_JWT, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const saves = (calls: RecordedCall[]) =>
  calls.filter((c) => c.method === "POST" && c.url.pathname.endsWith("/ecowitt_accounts"));

Deno.test("ecowitt-devices: lists gateways and sorted channels, then saves working keys", async () => {
  const { handler, calls } = setup();
  const res = await handler(post({ app_key: " APP ", api_key: "GOOD", save: true }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.gateways, [{
    mac: "00:00:5E:00:53:01",
    name: "Garden hub",
    station_type: "GW1100A",
    latitude: null,
    longitude: null,
    timezone: null,
    channels: [
      { channel: 1, moisture: 35, battery: 1.5 },
      { channel: 3, moisture: 41, battery: null },
    ],
    error: null,
  }]);
  assertEquals(body.species_catalog.length > 5, true);

  const [save] = saves(calls);
  assertEquals(save.url.searchParams.get("on_conflict"), "user_id");
  assertEquals(save.headers.get("Authorization"), USER_JWT, "written with the caller's JWT");
  assertEquals(JSON.parse(save.body!), {
    user_id: "user-a",
    app_key: "APP",
    api_key: "GOOD",
    updated_at: NOW.toISOString(),
  });
});

Deno.test("ecowitt-devices: rejected keys get a clear 400 and are not saved", async () => {
  const { handler, calls } = setup();
  const res = await handler(post({ app_key: "APP", api_key: "BAD", save: true }));
  assertEquals(res.status, 400);
  const body = await res.json();
  assertStringIncludes(body.error, "Ecowitt rejected these keys");
  assertEquals(body.ecowitt_code, 40011);
  assertEquals(saves(calls).length, 0);
});

Deno.test("ecowitt-devices: falls back to saved keys and does not re-save them", async () => {
  const { handler, calls } = setup([{ app_key: "APP", api_key: "GOOD" }]);
  const res = await handler(post({ save: true }));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).gateways.length, 1);
  assertEquals(saves(calls).length, 0);

  const none = setup([]);
  assertEquals((await none.handler(post({}))).status, 400);
});

Deno.test("ecowitt-devices: requires a signed-in POST", async () => {
  const { handler } = setup();
  const anonymous = new Request("https://fn.test", { method: "POST", body: "{}" });
  assertEquals((await handler(anonymous)).status, 401);
  const getRequest = new Request("https://fn.test", { headers: { Authorization: USER_JWT } });
  assertEquals((await handler(getRequest)).status, 405);
});
