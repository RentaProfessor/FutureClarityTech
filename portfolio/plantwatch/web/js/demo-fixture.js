/* PlantWatch demo data: a fictional garden, loaded only in demo mode.
 *
 * These are raw inputs (database rows, sensor readings, a forecast summary), not
 * a finished report: demo mode runs them through the same advice engine as the
 * edge function, so statuses and advice are computed, not hard-coded. MAC
 * addresses are from the range reserved for documentation (RFC 7042), and the
 * forecast is a made-up example with no location attached. */
window.PLANTWATCH_DEMO = (function () {
  "use strict";

  function plant(id, gatewayId, channel, name, species, zoneId, extra) {
    return {
      id,
      gateway_id: gatewayId,
      channel,
      name,
      species,
      zone_id: zoneId,
      ideal_low: null,
      ideal_high: null,
      display_order: id,
      notify: false,
      ...extra,
    };
  }

  return {
    email: "demo@example.com",
    prefs: { notify_mode: "dry", notify_offline: true, layout: "grid" },

    weather: {
      available: true,
      temp_now_f: 66,
      humidity_now: 58,
      high_today_f: 72,
      low_today_f: 54,
      min_humidity_today: 41,
      rain_today_in: 0,
      high_tomorrow_f: 63,
      rain_tomorrow_in: 0.3,
      rain_next_24h_in: 0.12,
      rain_next_48h_in: 0.35,
      rain_probability_48h: 70,
    },

    gateways: [
      { id: 1, mac: "00:00:5E:00:53:01", name: "Garden hub" },
      { id: 2, mac: "00:00:5E:00:53:02", name: "Front hub" },
    ],

    zones: [
      { id: 1, name: "Orchard", sort: 0 },
      { id: 2, name: "Kitchen garden", sort: 1 },
      { id: 3, name: "Front border", sort: 2 },
    ],

    plants: [
      plant(1, 1, 1, "Lemon tree", "citrus", 1),
      plant(2, 1, 2, "Mandarin", "citrus", 1),
      plant(3, 1, 3, "Avocado", "avocado", 1, { notify: true }),
      plant(4, 1, 4, "Bay laurel", "bay_laurel", 1),
      plant(5, 1, 5, "Tomato bed", "unknown", 2, { ideal_low: 35, ideal_high: 55 }),
      plant(6, 1, 6, "Herb planter", "rosemary", 2),
      plant(7, 1, 7, "Rosemary", "rosemary", 2),
      plant(8, 2, 1, "Hydrangea", "hydrangea", 3),
      plant(9, 2, 2, "Camellia", "camellia", 3, { notify: true }),
      plant(10, 2, 3, "Boxwood hedge", "boxwood", 3),
      plant(11, 2, 4, "Lavender", "lavender", 3),
      plant(12, 2, 5, "Star jasmine", "star_jasmine", 3),
    ],

    // Latest readings by gateway id, then channel. Channel 3 on the front hub is
    // silent, as an offline sensor would be.
    channels: {
      1: {
        1: { moisture: 47, battery: 1.6 },
        2: { moisture: 32, battery: 1.5 },
        3: { moisture: 27, battery: 1.6 },
        4: { moisture: 31, battery: 1.4 },
        5: { moisture: 41, battery: 1.6 },
        6: { moisture: 41, battery: 1.5 },
        7: { moisture: 24, battery: 1.6 },
      },
      2: {
        1: { moisture: 52, battery: 1.6 },
        2: { moisture: 23, battery: 1.5 },
        4: { moisture: 27, battery: 1.6 },
        5: { moisture: 36, battery: 1.3 },
      },
    },

    // Plant id -> hours since its sensor last reported.
    lastSeenHoursAgo: { 10: 6 },
  };
})();
