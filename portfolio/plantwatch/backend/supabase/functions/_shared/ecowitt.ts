/**
 * Minimal Ecowitt Cloud API v3 client.
 *
 * The important property is that a failed request is never mistaken for a
 * sensor without a reading: every call returns either data or a SourceError
 * saying whether the keys were rejected, the gateway is unknown, or the API
 * could not be reached. The report then shows "update your keys" instead of
 * "check the battery" on every plant.
 */

import type { ChannelReading, GatewayResult, SourceError } from "./report.ts";

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface EcowittCredentials {
  appKey: string;
  apiKey: string;
}

export const ECOWITT_API = "https://api.ecowitt.net/api/v3";
export const SOIL_CHANNELS = 16;
const TIMEOUT_MS = 8_000;

/** API codes for a rejected or missing application key / API key. */
const CREDENTIAL_ERROR_CODES = new Set([40010, 40011, 40017, 40018]);
/** API codes for an unknown or missing gateway MAC. */
const DEVICE_ERROR_CODES = new Set([40012, 40019]);

type ApiResult = { ok: true; data: unknown } | { ok: false; error: SourceError };

export function classifyApiError(code: number, msg: string): SourceError {
  const message = msg.trim() || `Ecowitt error ${code}`;
  if (CREDENTIAL_ERROR_CODES.has(code)) return { kind: "auth", message, code };
  if (DEVICE_ERROR_CODES.has(code)) return { kind: "device", message, code };
  return { kind: "api", message, code };
}

/** GET an Ecowitt endpoint and unwrap its `{ code, msg, data }` envelope. */
export async function ecowittGet(
  fetchFn: FetchLike,
  path: string,
  params: Record<string, string>,
  timeoutMs = TIMEOUT_MS,
): Promise<ApiResult> {
  const url = new URL(`${ECOWITT_API}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  let response: Response;
  try {
    response = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "TimeoutError";
    return {
      ok: false,
      error: timedOut
        ? { kind: "timeout", message: "Ecowitt API timed out", code: null }
        : { kind: "network", message: "Could not reach the Ecowitt API", code: null },
    };
  }
  if (!response.ok) {
    await response.body?.cancel();
    return {
      ok: false,
      error: {
        kind: "http",
        message: `Ecowitt API HTTP ${response.status}`,
        code: response.status,
      },
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      ok: false,
      error: { kind: "api", message: "Ecowitt API returned invalid JSON", code: null },
    };
  }
  const envelope = asRecord(body);
  const code = parseNumber(envelope.code);
  if (code !== 0) {
    return { ok: false, error: classifyApiError(code ?? -1, String(envelope.msg ?? "")) };
  }
  return { ok: true, data: envelope.data };
}

function credentialParams(creds: EcowittCredentials): Record<string, string> {
  return { application_key: creds.appKey, api_key: creds.apiKey };
}

/** Live readings for every soil channel on one gateway. */
export async function fetchGatewayReadings(
  fetchFn: FetchLike,
  creds: EcowittCredentials,
  mac: string,
): Promise<GatewayResult> {
  const result = await ecowittGet(fetchFn, "device/real_time", {
    ...credentialParams(creds),
    mac,
    call_back: "all",
  });
  return result.ok ? { ok: true, channels: parseSoilChannels(result.data) } : result;
}

/**
 * Extracts soil channels from a real_time payload. Channels the gateway has not
 * heard from are simply absent, which the report treats as "no reading".
 */
export function parseSoilChannels(data: unknown): Record<number, ChannelReading> {
  const root = asRecord(data);
  const battery = asRecord(root.battery);
  const channels: Record<number, ChannelReading> = {};
  for (let ch = 1; ch <= SOIL_CHANNELS; ch++) {
    const moisture = parseNumber(asRecord(asRecord(root[`soil_ch${ch}`]).soilmoisture).value);
    if (moisture === null) continue;
    channels[ch] = {
      moisture,
      battery: parseNumber(asRecord(battery[`soilmoisture_sensor_ch${ch}`]).value),
    };
  }
  return channels;
}

/**
 * Time of the most recent valid reading for an offline channel, or null.
 * Looks back 3 days first (half-hour resolution), then 90 days.
 */
export async function fetchLastSeen(
  fetchFn: FetchLike,
  creds: EcowittCredentials,
  mac: string,
  channel: number,
  now: Date,
  timeZone: string | null | undefined,
): Promise<string | null> {
  for (const days of [3, 90]) {
    const start = new Date(now.getTime() - days * 86_400_000);
    const result = await ecowittGet(fetchFn, "device/history", {
      ...credentialParams(creds),
      mac,
      start_date: formatEcowittDate(start, timeZone),
      end_date: formatEcowittDate(now, timeZone),
      cycle_type: "auto",
      call_back: `soil_ch${channel}`,
    });
    if (!result.ok) return null;
    const seen = latestValidTimestamp(result.data, channel);
    if (seen) return seen;
  }
  return null;
}

/** Newest timestamp in a history payload whose value is a real reading. */
export function latestValidTimestamp(data: unknown, channel: number): string | null {
  const list = asRecord(asRecord(asRecord(asRecord(data)[`soil_ch${channel}`]).soilmoisture).list);
  let latest: number | null = null;
  for (const [ts, value] of Object.entries(list)) {
    if (parseNumber(value) === null) continue;
    const seconds = Number.parseInt(ts, 10);
    if (Number.isFinite(seconds) && (latest === null || seconds > latest)) latest = seconds;
  }
  return latest === null ? null : new Date(latest * 1000).toISOString();
}

/**
 * Ecowitt's history endpoint takes local "YYYY-MM-DD HH:MM:SS" times. The
 * gateway's own time zone is used when known, otherwise UTC.
 */
export function formatEcowittDate(date: Date, timeZone: string | null | undefined): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: validTimeZone(timeZone) ?? "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${
    get("second")
  }`;
}

export function validTimeZone(timeZone: unknown): string | null {
  if (typeof timeZone !== "string" || timeZone.length === 0) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return null;
  }
}

export interface DeviceSummary {
  mac: string;
  name: string;
  stationType: string | null;
  latitude: number | null;
  longitude: number | null;
  timeZone: string | null;
}

/** The gateways registered to an Ecowitt account. */
export async function listDevices(
  fetchFn: FetchLike,
  creds: EcowittCredentials,
): Promise<{ ok: true; devices: DeviceSummary[] } | { ok: false; error: SourceError }> {
  const result = await ecowittGet(fetchFn, "device/list", credentialParams(creds));
  if (!result.ok) return result;
  const list = asRecord(result.data).list;
  const devices: DeviceSummary[] = [];
  for (const item of Array.isArray(list) ? list : []) {
    const d = asRecord(item);
    const mac = typeof d.mac === "string" ? d.mac.trim() : "";
    if (!mac) continue;
    const stationType = typeof d.stationtype === "string" ? d.stationtype : null;
    devices.push({
      mac,
      name: typeof d.name === "string" && d.name.trim() ? d.name.trim() : stationType ?? mac,
      stationType,
      latitude: inRange(parseNumber(d.latitude), 90),
      longitude: inRange(parseNumber(d.longitude), 180),
      timeZone: validTimeZone(d.date_zone_id),
    });
  }
  return { ok: true, devices };
}

// ---------------------------------------------------------------------------

/** Ecowitt sends numbers as strings ("34", "1.6") and "-" or "" for no data. */
export function parseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

/** A coordinate within +/-limit degrees. Exactly 0 is treated as "not set" by the account. */
function inRange(value: number | null, limit: number): number | null {
  return value !== null && Math.abs(value) <= limit && value !== 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
