import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  buildReport,
  countReadings,
  emptyWeather,
  type GatewayResult,
  type GatewayRow,
  type PlantRow,
  plantsAwaitingLastSeen,
  reassess,
  type ReportInput,
  type WeatherBlock,
  type ZoneRow,
} from "./report.ts";

const GATEWAYS: GatewayRow[] = [
  { id: 1, mac: "00:00:5E:00:53:01", name: "Garden hub" },
  { id: 2, mac: "00:00:5E:00:53:02", name: "Patio hub" },
];
const ZONES: ZoneRow[] = [
  { id: 20, name: "Kitchen garden", sort: 1 },
  { id: 10, name: "Orchard", sort: 0 },
];

function plant(overrides: Partial<PlantRow> & Pick<PlantRow, "id" | "channel">): PlantRow {
  return {
    gateway_id: 1,
    name: `Plant ${overrides.id}`,
    species: "citrus",
    zone_id: 10,
    ideal_low: null,
    ideal_high: null,
    display_order: overrides.id,
    notify: false,
    ...overrides,
  };
}

const PLANTS: PlantRow[] = [
  plant({ id: 1, channel: 1, name: "Lemon tree" }), // 47% good
  plant({ id: 2, channel: 2, name: "Avocado", species: "avocado" }), // 28% very dry
  plant({ id: 3, channel: 3, name: "Tomato bed", species: null, zone_id: 20 }), // 50% too wet
  plant({ id: 4, channel: 4, name: "Herb planter", zone_id: null }), // offline sensor
  plant({ id: 5, channel: 1, gateway_id: 2, name: "Camellia", species: "camellia", zone_id: 20 }),
];

const OK_GATEWAY_1: GatewayResult = {
  ok: true,
  channels: {
    1: { moisture: 47, battery: 1.6 },
    2: { moisture: 28, battery: 1.5 },
    3: { moisture: 50, battery: 1.4 },
  },
};
const AUTH_FAILURE: GatewayResult = {
  ok: false,
  error: { kind: "auth", message: "Illegal Api_Key Parameter", code: 40011 },
};

function input(overrides: Partial<ReportInput> = {}): ReportInput {
  return {
    generatedAt: new Date("2026-10-06T12:00:00Z"),
    plants: PLANTS,
    gateways: GATEWAYS,
    zones: ZONES,
    gatewayResults: {
      1: OK_GATEWAY_1,
      2: { ok: true, channels: { 1: { moisture: 44, battery: 1.6 } } },
    },
    weather: null,
    lastSeen: { 4: "2026-10-06T06:00:00.000Z" },
    ...overrides,
  };
}

const byName = (report: ReturnType<typeof buildReport>, name: string) =>
  report.readings.find((r) => r.name === name)!;

Deno.test("buildReport: statuses, counts and zone grouping", () => {
  const report = buildReport(input());
  assertEquals(byName(report, "Lemon tree").status, "good");
  assertEquals(byName(report, "Avocado").status, "very_dry");
  assertEquals(byName(report, "Tomato bed").status, "too_wet");
  assertEquals(byName(report, "Herb planter").status, "no_reading");
  assertEquals(report.counts, {
    needs_water: 1,
    too_wet: 1,
    good: 2,
    missing: 1,
    waiting_for_rain: 0,
  });

  const tomato = byName(report, "Tomato bed");
  assertEquals([tomato.zone_id, tomato.physical_zone, tomato.zone], [
    20,
    "Kitchen garden",
    "Garden hub",
  ]);
  const herbs = byName(report, "Herb planter");
  assertEquals([herbs.zone_id, herbs.physical_zone], [null, "Garden hub"], "no zone: gateway name");
  assertEquals(herbs.last_seen, "2026-10-06T06:00:00.000Z");
  assertEquals(herbs.offline_cause, null, "a quiet sensor is not a gateway failure");

  // Orchard (sort 0) first, then Kitchen garden (sort 1), then plants without a zone.
  assertEquals(report.readings.map((r) => r.name), [
    "Lemon tree",
    "Avocado",
    "Tomato bed",
    "Camellia",
    "Herb planter",
  ]);
  assertEquals(report.zones.map((z) => z.name), ["Orchard", "Kitchen garden"]);
});

Deno.test("buildReport: a rejected API key is reported as such, not as dead sensors", () => {
  const report = buildReport(
    input({ gatewayResults: { 1: AUTH_FAILURE, 2: input().gatewayResults[2] } }),
  );
  for (const name of ["Lemon tree", "Avocado", "Tomato bed", "Herb planter"]) {
    const r = byName(report, name);
    assertEquals(r.status, "no_reading", name);
    assertEquals(r.headline, "No data");
    assertStringIncludes(r.offline_cause ?? "", "rejected the saved API keys");
    assertEquals(r.advice, r.offline_cause);
  }
  assertEquals(byName(report, "Camellia").status, "good", "other gateways are unaffected");
  assertEquals(report.source_errors, [{
    kind: "auth",
    message: "Illegal Api_Key Parameter",
    code: 40011,
    gateway_id: 1,
    gateway_name: "Garden hub",
  }]);
  assertEquals(report.gateways.map((g) => g.ok), [false, true]);
  assertEquals(report.counts.missing, 4);
});

Deno.test("buildReport: a gateway without a result is treated as failed", () => {
  const report = buildReport(input({ gatewayResults: { 1: OK_GATEWAY_1 } }));
  assertEquals(byName(report, "Camellia").headline, "No data");
  assertEquals(report.source_errors.map((e) => e.gateway_name), ["Patio hub"]);
});

Deno.test("plantsAwaitingLastSeen: only quiet channels on reachable gateways", () => {
  const ids = (results: Record<number, GatewayResult>) =>
    plantsAwaitingLastSeen(PLANTS, results).map((p) => p.id);
  assertEquals(ids(input().gatewayResults), [4]);
  assertEquals(ids({ 1: AUTH_FAILURE }), [], "failed or unknown gateways are skipped");
});

Deno.test("buildReport: the forecast feeds the advice", () => {
  const weather: WeatherBlock = {
    ...emptyWeather(),
    available: true,
    high_today_f: 70,
    rain_next_24h_in: 0.1,
    rain_next_48h_in: 0.4,
    rain_probability_48h: 80,
  };
  const dryCitrus = buildReport(input({
    weather,
    gatewayResults: { 1: { ok: true, channels: { 1: { moisture: 32, battery: 1.6 } } } },
    plants: [PLANTS[0]],
  }));
  const lemon = byName(dryCitrus, "Lemon tree");
  assertEquals(lemon.status, "dry_rain_coming");
  assertEquals(lemon.needs_water, false);
  assertEquals(dryCitrus.counts.waiting_for_rain, 1);
  assertEquals(dryCitrus.weather.rain_next_48h_in, 0.4);

  // An unavailable forecast never defers watering.
  const noForecast = buildReport(input({
    weather: { ...weather, available: false },
    gatewayResults: { 1: { ok: true, channels: { 1: { moisture: 32, battery: 1.6 } } } },
    plants: [PLANTS[0]],
  }));
  assertEquals(byName(noForecast, "Lemon tree").status, "dry");
});

Deno.test("buildReport: per-plant ranges come from the plant row", () => {
  const report = buildReport(input({ plants: [{ ...PLANTS[0], ideal_low: 50, ideal_high: 70 }] }));
  const lemon = byName(report, "Lemon tree");
  assertEquals([lemon.ideal_low, lemon.ideal_high, lemon.custom_range], [50, 70, true]);
  assertEquals(lemon.status, "dry");
  assertStringIncludes(lemon.watering_recommendation ?? "", "Aim for about 60%");
  assertEquals(lemon.watering, {
    level: "light",
    gallons_low: 2,
    gallons_high: 4,
    minutes_low: 15,
    minutes_high: 30,
    drip_rate_gph: 8,
    target_pct: 60,
  });
});

Deno.test("buildReport: shape stays compatible with the iOS client's decoder", () => {
  const report = buildReport(input());
  assertEquals(typeof report.generated_at, "string");
  assertEquals(report.pair_notes, {});
  for (const key of ["needs_water", "too_wet", "good", "missing"] as const) {
    assert(Number.isInteger(report.counts[key]));
  }
  const allowed = new Set(["very_dry", "dry", "dry_rain_coming", "good", "too_wet", "no_reading"]);
  for (const r of report.readings) {
    assert(allowed.has(r.status), r.status);
    for (const v of [r.channel, r.display_order, r.ideal_low, r.ideal_high]) {
      assert(Number.isInteger(v), `${r.name}: ${v} must be an integer`);
    }
    assertEquals(typeof r.zone, "string");
    assertEquals(typeof r.type, "string");
    assertEquals(typeof r.verified, "boolean");
    assertEquals(typeof r.advice, "string");
  }
  // The species catalog decodes as SpeciesPreset (integer low/high).
  for (const s of report.species_catalog) {
    assert(Number.isInteger(s.low) && Number.isInteger(s.high));
  }
  assertEquals(report.weather.available, false);
});

Deno.test("countReadings: each reading lands in exactly one bucket", () => {
  assertEquals(
    countReadings([
      { status: "very_dry", needs_water: true },
      { status: "dry", needs_water: true },
      { status: "dry_rain_coming", needs_water: false },
      { status: "good", needs_water: false },
      { status: "too_wet", needs_water: false },
      { status: "no_reading", needs_water: false },
    ]),
    { needs_water: 2, too_wet: 1, good: 1, missing: 1, waiting_for_rain: 1 },
  );
});

Deno.test("reassess: same result as a fresh report with the new band", () => {
  const before = buildReport(input());
  const lemon = byName(before, "Lemon tree"); // 47%, good in the species band
  const edited = reassess(lemon, 50, 70, before.weather);
  const fresh = byName(
    buildReport(
      input({
        plants: PLANTS.map((p) => p.id === 1 ? { ...p, ideal_low: 50, ideal_high: 70 } : p),
      }),
    ),
    "Lemon tree",
  );
  assertEquals(edited, fresh);
  assertEquals(edited.status, "dry");

  const reset = reassess(edited, null, null, before.weather);
  assertEquals([reset.ideal_low, reset.ideal_high, reset.status], [35, 55, "good"]);

  // A plant on a failed gateway keeps explaining the gateway problem.
  const failed = byName(
    buildReport(input({ gatewayResults: { 1: AUTH_FAILURE, 2: input().gatewayResults[2] } })),
    "Lemon tree",
  );
  const failedEdited = reassess(failed, 40, 60, null);
  assertEquals([failedEdited.ideal_low, failedEdited.headline], [40, "No data"]);
  assertEquals(failedEdited.offline_cause, failed.offline_cause);
});
