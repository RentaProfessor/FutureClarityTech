import { assertEquals } from "@std/assert";
import { fakeFetch, jsonResponse } from "./fake_fetch.ts";
import { fetchForecast, forecastLocation, forecastUrl, summarizeForecast } from "./forecast.ts";
import type { GatewayRow } from "./report.ts";

// Example coordinates: London city centre. Not anyone's garden.
const LONDON = { latitude: 51.50722, longitude: -0.1275, source: "gateway" as const };

const NOW = new Date("2026-10-06T12:30:00Z");
const nowSec = NOW.getTime() / 1000;
const HOUR = 3600;

/** An Open-Meteo style response with hourly precipitation at the given offsets (hours). */
function openMeteo(hourly: Array<[offsetHours: number, inches: number, probability: number]>) {
  return {
    current: { time: nowSec, temperature_2m: 64.6, relative_humidity_2m: 71.2 },
    hourly: {
      time: hourly.map(([h]) => Math.floor(nowSec / HOUR) * HOUR + h * HOUR),
      precipitation: hourly.map(([, inches]) => inches),
      precipitation_probability: hourly.map(([, , p]) => p),
    },
    daily: {
      time: [0, 1, 2].map((d) => nowSec + d * 86400),
      temperature_2m_max: [68.4, 61.2, 63],
      temperature_2m_min: [51.6, 50.1, 49],
      precipitation_sum: [0.04, 0.31, 0],
      relative_humidity_2m_min: [48.5, 77, 60],
    },
  };
}

Deno.test("forecastLocation: user preference first, then the first gateway with coordinates", () => {
  const gateways: GatewayRow[] = [
    { id: 1, mac: "a", name: "No location", latitude: null, longitude: null },
    { id: 2, mac: "b", name: "Hub", latitude: 51.5, longitude: -0.12 },
  ];
  assertEquals(forecastLocation({ weather_lat: "40.71", weather_lon: -74.01 }, gateways), {
    latitude: 40.71,
    longitude: -74.01,
    source: "preferences",
  });
  assertEquals(forecastLocation({ weather_lat: 95, weather_lon: 10 }, gateways), {
    latitude: 51.5,
    longitude: -0.12,
    source: "gateway",
  });
  assertEquals(forecastLocation(null, [gateways[0]]), null);
});

Deno.test("forecastUrl: coordinates are rounded to 0.01 degrees before leaving the server", () => {
  const url = forecastUrl(LONDON);
  assertEquals(url.searchParams.get("latitude"), "51.51");
  assertEquals(url.searchParams.get("longitude"), "-0.13");
  assertEquals(url.searchParams.get("timezone"), "auto");
  assertEquals(url.searchParams.get("timeformat"), "unixtime");
  assertEquals(url.searchParams.get("precipitation_unit"), "inch");
});

Deno.test("summarizeForecast: sums rain over the next 24 h and 48 h only", () => {
  const block = summarizeForecast(
    openMeteo([
      [-1, 5, 100], // already happened: ignored
      [0, 5, 100], // hour ending at the start of this hour: in the past, ignored
      [1, 0.1, 40],
      [24, 0.15, 70],
      [25, 0.2, 80], // beyond 24 h, within 48 h
      [48, 0.05, 30],
      [49, 9, 100], // beyond 48 h: ignored
    ]),
    NOW,
  );
  assertEquals(block.rain_next_24h_in, 0.25);
  assertEquals(block.rain_next_48h_in, 0.5);
  assertEquals(block.rain_probability_48h, 80);
  assertEquals(block.available, true);
  assertEquals(block.temp_now_f, 65);
  assertEquals(block.humidity_now, 71);
  assertEquals([block.high_today_f, block.low_today_f], [68, 52]);
  assertEquals(block.min_humidity_today, 49);
  assertEquals([block.rain_today_in, block.rain_tomorrow_in], [0.04, 0.31]);
  assertEquals(block.high_tomorrow_f, 61);
});

Deno.test("summarizeForecast: missing data degrades to nulls", () => {
  const noHourly = summarizeForecast({ ...openMeteo([]), hourly: undefined }, NOW);
  assertEquals(noHourly.available, true);
  assertEquals(noHourly.rain_next_24h_in, null);
  assertEquals(noHourly.rain_next_48h_in, null);
  assertEquals(noHourly.rain_probability_48h, null);

  assertEquals(summarizeForecast({}, NOW).available, false);
  assertEquals(summarizeForecast("not json", NOW).available, false);
});

Deno.test("fetchForecast: returns null instead of throwing when the API fails", async () => {
  const ok = fakeFetch(() => jsonResponse(openMeteo([[2, 0.3, 90]])));
  assertEquals((await fetchForecast(ok.fetch, LONDON, NOW))?.rain_next_24h_in, 0.3);

  const down = fakeFetch(() => new Response("oops", { status: 500 }));
  assertEquals(await fetchForecast(down.fetch, LONDON, NOW), null);

  const offline = fakeFetch(() => Promise.reject(new TypeError("offline")));
  assertEquals(await fetchForecast(offline.fetch, LONDON, NOW), null);
});
