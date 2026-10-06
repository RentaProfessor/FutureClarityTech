# Soil sensors: setup and troubleshooting

PlantWatch reads Ecowitt WH51 soil-moisture probes through an Ecowitt gateway (GW1100, GW1200 and similar) and the Ecowitt cloud API. Each gateway supports up to 16 soil channels. This page collects what was learned running them outdoors.

## Getting API keys

PlantWatch needs two keys from your ecowitt.net account: an **Application Key** and an **API Key** (both are created in the account settings on ecowitt.net). They are entered once during onboarding; the `ecowitt-devices` function checks them against Ecowitt before saving them.

## Placing probes

- Push the probe in vertically so both metal strips are fully in contact with soil, at the depth of the plant's roots. Air pockets read as "dry".
- Keep the probe out of a dripper's direct wet spot, or every reading after irrigation will look "too wet". A sensor that reads far wetter than its neighbours is often next to an emitter or overspray.
- Readings are relative: the same moisture percentage means different things in sand and in clay. Use the species range as a starting point and adjust each plant's range in the app after watching a few wet/dry cycles.

## When a sensor stops reporting

The dashboard distinguishes two cases:

- **No data** with a message about the gateway or the API keys: the gateway could not be read at all, so every sensor on it is affected. Check the message; re-entering the Ecowitt keys or power-cycling the gateway is usually the fix. The sensors themselves are probably fine.
- **No reading** with a "last reported" time: the gateway is fine but this one probe has gone quiet.

For a quiet probe, the most common cause is the battery, even when the app last showed a healthy voltage:

1. **Voltage sag.** A WH51 transmits a short, high-current burst roughly every 70 seconds. Alkaline AA cells have fairly high internal resistance, which rises with age, cold and corroded contacts. During the burst the voltage can dip below what the transmitter needs, so that transmission is lost, yet the resting voltage still looks normal. The symptom is a probe that drops out intermittently and comes back after the battery is reseated. **Lithium AA cells** hold their voltage much better under load and in cold weather, and are the usual fix.
2. **Contacts and seal.** Remove the battery, clean both contacts (a pencil eraser works), check the spring is not flattened, and screw the cap fully down: the probe's water resistance depends on it. A thin film of dielectric grease on the contacts helps where sprinklers wet the probe.
3. **Range.** Rated range is around 100 m in open air, but stucco walls with metal mesh, metal valve boxes, parked cars and dense hedges cut it sharply. Raise the gateway or move it closer to the quiet probes.
4. **Re-pairing.** Pull the battery for about 10 seconds and reinsert it; the probe's LED should then blink about once per transmission interval. If it still does not appear, power-cycle the gateway, which re-learns active sensors when it restarts.
5. **Firmware.** Check for gateway firmware updates in the Ecowitt app; some releases improve sensor reception.

PlantWatch does not guess at the cause for a quiet probe: the battery voltage cannot be read while a sensor is offline, so the dashboard shows when it last reported and leaves the diagnosis to these steps.
