/**
 * Builds the JSON report the clients render, from database rows, per-gateway
 * sensor results and the forecast. Pure: all I/O happens in the edge function
 * before this is called, which keeps the report shape testable and lets the web
 * dashboard's demo mode build reports from fixture data with the same code.
 *
 * The shape is backward compatible with the iOS client's Codable models; fields
 * added since then (plant_id, zone_id, watering, zones, gateways, ...) are
 * ignored by older clients.
 */

import {
  type Assessment,
  assessPlant,
  type RainOutlook,
  SPECIES_PROFILES,
  type Status,
  type WateringPlan,
} from "./advice.ts";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface PlantRow {
  id: number;
  gateway_id: number;
  channel: number;
  name: string;
  species: string | null;
  zone_id: number | null;
  ideal_low: number | null;
  ideal_high: number | null;
  display_order: number | null;
  notify: boolean | null;
}

export interface GatewayRow {
  id: number;
  mac: string;
  name: string;
  latitude?: number | null;
  longitude?: number | null;
  timezone?: string | null;
}

export interface ZoneRow {
  id: number;
  name: string;
  sort: number;
}

export interface ChannelReading {
  /** Soil moisture, percent. */
  moisture: number | null;
  /** Sensor battery, volts. */
  battery: number | null;
}

export type SourceErrorKind = "auth" | "device" | "api" | "http" | "network" | "timeout";

/** Why a gateway's readings could not be fetched. */
export interface SourceError {
  kind: SourceErrorKind;
  message: string;
  /** Ecowitt API code or HTTP status, when there is one. */
  code: number | null;
}

/** The outcome of fetching one gateway: its channels, or why that failed. */
export type GatewayResult =
  | { ok: true; channels: Record<number, ChannelReading> }
  | { ok: false; error: SourceError };

/** Current conditions and outlook, in the units the clients display. */
export interface WeatherBlock {
  available: boolean;
  temp_now_f: number | null;
  humidity_now: number | null;
  high_today_f: number | null;
  low_today_f: number | null;
  min_humidity_today: number | null;
  rain_today_in: number | null;
  high_tomorrow_f: number | null;
  rain_tomorrow_in: number | null;
  rain_next_24h_in: number | null;
  rain_next_48h_in: number | null;
  rain_probability_48h: number | null;
}

export interface ReportInput {
  generatedAt: Date;
  plants: PlantRow[];
  gateways: GatewayRow[];
  zones: ZoneRow[];
  /** Keyed by gateway id. A missing entry is treated as a failed fetch. */
  gatewayResults: Record<number, GatewayResult>;
  weather: WeatherBlock | null;
  /** ISO time of the last valid reading, keyed by plant id (offline sensors only). */
  lastSeen?: Record<number, string | null>;
  user?: { email: string | null; prefs: Record<string, unknown> } | null;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface Reading {
  plant_id: number;
  gateway_id: number;
  zone_id: number | null;
  /** Gateway name. The iOS client keys its local preferences on zone + channel. */
  zone: string;
  gateway_name: string;
  channel: number;
  display_order: number;
  /** The plant's zone name, or the gateway name when it has no zone (iOS groups by this). */
  physical_zone: string;
  physical_zone_verified: boolean;
  name: string;
  /** Species noun for sentences ("bay laurel"); null when the type is not set. */
  species: string | null;
  /** Species key ("bay_laurel"). */
  type: string;
  verified: boolean;
  pair: null;
  pair_role: null;
  ideal_low: number;
  ideal_high: number;
  custom_range: boolean;
  moisture: number | null;
  battery: number | null;
  status: Status;
  headline: string;
  advice: string;
  needs_water: boolean;
  rating_explanation: string;
  watering_recommendation: string | null;
  watering_target_pct: number | null;
  watering: WateringJson | null;
  species_note: string;
  source_label: string | null;
  source_url: string | null;
  notify: boolean;
  last_seen: string | null;
  last_battery: null;
  /** Set when the gateway (not the sensor) is the reason there is no reading. */
  offline_cause: string | null;
}

/** A WateringPlan in the report's snake_case. */
export interface WateringJson {
  level: WateringPlan["level"];
  gallons_low: number;
  gallons_high: number;
  minutes_low: number;
  minutes_high: number;
  drip_rate_gph: number;
  target_pct: number;
}

export interface Counts {
  needs_water: number;
  too_wet: number;
  good: number;
  missing: number;
  waiting_for_rain: number;
}

export interface GatewayStatus {
  id: number;
  name: string;
  ok: boolean;
  error: SourceError | null;
}

export interface Report {
  generated_at: string;
  weather: WeatherBlock;
  counts: Counts;
  pair_notes: Record<string, string>;
  readings: Reading[];
  zones: ZoneRow[];
  gateways: GatewayStatus[];
  /** One entry per gateway whose readings could not be fetched. */
  source_errors: Array<SourceError & { gateway_id: number; gateway_name: string }>;
  species_catalog: SpeciesCatalogEntry[];
  user?: { email: string | null; prefs: Record<string, unknown> };
}

export interface SpeciesCatalogEntry {
  key: string;
  label: string;
  low: number;
  high: number;
  why: string;
  source_label: string | null;
  source_url: string | null;
}

// ---------------------------------------------------------------------------

export function emptyWeather(): WeatherBlock {
  return {
    available: false,
    temp_now_f: null,
    humidity_now: null,
    high_today_f: null,
    low_today_f: null,
    min_humidity_today: null,
    rain_today_in: null,
    high_tomorrow_f: null,
    rain_tomorrow_in: null,
    rain_next_24h_in: null,
    rain_next_48h_in: null,
    rain_probability_48h: null,
  };
}

/** The part of the weather block the advice engine uses. */
export function rainOutlook(weather: WeatherBlock | null): RainOutlook | null {
  if (!weather?.available) return null;
  return {
    next24hIn: weather.rain_next_24h_in,
    next48hIn: weather.rain_next_48h_in,
    maxProbability48h: weather.rain_probability_48h,
  };
}

export function speciesCatalog(): SpeciesCatalogEntry[] {
  return SPECIES_PROFILES.map((p) => ({
    key: p.key,
    label: p.label,
    low: p.low,
    high: p.high,
    why: p.why,
    source_label: p.sourceLabel,
    source_url: p.sourceUrl,
  }));
}

/** User-facing explanation for a gateway whose readings could not be fetched. */
export function describeSourceError(error: SourceError): string {
  switch (error.kind) {
    case "auth":
      return "Ecowitt rejected the saved API keys, so no readings could be fetched. " +
        "The sensors are probably fine; update the keys in setup.";
    case "device":
      return "Ecowitt does not recognise this gateway on the saved account. " +
        "Check that the gateway is still registered in the Ecowitt app.";
    case "http":
    case "network":
    case "timeout":
      return "Couldn't reach the Ecowitt API, so there is no current reading. " +
        "It will retry on the next refresh.";
    case "api":
      return `The Ecowitt API returned an error (${error.message}), so there is no current reading.`;
  }
}

/**
 * Plants on a reachable gateway whose channel has no reading. These are the
 * only ones worth a history lookup for a last-seen time.
 */
export function plantsAwaitingLastSeen(
  plants: PlantRow[],
  gatewayResults: Record<number, GatewayResult>,
): PlantRow[] {
  return plants.filter((plant) => {
    const result = gatewayResults[plant.gateway_id];
    return result?.ok === true && !isReading(result.channels[plant.channel]?.moisture);
  });
}

function isReading(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

const MISSING_GATEWAY: SourceError = {
  kind: "device",
  message: "Gateway not found",
  code: null,
};

export function buildReport(input: ReportInput): Report {
  const gatewaysById = new Map(input.gateways.map((g) => [g.id, g]));
  const zonesById = new Map(input.zones.map((z) => [z.id, z]));
  const rain = rainOutlook(input.weather);

  const readings = input.plants.map((plant): Reading => {
    const gateway = gatewaysById.get(plant.gateway_id);
    const gatewayName = gateway?.name ?? "Unknown gateway";
    const zone = plant.zone_id === null ? undefined : zonesById.get(plant.zone_id);
    const result: GatewayResult = input.gatewayResults[plant.gateway_id] ??
      { ok: false, error: MISSING_GATEWAY };
    const channel = result.ok ? result.channels[plant.channel] : undefined;
    const assessment = assessPlant({
      moisture: channel?.moisture ?? null,
      species: plant.species,
      idealLow: plant.ideal_low,
      idealHigh: plant.ideal_high,
      rain,
    });

    return {
      plant_id: plant.id,
      gateway_id: plant.gateway_id,
      zone_id: zone ? zone.id : null,
      zone: gatewayName,
      gateway_name: gatewayName,
      channel: plant.channel,
      display_order: plant.display_order ?? plant.channel,
      physical_zone: zone?.name ?? gatewayName,
      physical_zone_verified: true,
      name: plant.name,
      verified: true,
      pair: null,
      pair_role: null,
      battery: channel?.battery ?? null,
      notify: plant.notify ?? false,
      last_seen: input.lastSeen?.[plant.id] ?? null,
      last_battery: null,
      ...assessmentFields(assessment, result.ok ? null : describeSourceError(result.error)),
    };
  });

  const zoneSort = (r: Reading) => {
    const zone = r.zone_id === null ? undefined : zonesById.get(r.zone_id);
    return zone ? zone.sort : Number.MAX_SAFE_INTEGER;
  };
  readings.sort((a, b) =>
    zoneSort(a) - zoneSort(b) ||
    a.display_order - b.display_order ||
    a.gateway_name.localeCompare(b.gateway_name) ||
    a.channel - b.channel
  );

  const gateways: GatewayStatus[] = input.gateways.map((g) => {
    const result = input.gatewayResults[g.id];
    const error = result ? (result.ok ? null : result.error) : MISSING_GATEWAY;
    return { id: g.id, name: g.name, ok: error === null, error };
  });

  return {
    generated_at: input.generatedAt.toISOString(),
    weather: input.weather ?? emptyWeather(),
    counts: countReadings(readings),
    pair_notes: {},
    readings,
    zones: [...input.zones].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)),
    gateways,
    source_errors: gateways.flatMap((g) =>
      g.error ? [{ ...g.error, gateway_id: g.id, gateway_name: g.name }] : []
    ),
    species_catalog: speciesCatalog(),
    ...(input.user ? { user: input.user } : {}),
  };
}

/** The parts of a Reading that come from the advice engine. */
function assessmentFields(a: Assessment, offlineCause: string | null) {
  const { profile, band, watering } = a;
  return {
    species: profile.noun,
    type: profile.key,
    ideal_low: band.low,
    ideal_high: band.high,
    custom_range: band.custom,
    moisture: a.moisture,
    status: a.status,
    // A gateway failure explains itself; the sensor itself may be fine.
    headline: offlineCause ? "No data" : a.headline,
    advice: offlineCause ?? a.advice,
    needs_water: a.needsWater,
    rating_explanation: offlineCause
      ? "No data from the gateway, so there is nothing to evaluate."
      : a.explanation,
    watering_recommendation: watering?.text ?? null,
    watering_target_pct: watering?.targetPct ?? null,
    watering: watering
      ? {
        level: watering.level,
        gallons_low: watering.gallonsLow,
        gallons_high: watering.gallonsHigh,
        minutes_low: watering.minutesLow,
        minutes_high: watering.minutesHigh,
        drip_rate_gph: watering.dripRateGph,
        target_pct: watering.targetPct,
      }
      : null,
    species_note: profile.why,
    source_label: profile.sourceLabel,
    source_url: profile.sourceUrl,
    offline_cause: offlineCause,
  };
}

/**
 * Re-evaluates one reading with a new band (null = species default) without a
 * round trip. The web client uses this for instant feedback while a range is
 * edited; the next server report recomputes the same thing.
 */
export function reassess(
  reading: Reading,
  idealLow: number | null,
  idealHigh: number | null,
  weather: WeatherBlock | null,
): Reading {
  const assessment = assessPlant({
    moisture: reading.moisture,
    species: reading.type,
    idealLow,
    idealHigh,
    rain: rainOutlook(weather),
  });
  return { ...reading, ...assessmentFields(assessment, reading.offline_cause) };
}

export function countReadings(readings: Pick<Reading, "status" | "needs_water">[]): Counts {
  const counts: Counts = { needs_water: 0, too_wet: 0, good: 0, missing: 0, waiting_for_rain: 0 };
  for (const r of readings) {
    if (r.needs_water) counts.needs_water++;
    else if (r.status === "too_wet") counts.too_wet++;
    else if (r.status === "good") counts.good++;
    else if (r.status === "no_reading") counts.missing++;
    else if (r.status === "dry_rain_coming") counts.waiting_for_rain++;
  }
  return counts;
}
