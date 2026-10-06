// Entry point for the browser build of the advice engine (see build_web_engine.ts).
// Exposes the same pure functions the edge function uses as window.PlantWatchEngine.

import {
  assessPlant,
  getSpecies,
  resolveBand,
  SPECIES_PROFILES,
  THRESHOLDS,
} from "../backend/supabase/functions/_shared/advice.ts";
import {
  buildReport,
  countReadings,
  emptyWeather,
  rainOutlook,
  reassess,
  speciesCatalog,
} from "../backend/supabase/functions/_shared/report.ts";

const engine = {
  assessPlant,
  buildReport,
  countReadings,
  emptyWeather,
  getSpecies,
  rainOutlook,
  reassess,
  resolveBand,
  speciesCatalog,
  SPECIES_PROFILES,
  THRESHOLDS,
};

(globalThis as unknown as { PlantWatchEngine: typeof engine }).PlantWatchEngine = engine;
