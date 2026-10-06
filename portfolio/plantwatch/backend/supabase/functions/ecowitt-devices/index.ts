// ecowitt-devices: onboarding discovery of a user's Ecowitt gateways. See handler.ts.

import { readSupabaseEnv } from "../_shared/supabase.ts";
import { createDevicesHandler } from "./handler.ts";

Deno.serve(createDevicesHandler({
  fetch: (input, init) => fetch(input, init),
  env: () => readSupabaseEnv((key) => Deno.env.get(key)),
  now: () => new Date(),
}));
