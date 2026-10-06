// report-v2: authenticated, per-user garden report. See handler.ts.

import { readSupabaseEnv } from "../_shared/supabase.ts";
import { createReportHandler } from "./handler.ts";

Deno.serve(createReportHandler({
  fetch: (input, init) => fetch(input, init),
  env: () => readSupabaseEnv((key) => Deno.env.get(key)),
  now: () => new Date(),
}));
