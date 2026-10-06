/**
 * PlantWatch advice engine.
 *
 * Pure functions that turn one soil-moisture reading, the plant's ideal band and
 * an optional rain outlook into a status, a line of advice and a watering amount.
 * There is no I/O here: the report-v2 edge function, the unit tests and the web
 * dashboard (via a browser bundle, see scripts/build_web_engine.ts) all run this
 * same code, so the rules cannot drift apart between clients.
 */

// ---------------------------------------------------------------------------
// Species profiles
// ---------------------------------------------------------------------------

export type SpeciesKey =
  | "citrus"
  | "avocado"
  | "camellia"
  | "hydrangea"
  | "rosemary"
  | "lavender"
  | "westringia"
  | "bay_laurel"
  | "star_jasmine"
  | "boxwood"
  | "convolvulus"
  | "unknown";

/** Drives how much water a watering means (see WATERING_GALLONS). */
export type PlantSize = "small" | "medium" | "large";

export interface SpeciesProfile {
  key: SpeciesKey;
  /** Label for pickers. */
  label: string;
  /** Lower-case noun for use mid-sentence ("for bay laurel"); null when unknown. */
  noun: string | null;
  size: PlantSize;
  /** Ideal volumetric soil moisture, in percent. */
  low: number;
  high: number;
  /** Why the plant wants this band; shown in the plant's detail panel. */
  why: string;
  sourceLabel: string | null;
  sourceUrl: string | null;
}

/**
 * The one species table. Earlier versions of the project carried three copies
 * that disagreed. These are the bands the deployed report used, which had lower
 * floors for the fruit trees than the first research pass (citrus 35-55% rather
 * than 40-60%, avocado 40-60% rather than 45-65%); the citrus description notes
 * that mature trees tolerate the mid-30s.
 */
export const SPECIES_PROFILES: readonly SpeciesProfile[] = [
  {
    key: "citrus",
    label: "Citrus (orange, lemon, lime…)",
    noun: "citrus",
    size: "large",
    low: 35,
    high: 55,
    why:
      "Citrus prefers consistent moisture but tolerates moderate drying; mature trees can sit in the mid-30s for a while (UC IPM suggests 4–6 inches of water a month in summer). Chronic saturation invites root and crown rot.",
    sourceLabel: "UC IPM: Citrus watering",
    sourceUrl: "https://ipm.ucanr.edu/PMG/GARDEN/FRUIT/CULTURAL/citruswatering.html",
  },
  {
    key: "avocado",
    label: "Avocado",
    noun: "avocado",
    size: "large",
    low: 40,
    high: 60,
    why:
      "Avocados have shallow feeder roots and dislike both drought and wet feet (about 2 inches of water a week in summer). Sustained high moisture leads to Phytophthora root rot.",
    sourceLabel: "California Avocado Commission: Irrigating avocado trees",
    sourceUrl:
      "https://www.californiaavocadogrowers.com/cultural-management-library/irrigating-avocado-trees",
  },
  {
    key: "camellia",
    label: "Camellia",
    noun: "camellia",
    size: "medium",
    low: 35,
    high: 50,
    why:
      "Camellias are more often killed by over-watering than under-watering. Keep moisture moderate and even and protect them from hot afternoon sun; bud drop signals summer water stress.",
    sourceLabel: "UC Master Gardeners: Camellia",
    sourceUrl: "https://ucanr.edu/blog/uc-master-gardeners-diggin-it-slo/article/camellia",
  },
  {
    key: "hydrangea",
    label: "Hydrangea",
    noun: "hydrangea",
    size: "medium",
    low: 40,
    high: 60,
    why:
      "Hydrangea macrophylla needs consistently moist, well-drained soil and wilts visibly when dry. It tolerates full sun only with steady moisture.",
    sourceLabel: "Missouri Botanical Garden: Hydrangea macrophylla",
    sourceUrl:
      "https://www.missouribotanicalgarden.org/PlantFinder/PlantFinderDetails.aspx?taxonid=286874",
  },
  {
    key: "rosemary",
    label: "Rosemary",
    noun: "rosemary",
    size: "small",
    low: 18,
    high: 35,
    why:
      "A drought-adapted Mediterranean shrub that needs no summer water once established. Roots need air between waterings; moisture held above about 35% invites crown rot.",
    sourceLabel: "UC Master Gardeners: Rosemary",
    sourceUrl: "https://sonomamg.ucanr.edu/Plant_of_the_Month/Rosemary",
  },
  {
    key: "lavender",
    label: "Lavender",
    noun: "lavender",
    size: "small",
    low: 20,
    high: 38,
    why:
      "Drought-tolerant, and excellent drainage is essential: a few days of saturated soil can cause root rot. A dry/wet cycle keeps it healthy, not constant moisture.",
    sourceLabel: "UC Master Gardeners: Lavandula",
    sourceUrl: "https://ucanr.edu/site/uc-master-gardener-program-sonoma-county/lavandula-lavender",
  },
  {
    key: "westringia",
    label: "Westringia (coast rosemary)",
    noun: "westringia",
    size: "small",
    low: 20,
    high: 38,
    why:
      "Coast rosemary is drought-tolerant and wants the soil to dry between deep waterings. Moisture held above 40% is a long-term mortality risk.",
    sourceLabel: "UC Master Gardeners: Westringia",
    sourceUrl: "https://ucanr.edu/site/uc-marin-master-gardeners/article/westringia-every-garden",
  },
  {
    key: "bay_laurel",
    label: "Bay laurel",
    noun: "bay laurel",
    size: "medium",
    low: 22,
    high: 40,
    why:
      "Established bay laurel (two years or more) adapts to low water. Sustained high moisture in clay soil is the bigger risk, so water deeply and infrequently.",
    sourceLabel: "UC Master Gardeners: Laurus nobilis",
    sourceUrl: "https://sonomamg.ucanr.edu/Plant_of_the_Month/Laurus_nobilis_Saratoga/",
  },
  {
    key: "star_jasmine",
    label: "Star jasmine",
    noun: "star jasmine",
    size: "medium",
    low: 30,
    high: 50,
    why:
      "Established star jasmine needs modest, periodic irrigation, with a little more in extreme heat. Well-drained soil only; it does not tolerate constantly wet roots.",
    sourceLabel: "UC IPM: Star jasmine",
    sourceUrl: "https://ipm.ucanr.edu/PMG/GARDEN/PLANTS/starjasmine.html",
  },
  {
    key: "boxwood",
    label: "Boxwood",
    noun: "boxwood",
    size: "medium",
    low: 28,
    high: 50,
    why:
      "Boxwood prefers slow, deep watering over frequent shallow watering. Use drip irrigation: overhead water spreads boxwood blight.",
    sourceLabel: "UC Master Gardeners: Drought watering",
    sourceUrl:
      "https://ucanr.edu/site/uc-master-gardener-program-alameda-county/thirsty-plants-and-watering-times-drought",
  },
  {
    key: "convolvulus",
    label: "Convolvulus (silverbush)",
    noun: "convolvulus",
    size: "small",
    low: 20,
    high: 40,
    why:
      "Silverbush is a Mediterranean groundcover, drought-tolerant once established. Moisture held above 40% causes root rot, so it needs excellent drainage.",
    sourceLabel: "UC IPM: Bush morning glory",
    sourceUrl: "https://ipm.ucanr.edu/PMG/GARDEN/PLANTS/bushmorngl.html",
  },
  {
    key: "unknown",
    label: "Other / not sure",
    noun: null,
    size: "medium",
    low: 25,
    high: 45,
    why:
      "No plant type is set, so a generic moderate-water band is used. Pick a type to get a species-specific range.",
    sourceLabel: null,
    sourceUrl: null,
  },
];

const PROFILE_BY_KEY: ReadonlyMap<string, SpeciesProfile> = new Map(
  SPECIES_PROFILES.map((p) => [p.key, p]),
);

/** Looks up a species; unrecognised or missing keys get the generic profile. */
export function getSpecies(key: string | null | undefined): SpeciesProfile {
  return PROFILE_BY_KEY.get(key ?? "") ?? PROFILE_BY_KEY.get("unknown")!;
}

// ---------------------------------------------------------------------------
// Thresholds and watering amounts
// ---------------------------------------------------------------------------

/**
 * Every decision threshold in one place. Moisture gaps are in percentage
 * points below the band's floor; rain is forecast precipitation in inches.
 */
export const THRESHOLDS = {
  /** A plant this far below its floor is "very dry" and gets a deep soak. */
  veryDryGap: 10,
  /** From this far below the floor a moderate (not light) watering is suggested. */
  moderateGap: 5,
  /** Rain forecast within 48 h that defers watering for a dry (not very dry) plant. */
  deferRainIn48h: 0.25,
  /** Rain forecast within 24 h that also defers watering for a very dry plant. */
  deferRainIn24h: 0.5,
  /**
   * If the forecast reports precipitation probability and its 48 h maximum is
   * below this (%), forecast rain is ignored and watering advice is unchanged.
   */
  minRainProbability: 50,
} as const;

export type WateringLevel = "light" | "moderate" | "deep";

/** Gallons per watering, as [low, high], by plant size and watering level. */
export const WATERING_GALLONS: Readonly<
  Record<PlantSize, Readonly<Record<WateringLevel, readonly [number, number]>>>
> = {
  small: { light: [0.5, 1], moderate: [1.5, 3], deep: [3, 5] },
  medium: { light: [1, 2], moderate: [4, 6], deep: [6, 10] },
  large: { light: [2, 4], moderate: [6, 10], deep: [12, 18] },
};

/**
 * Run times assume 2 gal/h drip emitters: one for a small plant, two for a
 * medium shrub and four for a large tree. Minutes = gallons / (gal/h) x 60.
 */
export const EMITTER_GPH = 2;
export const EMITTERS_PER_PLANT: Readonly<Record<PlantSize, number>> = {
  small: 1,
  medium: 2,
  large: 4,
};

/** Assumed drip delivery rate for one plant, in gallons per hour. */
export function dripRateGph(size: PlantSize): number {
  return EMITTER_GPH * EMITTERS_PER_PLANT[size];
}

/** Minutes of drip needed to deliver `gallons`, rounded to the nearest 5 (minimum 5). */
export function dripMinutes(gallons: number, size: PlantSize): number {
  const minutes = (gallons / dripRateGph(size)) * 60;
  return Math.max(5, Math.round(minutes / 5) * 5);
}

const LEVEL_LABEL: Readonly<Record<WateringLevel, string>> = {
  light: "Light watering",
  moderate: "Moderate watering",
  deep: "Deep soak",
};

export interface WateringPlan {
  level: WateringLevel;
  gallonsLow: number;
  gallonsHigh: number;
  minutesLow: number;
  minutesHigh: number;
  dripRateGph: number;
  /** Moisture to aim for: the middle of the band, which leaves a buffer. */
  targetPct: number;
  text: string;
}

export function wateringPlan(size: PlantSize, level: WateringLevel, band: Band): WateringPlan {
  const [gallonsLow, gallonsHigh] = WATERING_GALLONS[size][level];
  const minutesLow = dripMinutes(gallonsLow, size);
  const minutesHigh = dripMinutes(gallonsHigh, size);
  const rate = dripRateGph(size);
  const targetPct = Math.round((band.low + band.high) / 2);
  return {
    level,
    gallonsLow,
    gallonsHigh,
    minutesLow,
    minutesHigh,
    dripRateGph: rate,
    targetPct,
    text: `${LEVEL_LABEL[level]}: ${gallonsLow}–${gallonsHigh} gal, about ${
      formatDuration(minutesLow, minutesHigh)
    } of drip at ${rate} gal/h. Aim for about ${targetPct}%.`,
  };
}

// ---------------------------------------------------------------------------
// Assessment
// ---------------------------------------------------------------------------

export type Status =
  | "very_dry"
  | "dry"
  | "dry_rain_coming"
  | "good"
  | "too_wet"
  | "no_reading";

export interface Band {
  low: number;
  high: number;
  /** True when a per-plant override replaced the species band. */
  custom: boolean;
}

/** Forecast precipitation for the coming days. Null fields mean "unknown". */
export interface RainOutlook {
  next24hIn: number | null;
  next48hIn: number | null;
  /** Highest hourly precipitation probability (%) over the next 48 h. */
  maxProbability48h: number | null;
}

export interface PlantInput {
  /** Soil moisture in percent, as reported by the sensor; null when offline. */
  moisture: number | null;
  species: string | null | undefined;
  /** Per-plant overrides of the species band. */
  idealLow?: number | null;
  idealHigh?: number | null;
  rain?: RainOutlook | null;
}

export interface Assessment {
  status: Status;
  headline: string;
  needsWater: boolean;
  /** One or two sentences: what to do and why. */
  advice: string;
  /** How the status was derived, for the detail panel. */
  explanation: string;
  watering: WateringPlan | null;
  band: Band;
  profile: SpeciesProfile;
  /** The reading as evaluated (rounded to a whole percent), or null. */
  moisture: number | null;
}

const HEADLINES: Readonly<Record<Status, string>> = {
  very_dry: "Very dry",
  dry: "Dry",
  dry_rain_coming: "Rain coming",
  good: "Good",
  too_wet: "Too wet",
  no_reading: "No reading",
};

function isPercent(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

/** The band to judge a plant against: per-plant overrides when valid, else the species band. */
export function resolveBand(
  profile: SpeciesProfile,
  idealLow?: number | null,
  idealHigh?: number | null,
): Band {
  const low = isPercent(idealLow) ? Math.round(idealLow) : profile.low;
  const high = isPercent(idealHigh) ? Math.round(idealHigh) : profile.high;
  if (low >= high) return { low: profile.low, high: profile.high, custom: false };
  return { low, high, custom: low !== profile.low || high !== profile.high };
}

/** Rain amounts to act on, or null when there is no forecast or it is too uncertain. */
function actionableRain(
  rain: RainOutlook | null | undefined,
): { in24: number; in48: number } | null {
  if (!rain) return null;
  const p = rain.maxProbability48h;
  if (typeof p === "number" && Number.isFinite(p) && p < THRESHOLDS.minRainProbability) {
    return null;
  }
  const in24 = finiteOrZero(rain.next24hIn);
  const in48 = Math.max(finiteOrZero(rain.next48hIn), in24);
  return { in24, in48 };
}

export function assessPlant(input: PlantInput): Assessment {
  const profile = getSpecies(input.species);
  const band = resolveBand(profile, input.idealLow, input.idealHigh);
  const subject = band.custom
    ? "this plant's custom"
    : profile.noun
    ? `the ${profile.noun}`
    : "the";
  const bandText = `${subject} ${band.low}–${band.high}% band`;

  if (!isPercent(input.moisture)) {
    return {
      status: "no_reading",
      headline: HEADLINES.no_reading,
      needsWater: false,
      advice: "The sensor isn't reporting. Check its battery and its range to the gateway.",
      explanation: "There is no current reading from this sensor, so there is nothing to evaluate.",
      watering: null,
      band,
      profile,
      moisture: null,
    };
  }

  const m = Math.round(input.moisture);
  const rain = actionableRain(input.rain);
  const base = { band, profile, moisture: m };

  if (m > band.high) {
    const over = m - band.high;
    const moreRain = rain && rain.in48 >= THRESHOLDS.deferRainIn48h
      ? ` More rain (${formatInches(rain.in48)}) is forecast, so check that the bed drains.`
      : "";
    return {
      ...base,
      status: "too_wet",
      headline: HEADLINES.too_wet,
      needsWater: false,
      advice: `Hold off: ${m}% is ${points(over)} above the ${band.high}% ceiling. ` +
        `Let the soil dry out before watering again.${moreRain}`,
      explanation:
        `At ${m}% the soil is ${points(over)} above the top of ${bandText}. Roots held above ` +
        `this band for long can rot even when the surface looks dry.`,
      watering: null,
    };
  }

  const gap = band.low - m;
  if (gap <= 0) {
    return {
      ...base,
      status: "good",
      headline: HEADLINES.good,
      needsWater: false,
      advice: `In range: ${m}% is inside the ${band.low}–${band.high}% band. No action needed.`,
      explanation: `At ${m}% the soil is inside ${bandText}.`,
      watering: null,
    };
  }

  const below = `${m}% is ${points(gap)} below the ${band.low}% floor`;
  const dryExplanation = (word: string) =>
    `At ${m}% the soil is ${points(gap)} below the bottom of ${bandText}, so it reads as ${word}.`;

  if (gap < THRESHOLDS.veryDryGap) {
    if (rain && rain.in48 >= THRESHOLDS.deferRainIn48h) {
      return {
        ...base,
        status: "dry_rain_coming",
        headline: HEADLINES.dry_rain_coming,
        needsWater: false,
        advice: `Skip watering: ${formatInches(rain.in48)} of rain is forecast in the next 48 h ` +
          `and ${below}. Water if the rain doesn't arrive.`,
        explanation: `${dryExplanation("dry")} Watering is deferred because at least ` +
          `${formatInches(THRESHOLDS.deferRainIn48h)} of rain is forecast within 48 hours.`,
        watering: null,
      };
    }
    const level: WateringLevel = gap >= THRESHOLDS.moderateGap ? "moderate" : "light";
    return {
      ...base,
      status: "dry",
      headline: HEADLINES.dry,
      needsWater: true,
      advice: `${level === "light" ? "Water lightly today" : "Water today"}: ${below}.`,
      explanation: dryExplanation("dry"),
      watering: wateringPlan(profile.size, level, band),
    };
  }

  // Very dry.
  if (rain && rain.in24 >= THRESHOLDS.deferRainIn24h) {
    return {
      ...base,
      status: "dry_rain_coming",
      headline: HEADLINES.dry_rain_coming,
      needsWater: false,
      advice: `Hold off: ${formatInches(rain.in24)} of rain is forecast in the next 24 h, ` +
        `enough to rewet the soil, although ${below}. Check again after the rain.`,
      explanation: `${dryExplanation("very dry")} Watering is deferred because at least ` +
        `${formatInches(THRESHOLDS.deferRainIn24h)} of rain is forecast within 24 hours.`,
      watering: null,
    };
  }
  if (rain && rain.in48 >= THRESHOLDS.deferRainIn48h) {
    return {
      ...base,
      status: "very_dry",
      headline: HEADLINES.very_dry,
      needsWater: true,
      advice: `Water today, but go lighter: ${below}, and ${formatInches(rain.in48)} of rain ` +
        `is forecast in the next 48 h.`,
      explanation: `${dryExplanation("very dry")} Forecast rain covers part of the deficit, ` +
        `so the suggested amount is one step lighter than a deep soak.`,
      watering: wateringPlan(profile.size, "moderate", band),
    };
  }
  return {
    ...base,
    status: "very_dry",
    headline: HEADLINES.very_dry,
    needsWater: true,
    advice: `Deep-water today: ${below}.`,
    explanation: dryExplanation("very dry"),
    watering: wateringPlan(profile.size, "deep", band),
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function finiteOrZero(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function points(n: number): string {
  return `${n} point${n === 1 ? "" : "s"}`;
}

/** 0.3 -> "0.3 in", 0.25 -> "0.25 in", 1 -> "1 in". */
export function formatInches(value: number): string {
  return `${Number(value.toFixed(2))} in`;
}

/** "15–30 min". Drip timers are set in minutes, so durations stay in minutes. */
export function formatDuration(minutesLow: number, minutesHigh: number): string {
  return `${minutesLow}–${minutesHigh} min`;
}
