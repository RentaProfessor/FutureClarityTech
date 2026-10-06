/* PlantWatch: the data layer the dashboard talks to.
 *
 * Two implementations share one interface:
 *   createLiveApi(supabase)  - Supabase Edge Functions + PostgREST (RLS-scoped)
 *   createDemoApi(fixture)   - in-memory fixture data, evaluated by the same
 *                              advice engine the edge function runs */
(function () {
  "use strict";
  const PW = (window.PW = window.PW || {});

  PW.createLiveApi = function createLiveApi(supabase) {
    const userFilter = () => `user_id=eq.${encodeURIComponent(supabase.userId())}`;
    return {
      mode: "live",
      email: () => supabase.email(),
      signOut: () => supabase.signOut(),

      getReport: () => supabase.invoke("report-v2"),

      /** patch: any of name, zone_id, ideal_low, ideal_high, notify, display_order. */
      updatePlant: (plantId, patch) =>
        supabase.rest(`plants?id=eq.${Number(plantId)}`, {
          method: "PATCH",
          body: patch,
          prefer: "return=minimal",
        }),

      async createZone(name, sort) {
        const rows = await supabase.rest("zones?select=id,name,sort", {
          method: "POST",
          body: { user_id: supabase.userId(), name, sort },
          prefer: "return=representation",
        });
        return rows[0];
      },

      setPlantOrder: (plantIds) => supabase.rpc("set_plant_order", { p_plant_ids: plantIds }),

      updatePrefs: (patch) =>
        supabase.rest(`user_prefs?${userFilter()}`, {
          method: "PATCH",
          body: { ...patch, updated_at: new Date().toISOString() },
          prefer: "return=minimal",
        }),

      /** Validates Ecowitt keys, saves them, and lists gateways with their active channels. */
      discoverDevices: (appKey, apiKey) =>
        supabase.invoke("ecowitt-devices", {
          method: "POST",
          body: { app_key: appKey, api_key: apiKey, save: true },
        }),

      /** One transaction on the server: gateways, zones, plants, profile. */
      completeOnboarding: (gateways, plants) =>
        supabase.rpc("complete_onboarding", { p_gateways: gateways, p_plants: plants }),
    };
  };

  PW.createDemoApi = function createDemoApi(fixture, engine, options) {
    const scenario = (options && options.scenario) || "";
    const clone = (value) => JSON.parse(JSON.stringify(value));
    const state = {
      plants: clone(fixture.plants),
      zones: clone(fixture.zones),
      prefs: clone(fixture.prefs),
    };
    let nextZoneId = Math.max(0, ...state.zones.map((z) => z.id)) + 1;
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    function gatewayResults() {
      const results = {};
      for (const gateway of fixture.gateways) {
        results[gateway.id] = { ok: true, channels: fixture.channels[gateway.id] || {} };
      }
      if (scenario === "api-error") {
        results[fixture.gateways[1].id] = {
          ok: false,
          error: { kind: "auth", message: "Illegal Api_Key Parameter", code: 40011 },
        };
      }
      return results;
    }

    function plant(plantId) {
      const found = state.plants.find((p) => p.id === Number(plantId));
      if (!found) throw new Error("No such plant");
      return found;
    }

    return {
      mode: "demo",
      email: () => fixture.email,
      signOut: async () => {},

      async getReport() {
        await delay(250); // feel like a network call
        const now = Date.now();
        const lastSeen = {};
        for (const [id, hours] of Object.entries(fixture.lastSeenHoursAgo)) {
          lastSeen[id] = new Date(now - hours * 3600 * 1000).toISOString();
        }
        return engine.buildReport({
          generatedAt: new Date(now),
          plants: clone(state.plants),
          gateways: fixture.gateways,
          zones: clone(state.zones),
          gatewayResults: gatewayResults(),
          weather: fixture.weather,
          lastSeen,
          user: { email: fixture.email, prefs: clone(state.prefs) },
        });
      },

      async updatePlant(plantId, patch) {
        await delay(80);
        Object.assign(plant(plantId), patch);
      },

      async createZone(name, sort) {
        await delay(80);
        if (state.zones.some((z) => z.name === name)) throw new Error("That zone already exists");
        const zone = { id: nextZoneId++, name, sort };
        state.zones.push(zone);
        return clone(zone);
      },

      async setPlantOrder(plantIds) {
        await delay(80);
        plantIds.forEach((id, index) => {
          plant(id).display_order = index + 1;
        });
      },

      async updatePrefs(patch) {
        await delay(80);
        Object.assign(state.prefs, patch);
      },

      discoverDevices() {
        return Promise.reject(new Error("Device discovery is not available in demo mode."));
      },

      completeOnboarding() {
        return Promise.reject(new Error("Onboarding is not available in demo mode."));
      },
    };
  };
})();
