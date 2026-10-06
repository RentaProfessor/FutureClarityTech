/**
 * Open-Meteo forecast: where to ask for it, and how to boil the response down
 * to the WeatherBlock the report and the advice engine use.
 *
 * The location comes from the user's preferences (weather_lat / weather_lon)
 * or, failing that, the first gateway with coordinates (Ecowitt reports them
 * during onboarding). Coordinates are rounded to 0.01 degrees, about 1 km,
 * before they leave the server: precise enough for a forecast without sending
 * an exact home location to a third party.
 */

import type { FetchLike } from "./ecowitt.ts";
import { parseNumber } from "./ecowitt.ts";
import { emptyWeather, type GatewayRow, type WeatherBlock } from "./report.ts";

export const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
const TIMEOUT_MS = 8_000;

export interface ForecastLocation {
  latitude: number;
  longitude: number;
  source: "preferences" | "gateway";
}

export function forecastLocation(
  prefs: { weather_lat?: unknown; weather_lon?: unknown } | null | undefined,
  gateways: GatewayRow[],
): ForecastLocation | null {
  const lat = coordinate(prefs?.weather_lat, 90);
  const lon = coordinate(prefs?.weather_lon, 180);
  if (lat !== null && lon !== null) return { latitude: lat, longitude: lon, source: "preferences" };
  for (const g of gateways) {
    const glat = coordinate(g.latitude, 90);
    const glon = coordinate(g.longitude, 180);
    if (glat !== null && glon !== null) {
      return { latitude: glat, longitude: glon, source: "gateway" };
    }
  }
  return null;
}

function coordinate(value: unknown, limit: number): number | null {
  const n = parseNumber(value);
  return n !== null && Math.abs(n) <= limit ? n : null;
}

export function forecastUrl(location: ForecastLocation): URL {
  const url = new URL(OPEN_METEO_URL);
  url.searchParams.set("latitude", location.latitude.toFixed(2));
  url.searchParams.set("longitude", location.longitude.toFixed(2));
  url.searchParams.set("current", "temperature_2m,relative_humidity_2m");
  url.searchParams.set("hourly", "precipitation,precipitation_probability");
  url.searchParams.set(
    "daily",
    "temperature_2m_max,temperature_2m_min,precipitation_sum,relative_humidity_2m_min",
  );
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "3");
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("precipitation_unit", "inch");
  url.searchParams.set("timeformat", "unixtime");
  return url;
}

/** Fetches and summarises the forecast; null when it is unavailable for any reason. */
export async function fetchForecast(
  fetchFn: FetchLike,
  location: ForecastLocation,
  now: Date,
): Promise<WeatherBlock | null> {
  try {
    const response = await fetchFn(forecastUrl(location), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    return summarizeForecast(await response.json(), now);
  } catch {
    return null;
  }
}

/**
 * Summarises an Open-Meteo response (requested with timeformat=unixtime).
 * Hourly precipitation at time T is the total for the hour ending at T, so the
 * next-24 h figure sums the hours ending in (now, now + 24 h].
 */
export function summarizeForecast(raw: unknown, now: Date): WeatherBlock {
  const root = record(raw);
  const current = record(root.current);
  const hourly = record(root.hourly);
  const daily = record(root.daily);
  const day = (key: string, index: number) => parseNumber(list(daily[key])[index]);

  const nowSec = now.getTime() / 1000;
  const times = list(hourly.time);
  const precipitation = list(hourly.precipitation);
  const probability = list(hourly.precipitation_probability);
  let next24 = 0;
  let next48 = 0;
  let hours = 0;
  let maxProbability: number | null = null;
  for (let i = 0; i < times.length; i++) {
    const t = parseNumber(times[i]);
    if (t === null || t <= nowSec || t > nowSec + 48 * 3600) continue;
    const amount = parseNumber(precipitation[i]);
    if (amount !== null) {
      hours++;
      next48 += amount;
      if (t <= nowSec + 24 * 3600) next24 += amount;
    }
    const p = parseNumber(probability[i]);
    if (p !== null) maxProbability = Math.max(maxProbability ?? 0, p);
  }

  const highToday = day("temperature_2m_max", 0);
  if (highToday === null) return emptyWeather();
  return {
    available: true,
    temp_now_f: round(parseNumber(current.temperature_2m)),
    humidity_now: round(parseNumber(current.relative_humidity_2m)),
    high_today_f: round(highToday),
    low_today_f: round(day("temperature_2m_min", 0)),
    min_humidity_today: round(day("relative_humidity_2m_min", 0)),
    rain_today_in: inches(day("precipitation_sum", 0)),
    high_tomorrow_f: round(day("temperature_2m_max", 1)),
    rain_tomorrow_in: inches(day("precipitation_sum", 1)),
    rain_next_24h_in: hours > 0 ? inches(next24) : null,
    rain_next_48h_in: hours > 0 ? inches(next48) : null,
    rain_probability_48h: maxProbability === null ? null : Math.round(maxProbability),
  };
}

function round(value: number | null): number | null {
  return value === null ? null : Math.round(value);
}

function inches(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
