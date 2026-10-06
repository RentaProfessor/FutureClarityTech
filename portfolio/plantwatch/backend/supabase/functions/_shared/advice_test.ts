import { assert, assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import {
  assessPlant,
  type Band,
  dripMinutes,
  dripRateGph,
  EMITTERS_PER_PLANT,
  formatDuration,
  formatInches,
  getSpecies,
  type PlantSize,
  type RainOutlook,
  resolveBand,
  SPECIES_PROFILES,
  THRESHOLDS,
  WATERING_GALLONS,
  type WateringLevel,
  wateringPlan,
} from "./advice.ts";

const CITRUS = getSpecies("citrus"); // 35-55%, large
const SIZES: PlantSize[] = ["small", "medium", "large"];
const LEVELS: WateringLevel[] = ["light", "moderate", "deep"];

function rain(next24hIn: number, next48hIn: number, maxProbability48h: number | null = null) {
  return { next24hIn, next48hIn, maxProbability48h } satisfies RainOutlook;
}

function citrusAt(moisture: number | null, outlook: RainOutlook | null = null) {
  return assessPlant({ moisture, species: "citrus", rain: outlook });
}

// ---------------------------------------------------------------------------
// Species table
// ---------------------------------------------------------------------------

Deno.test("species table: one entry per key, valid bands and sources", () => {
  const keys = SPECIES_PROFILES.map((p) => p.key);
  assertEquals(new Set(keys).size, keys.length, "duplicate species keys");
  for (const p of SPECIES_PROFILES) {
    assert(p.low >= 0 && p.high <= 100 && p.low < p.high, `${p.key} band ${p.low}-${p.high}`);
    assert(p.why.length > 20, `${p.key} needs an explanation`);
    if (p.sourceUrl !== null) assertMatch(p.sourceUrl, /^https:\/\//);
    assertEquals(p.sourceUrl === null, p.sourceLabel === null, `${p.key} source label/url`);
  }
});

Deno.test("species table: unknown, missing and garbage keys fall back to the generic profile", () => {
  for (const key of [undefined, null, "", "unknown", "cactus", "__proto__"]) {
    const p = getSpecies(key);
    assertEquals(p.key, "unknown");
    assertEquals([p.low, p.high], [25, 45]);
  }
  assertEquals(getSpecies("bay_laurel").noun, "bay laurel");
});

// ---------------------------------------------------------------------------
// Status thresholds
// ---------------------------------------------------------------------------

Deno.test("thresholds: band edges are inclusive", () => {
  assertEquals(citrusAt(35).status, "good");
  assertEquals(citrusAt(55).status, "good");
  assertEquals(citrusAt(56).status, "too_wet");
  assertEquals(citrusAt(34).status, "dry");
});

Deno.test("thresholds: watering level steps at 5 and 10 points below the floor", () => {
  const cases: Array<[number, string, WateringLevel]> = [
    [34, "dry", "light"], // 1 point below
    [31, "dry", "light"], // 4
    [30, "dry", "moderate"], // 5
    [26, "dry", "moderate"], // 9
    [25, "very_dry", "deep"], // 10
    [0, "very_dry", "deep"],
  ];
  for (const [moisture, status, level] of cases) {
    const a = citrusAt(moisture);
    assertEquals(a.status, status, `status at ${moisture}%`);
    assertEquals(a.watering?.level, level, `level at ${moisture}%`);
    assert(a.needsWater);
  }
});

Deno.test("thresholds: 'very dry' and 'deep soak' always agree (no forecast)", () => {
  for (const species of SPECIES_PROFILES) {
    for (let moisture = 0; moisture <= 100; moisture++) {
      const a = assessPlant({ moisture, species: species.key });
      assertEquals(
        a.status === "very_dry",
        a.watering?.level === "deep",
        `${species.key} at ${moisture}%: ${a.status} / ${a.watering?.level}`,
      );
      assertEquals(a.needsWater, a.status === "dry" || a.status === "very_dry");
      assertEquals(a.needsWater, a.watering !== null);
    }
  }
});

Deno.test("thresholds: advice and explanation quote the same numbers", () => {
  const a = citrusAt(24);
  assertEquals(a.status, "very_dry");
  assertStringIncludes(a.advice, "Deep-water today: 24% is 11 points below the 35% floor");
  assertStringIncludes(a.explanation, "11 points below the bottom of the citrus 35–55% band");
  assertStringIncludes(citrusAt(28).advice, "Water today: 28% is 7 points below");
  assertStringIncludes(citrusAt(34).advice, "1 point below");
  assertStringIncludes(citrusAt(60).advice, "5 points above the 55% ceiling");
});

// ---------------------------------------------------------------------------
// Forecast-aware advice
// ---------------------------------------------------------------------------

Deno.test("rain: a dry plant waits when enough rain is forecast within 48 h", () => {
  const a = citrusAt(31, rain(0.1, THRESHOLDS.deferRainIn48h));
  assertEquals(a.status, "dry_rain_coming");
  assertEquals(a.headline, "Rain coming");
  assertEquals(a.needsWater, false);
  assertEquals(a.watering, null);
  assertStringIncludes(a.advice, "Skip watering: 0.25 in of rain is forecast in the next 48 h");
});

Deno.test("rain: less than the deferral threshold changes nothing", () => {
  const a = citrusAt(31, rain(0.1, 0.24));
  assertEquals(a.status, "dry");
  assertEquals(a.watering?.level, "light");
});

Deno.test("rain: a very dry plant only waits for heavy rain within 24 h", () => {
  const waits = citrusAt(20, rain(THRESHOLDS.deferRainIn24h, 0.6));
  assertEquals(waits.status, "dry_rain_coming");
  assertEquals(waits.needsWater, false);
  assertStringIncludes(waits.advice, "0.5 in of rain is forecast in the next 24 h");

  const lighter = citrusAt(20, rain(0.49, 0.49));
  assertEquals(lighter.status, "very_dry");
  assertEquals(lighter.watering?.level, "moderate", "rain covers part of the deficit");
  assertStringIncludes(lighter.advice, "go lighter");

  const noRain = citrusAt(20, rain(0, 0.1));
  assertEquals(noRain.watering?.level, "deep");
});

Deno.test("rain: low-probability forecasts are ignored; unknown probability is trusted", () => {
  assertEquals(citrusAt(31, rain(1, 1, THRESHOLDS.minRainProbability - 1)).status, "dry");
  assertEquals(citrusAt(31, rain(1, 1, THRESHOLDS.minRainProbability)).status, "dry_rain_coming");
  assertEquals(citrusAt(31, rain(1, 1, null)).status, "dry_rain_coming");
});

Deno.test("rain: inconsistent or missing amounts are handled", () => {
  // 48 h total smaller than the 24 h total: the larger figure wins.
  assertEquals(citrusAt(31, rain(0.3, 0)).status, "dry_rain_coming");
  const unknown = { next24hIn: null, next48hIn: null, maxProbability48h: null };
  assertEquals(citrusAt(31, unknown).status, "dry");
  assertEquals(citrusAt(31, rain(Number.NaN, -1)).status, "dry");
});

Deno.test("rain: in-range and too-wet plants keep their status", () => {
  assertEquals(citrusAt(45, rain(2, 2)).status, "good");
  const wet = citrusAt(60, rain(0.4, 0.4));
  assertEquals(wet.status, "too_wet");
  assertStringIncludes(wet.advice, "More rain (0.4 in) is forecast");
  assertEquals(citrusAt(60).advice.includes("More rain"), false);
});

// ---------------------------------------------------------------------------
// Watering amounts: minutes and gallons must agree
// ---------------------------------------------------------------------------

Deno.test("watering: minutes are gallons divided by the assumed drip rate", () => {
  for (const size of SIZES) {
    const rate = dripRateGph(size);
    assertEquals(rate, 2 * EMITTERS_PER_PLANT[size]);
    for (const level of LEVELS) {
      for (const gallons of WATERING_GALLONS[size][level]) {
        const minutes = dripMinutes(gallons, size);
        // Rounded to 5 minutes, so allow at most 2.5 minutes of drift.
        assert(
          Math.abs(minutes - (gallons / rate) * 60) <= 2.5,
          `${size}/${level}: ${gallons} gal at ${rate} gal/h is not ${minutes} min`,
        );
        assertEquals(minutes % 5, 0);
      }
    }
  }
  // The old ladder said "~3 min" for 0.5-1 gal at 2 gal/h; that is 15-30 min.
  assertEquals([dripMinutes(0.5, "small"), dripMinutes(1, "small")], [15, 30]);
  assertEquals(dripMinutes(0.01, "large"), 5, "never suggests 0 minutes");
});

Deno.test("watering: amounts grow with plant size and with level", () => {
  for (const level of LEVELS) {
    assert(WATERING_GALLONS.small[level][1] <= WATERING_GALLONS.medium[level][1]);
    assert(WATERING_GALLONS.medium[level][1] <= WATERING_GALLONS.large[level][1]);
  }
  for (const size of SIZES) {
    const [light, moderate, deep] = LEVELS.map((l) => WATERING_GALLONS[size][l]);
    assert(light[1] <= moderate[0] && moderate[1] <= deep[0], `${size} levels overlap`);
  }
});

Deno.test("watering: plan text matches the plan's numbers and targets mid-band", () => {
  const band: Band = { low: 35, high: 55, custom: false };
  const plan = wateringPlan("large", "deep", band);
  assertEquals(plan.targetPct, 45);
  assertEquals([plan.gallonsLow, plan.gallonsHigh], [12, 18]);
  assertEquals([plan.minutesLow, plan.minutesHigh], [90, 135]);
  assertEquals(
    plan.text,
    "Deep soak: 12–18 gal, about 90–135 min of drip at 8 gal/h. Aim for about 45%.",
  );
  assertEquals(wateringPlan("small", "light", band).text.includes("15–30 min"), true);
});

Deno.test("formatting helpers", () => {
  assertEquals(formatDuration(15, 30), "15–30 min");
  assertEquals(formatDuration(90, 150), "90–150 min");
  assertEquals(formatInches(0.25), "0.25 in");
  assertEquals(formatInches(0.3), "0.3 in");
  assertEquals(formatInches(1), "1 in");
  assertEquals(formatInches(0.123), "0.12 in");
});

// ---------------------------------------------------------------------------
// Per-plant overrides and edge cases
// ---------------------------------------------------------------------------

Deno.test("overrides: a valid custom band replaces the species band", () => {
  const a = assessPlant({ moisture: 33, species: "citrus", idealLow: 30, idealHigh: 50 });
  assertEquals(a.band, { low: 30, high: 50, custom: true });
  assertEquals(a.status, "good");
  assertStringIncludes(a.explanation, "this plant's custom 30–50% band");
});

Deno.test("overrides: partial, invalid and no-op overrides", () => {
  assertEquals(resolveBand(CITRUS, 30, null), { low: 30, high: 55, custom: true });
  assertEquals(resolveBand(CITRUS, null, 60), { low: 35, high: 60, custom: true });
  assertEquals(resolveBand(CITRUS, 50, 40), { low: 35, high: 55, custom: false }, "low >= high");
  assertEquals(resolveBand(CITRUS, 60, null), { low: 35, high: 55, custom: false }, "low >= high");
  assertEquals(resolveBand(CITRUS, -5, 120), { low: 35, high: 55, custom: false }, "out of range");
  assertEquals(
    resolveBand(CITRUS, 35, 55),
    { low: 35, high: 55, custom: false },
    "same as species",
  );
  assertEquals(resolveBand(CITRUS, 30.4, 49.6), { low: 30, high: 50, custom: true }, "rounded");
});

Deno.test("edge cases: missing or impossible readings are 'no reading'", () => {
  for (const moisture of [null, Number.NaN, Number.POSITIVE_INFINITY, -1, 100.5]) {
    const a = citrusAt(moisture, rain(1, 1));
    assertEquals(a.status, "no_reading", String(moisture));
    assertEquals(a.needsWater, false);
    assertEquals(a.watering, null);
    assertEquals(a.moisture, null);
  }
});

Deno.test("edge cases: readings are rounded before they are judged", () => {
  // 34.6% displays as 35%, so it must also be judged as 35% (in range).
  const a = citrusAt(34.6);
  assertEquals([a.moisture, a.status], [35, "good"]);
  assertEquals(citrusAt(34.4).status, "dry");
  assertEquals(citrusAt(100).status, "too_wet");
});

Deno.test("edge cases: unknown species uses the generic band and neutral wording", () => {
  const a = assessPlant({ moisture: 20, species: "not-a-plant" });
  assertEquals(a.profile.key, "unknown");
  assertEquals(a.status, "dry");
  assertStringIncludes(a.explanation, "the 25–45% band");
  assertEquals(a.watering?.dripRateGph, 4, "generic plants are treated as medium");
});
