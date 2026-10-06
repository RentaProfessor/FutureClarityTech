/* PlantWatch dashboard.
 *
 * Renders the report from report-v2 (or demo data), and saves per-plant
 * settings (name, zone, ideal range, alerts, order) to the database through the
 * API layer. Edits show immediately: the plant is re-evaluated in the browser
 * with the same advice engine the server runs (window.PlantWatchEngine). */
(function () {
  "use strict";
  const PW = (window.PW = window.PW || {});
  const engine = window.PlantWatchEngine;
  const $ = (id) => document.getElementById(id);

  const REFRESH_MS = 5 * 60 * 1000;
  const STALE_MS = 60 * 1000;

  let api = null;
  let report = null;
  let view = "report"; // "report" | "sensors"
  let zoneFilter = "all"; // "all" | section key
  let layoutMode = storageGet("pw-layout") === "list" ? "list" : "grid";
  let lastError = null;
  let refreshTimer = null;
  const openInfo = new Set(); // plant ids whose detail panel is open

  // ── Small helpers ─────────────────────────────────────────────────────

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]);
  }

  /** Only http(s) links are rendered as links. */
  function safeUrl(value) {
    try {
      const url = new URL(String(value));
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
    } catch {
      return null;
    }
  }

  function storageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage unavailable; the preference just won't persist.
    }
  }

  function relTime(iso) {
    const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (seconds < 45) return "just now";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    return new Date(iso).toLocaleDateString();
  }

  function absTime(iso) {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const inches = (n) => `${Number(Number(n).toFixed(2))} in`;
  const findReading = (plantId) => report.readings.find((r) => r.plant_id === Number(plantId));
  const zoneKey = (zoneId) => (zoneId === null || zoneId === undefined ? "none" : `z${zoneId}`);

  function toast(message, kind) {
    const el = document.createElement("div");
    el.className = `toast${kind === "error" ? " toast--error" : ""}`;
    el.setAttribute("role", kind === "error" ? "alert" : "status");
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4500);
  }

  function emojiFor(name, type) {
    const n = String(name).toLowerCase();
    const byName = [
      ["lemon", "🍋"],
      ["lime", "🍋"],
      ["grapefruit", "🍊"],
      ["orange", "🍊"],
      ["mandarin", "🍊"],
      ["tangerine", "🍊"],
      ["avocado", "🥑"],
      ["tomato", "🍅"],
      ["herb", "🌿"],
      ["basil", "🌿"],
      ["hydrangea", "💐"],
      ["camellia", "🌸"],
      ["jasmine", "🌸"],
      ["rosemary", "🌿"],
      ["lavender", "💜"],
      ["westringia", "🌾"],
      ["laurel", "🌳"],
      ["boxwood", "🌳"],
      ["hedge", "🌳"],
      ["convolvulus", "🌱"],
    ];
    for (const [needle, emoji] of byName) if (n.includes(needle)) return emoji;
    const byType = {
      citrus: "🍊",
      avocado: "🥑",
      hydrangea: "💐",
      camellia: "🌸",
      star_jasmine: "🌸",
      rosemary: "🌿",
      lavender: "💜",
      westringia: "🌾",
      bay_laurel: "🌳",
      boxwood: "🌳",
      convolvulus: "🌱",
    };
    return byType[type] || "🪴";
  }

  // ── Writes: optimistic locally, then saved; reload on failure ───────────

  async function save(promise, what) {
    try {
      await promise;
    } catch (err) {
      if (err instanceof PW.AuthError) return;
      toast(`Couldn't save ${what}: ${err.message}`, "error");
      load();
    }
  }

  function recount() {
    report.counts = engine.countReadings(report.readings);
  }

  function updateRange(plantId, low, high) {
    const index = report.readings.findIndex((r) => r.plant_id === Number(plantId));
    if (index === -1) return;
    report.readings[index] = engine.reassess(report.readings[index], low, high, report.weather);
    recount();
    render();
    save(api.updatePlant(plantId, { ideal_low: low, ideal_high: high }), "the range");
  }

  function updateZone(plantId, zoneId) {
    const r = findReading(plantId);
    if (!r || r.zone_id === zoneId) return;
    r.zone_id = zoneId;
    const zone = report.zones.find((z) => z.id === zoneId);
    r.physical_zone = zone ? zone.name : r.gateway_name;
    render();
    save(api.updatePlant(plantId, { zone_id: zoneId }), "the zone");
  }

  async function addZone(plantId, name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const existing = report.zones.find((z) => z.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return updateZone(plantId, existing.id);
    try {
      const sort = report.zones.reduce((max, z) => Math.max(max, z.sort), -1) + 1;
      const zone = await api.createZone(trimmed.slice(0, 80), sort);
      report.zones.push(zone);
      updateZone(plantId, zone.id);
    } catch (err) {
      toast(`Couldn't create the zone: ${err.message}`, "error");
    }
  }

  // ── Rendering ─────────────────────────────────────────────────────────

  /** Report readings grouped into zone sections, in zone order. */
  function sections() {
    const result = report.zones.map((z) => ({ key: zoneKey(z.id), name: z.name, readings: [] }));
    const byKey = new Map(result.map((s) => [s.key, s]));
    const unassigned = { key: "none", name: "No zone", readings: [] };
    for (const r of report.readings) (byKey.get(zoneKey(r.zone_id)) || unassigned).readings.push(r);
    const all = [...result, unassigned].filter((s) => s.readings.length);
    for (const s of all) s.readings.sort((a, b) => a.display_order - b.display_order);
    return all;
  }

  function renderBanners() {
    const parts = [];
    for (const e of report.source_errors || []) {
      const fix = e.kind === "auth" && api.mode === "live"
        ? ` <button type="button" class="link-btn" data-action="reconnect">Update Ecowitt keys</button>`
        : "";
      const reason = e.kind === "auth"
        ? "Ecowitt rejected the saved API keys, so its sensors show no data. The sensors themselves are probably fine."
        : e.kind === "device"
        ? "Ecowitt does not recognise this gateway on your account."
        : `Couldn't reach Ecowitt (${e.message}). Readings will retry on the next refresh.`;
      parts.push(`<div class="banner banner--error" role="alert">
        <strong>${esc(e.gateway_name)}:</strong> ${esc(reason)}${fix}</div>`);
    }
    if (lastError) {
      parts.push(`<div class="banner banner--warn" role="status">
        Couldn't refresh (${esc(lastError)}). Showing readings from ${
        esc(relTime(report.generated_at))
      }.</div>`);
    }
    return parts.join("");
  }

  function renderWeather(w) {
    if (!w || !w.available) return "";
    const now = [];
    if (w.temp_now_f != null) now.push(`Now ${w.temp_now_f}°F`);
    if (w.humidity_now != null) now.push(`${w.humidity_now}% RH`);
    if (w.high_today_f != null) {
      now.push(
        `High ${w.high_today_f}°F${w.low_today_f != null ? ` / low ${w.low_today_f}°F` : ""}`,
      );
    }
    if (w.high_tomorrow_f != null) now.push(`Tomorrow ${w.high_tomorrow_f}°F`);
    const cloud = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M17.5 19a4.5 4.5 0 1 0-3.4-7.5A6 6 0 1 0 7 19h10.5z"/></svg>`;
    let html = `<span class="hero-weather">${cloud}${esc(now.join(" · "))}</span>`;
    if (w.rain_next_48h_in != null && w.rain_next_48h_in >= 0.05) {
      const chance = w.rain_probability_48h != null ? `, ${w.rain_probability_48h}% chance` : "";
      html += `<span class="hero-weather hero-weather--rain">${
        esc(`Rain: ${inches(w.rain_next_48h_in)} expected over the next 48 h${chance}`)
      }</span>`;
    }
    return html;
  }

  function renderHero() {
    const c = report.counts;
    const names = (list) => {
      const shown = list.slice(0, 3).map((r) => r.name).join(", ");
      return list.length > 3 ? `${shown} +${list.length - 3} more` : shown;
    };
    const thirsty = report.readings
      .filter((r) => r.needs_water)
      .sort((a, b) => (b.ideal_low - b.moisture) - (a.ideal_low - a.moisture));
    let eyebrow, title, sub;
    if (c.needs_water > 0) {
      eyebrow = "Action needed";
      title = `${plural(c.needs_water, "plant")} need${c.needs_water === 1 ? "s" : ""} water`;
      sub = names(thirsty);
    } else if (c.too_wet > 0) {
      eyebrow = "Heads up";
      title = `${plural(c.too_wet, "plant")} too wet`;
      sub = names(report.readings.filter((r) => r.status === "too_wet"));
    } else if (c.missing > 0) {
      eyebrow = "Heads up";
      title = `${plural(c.missing, "sensor")} not reporting`;
      sub = (report.source_errors || []).length
        ? "A gateway couldn't be read; see the message above."
        : "Check the sensors' batteries and range to the gateway.";
    } else if (c.waiting_for_rain > 0) {
      eyebrow = "Rain on the way";
      title = "Let the rain do the watering";
      sub = names(report.readings.filter((r) => r.status === "dry_rain_coming"));
    } else {
      eyebrow = "All set";
      title = "Garden looks happy";
      sub = `All ${plural(c.good, "plant")} in their ideal range.`;
    }
    const stat = (n, label) =>
      `<div class="hero-stat"><div class="num">${
        Number(n)
      }</div><div class="lbl">${label}</div></div>`;
    return `<section class="hero-card fade-in">
      <div class="h-eyebrow">${esc(eyebrow)}</div>
      <h2 class="h-title">${esc(title)}</h2>
      <p class="h-sub">${esc(sub)}</p>
      ${renderWeather(report.weather)}
      <div class="h-stats">
        ${stat(c.needs_water, "NEED WATER")}
        ${c.waiting_for_rain ? stat(c.waiting_for_rain, "RAIN COMING") : ""}
        ${stat(c.too_wet, "TOO WET")}
        ${stat(c.good, "DOING FINE")}
        ${c.missing ? stat(c.missing, "OFFLINE") : ""}
      </div>
    </section>`;
  }

  function renderFilterRow(list) {
    const total = list.reduce((n, s) => n + s.readings.length, 0);
    const chip = (key, label, count) =>
      `<button type="button" class="filter-chip${zoneFilter === key ? " filter-chip--active" : ""}"
        data-action="filter" data-zone="${esc(key)}" aria-pressed="${zoneFilter === key}">${
        esc(label)
      } <span class="filter-count">${count}</span></button>`;
    const layoutButton = (key, label, icon) =>
      `<button type="button" class="layout-btn${layoutMode === key ? " layout-btn--active" : ""}"
        data-action="layout" data-layout="${key}" aria-label="${label} view"
        aria-pressed="${layoutMode === key}">${icon}</button>`;
    return `<div class="filter-row">
      <div class="filter-chips">${chip("all", "All", total)}${
      list.map((s) => chip(s.key, s.name, s.readings.length)).join("")
    }</div>
      <div class="layout-toggle" role="group" aria-label="Layout">
        ${
      layoutButton(
        "grid",
        "Grid",
        `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg>`,
      )
    }
        ${
      layoutButton(
        "list",
        "List",
        `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="3" y="4" width="18" height="3" rx="1.5"/><rect x="3" y="10.5" width="18" height="3" rx="1.5"/><rect x="3" y="17" width="18" height="3" rx="1.5"/></svg>`,
      )
    }
      </div>
    </div>`;
  }

  const STATUSES = new Set(["very_dry", "dry", "dry_rain_coming", "good", "too_wet", "no_reading"]);

  function renderCard(r) {
    const status = STATUSES.has(r.status) ? r.status : "no_reading";
    const open = openInfo.has(r.plant_id);
    const battery = typeof r.battery === "number" ? ` · ${r.battery.toFixed(1)} V` : "";
    let moisture =
      `<div class="moisture-row"><div class="moisture-val moisture-val--none">No reading</div></div>`;
    if (typeof r.moisture === "number") {
      const clamp = (n) => Math.max(0, Math.min(100, Number(n)));
      const pct = clamp(r.moisture);
      const lo = clamp(r.ideal_low);
      const hi = clamp(r.ideal_high);
      moisture = `<div class="moisture-row">
          <div class="moisture-val">${Math.round(r.moisture)}<span class="pct">%</span></div>
          <div class="moisture-range">Ideal ${lo}–${hi}%</div>
        </div>
        <div class="gauge" aria-hidden="true">
          <div class="gauge-ideal" style="left:${lo}%;width:${hi - lo}%"></div>
          <div class="gauge-bar" style="width:${pct}%"></div>
          <div class="gauge-mark" style="left:${pct}%"></div>
        </div>`;
    }
    const lastSeen = status === "no_reading" && r.last_seen
      ? `<div class="last-seen">Last reported ${esc(relTime(r.last_seen))}</div>`
      : "";
    return `<article class="card fade-in${open ? " card--info-open" : ""}" data-status="${status}"
        data-plant="${Number(r.plant_id)}">
      <div class="card-head">
        <div class="card-name-wrap">
          <div class="card-emoji" aria-hidden="true">${emojiFor(r.name, r.type)}</div>
          <div class="card-name-text">
            <div class="card-name" title="${esc(r.name)}">${esc(r.name)}</div>
            <div class="card-sub">CH${Number(r.channel)}${battery}</div>
          </div>
        </div>
        <div class="card-head-right">
          <span class="badge badge--${status}">${esc(r.headline)}</span>
          <button type="button" class="info-btn" data-action="info" data-plant="${
      Number(r.plant_id)
    }"
            aria-label="Details for ${esc(r.name)}" aria-expanded="${open}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="16" x2="12" y2="12"/><circle cx="12" cy="8" r=".5" fill="currentColor"/></svg>
          </button>
          <button type="button" class="drag-handle" aria-label="Reorder ${
      esc(r.name)
    } (drag, or use the arrow keys)"
            title="Drag to reorder">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/>
              <circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/>
            </svg>
          </button>
        </div>
      </div>
      ${moisture}
      ${lastSeen}
      <div class="advice">${esc(r.advice)}</div>
      ${open ? renderInfoPanel(r) : ""}
    </article>`;
  }

  function section(label, body, extra) {
    return `<div class="info-section"><div class="info-label">${label}</div>${body}${
      extra || ""
    }</div>`;
  }

  function renderInfoPanel(r) {
    const id = Number(r.plant_id);
    const source = safeUrl(r.source_url);
    const sourceLink = source && r.source_label
      ? `<div class="info-source">Source: <a href="${
        esc(source)
      }" target="_blank" rel="noopener noreferrer">${esc(r.source_label)}</a></div>`
      : "";
    const parts = [];

    parts.push(section(
      `Name <span class="ch-tag">CH${Number(r.channel)} · ${esc(r.gateway_name)}</span>`,
      `<form class="name-row" data-form="rename" data-plant="${id}">
        <input type="text" class="text-input" name="name" maxlength="80" value="${esc(r.name)}"
          aria-label="Plant name" required/>
        <button type="submit" class="name-save-btn">Save</button>
      </form>`,
    ));

    if (r.status === "no_reading") {
      const seen = r.last_seen
        ? `Last reported <strong>${esc(absTime(r.last_seen))}</strong> (${
          esc(relTime(r.last_seen))
        }). `
        : "";
      const cause = r.offline_cause
        ? esc(r.offline_cause)
        : "Battery state can't be read while a sensor is offline, so the cause is unconfirmed; a weak battery, a loose battery contact or the distance to the gateway are the usual suspects.";
      parts.push(section("Sensor status", `<div class="info-text">${seen}${cause}</div>`));
    } else {
      parts.push(
        section("Why this rating", `<div class="info-text">${esc(r.rating_explanation)}</div>`),
      );
    }
    if (r.watering_recommendation) {
      parts.push(
        section(
          "Suggested watering",
          `<div class="info-text">${esc(r.watering_recommendation)}</div>`,
        ),
      );
    }
    parts.push(section(
      `Why ${esc(r.species || "this plant")} wants this range`,
      `<div class="info-text">${esc(r.species_note)}</div>`,
      sourceLink,
    ));
    parts.push(renderZonePicker(r));
    parts.push(renderRangeEditor(r));
    parts.push(renderNotifyToggle(r));
    return `<div class="info-panel">${parts.join("")}</div>`;
  }

  function renderZonePicker(r) {
    const id = Number(r.plant_id);
    const buttons = report.zones.map((z) =>
      `<button type="button" class="zone-pick${r.zone_id === z.id ? " zone-pick--active" : ""}"
        data-action="zone-pick" data-plant="${id}" data-zone-id="${Number(z.id)}"
        aria-pressed="${r.zone_id === z.id}">${esc(z.name)}</button>`
    ).join("");
    return section(
      "Zone",
      `<div class="zone-picker">${buttons}</div>
       <form class="name-row zone-new" data-form="new-zone" data-plant="${id}">
         <input type="text" class="text-input" name="zone" maxlength="80" placeholder="New zone"
           aria-label="New zone name"/>
         <button type="submit" class="name-save-btn">Add</button>
       </form>`,
    );
  }

  function renderRangeEditor(r) {
    const id = Number(r.plant_id);
    const badge = r.custom_range ? `<span class="custom-badge">Custom</span>` : "";
    const reset = r.custom_range
      ? `<button type="button" class="link-btn reset-range-btn" data-action="range-reset" data-plant="${id}">
          Reset to the ${esc(r.species || "default")} range</button>`
      : "";
    return section(
      `Ideal range ${badge}`,
      `<div class="range-editor" data-plant="${id}">
        <div class="range-row">
          <label for="low-${id}">Low</label>
          <input id="low-${id}" type="range" min="5" max="80" value="${Number(r.ideal_low)}"
            class="range-input range-low"/>
          <span class="range-val range-low-val">${Number(r.ideal_low)}%</span>
        </div>
        <div class="range-row">
          <label for="high-${id}">High</label>
          <input id="high-${id}" type="range" min="20" max="95" value="${Number(r.ideal_high)}"
            class="range-input range-high"/>
          <span class="range-val range-high-val">${Number(r.ideal_high)}%</span>
        </div>
        ${reset}
      </div>`,
    );
  }

  function renderNotifyToggle(r) {
    const id = Number(r.plant_id);
    const mode = (report.user && report.user.prefs && report.user.prefs.notify_mode) || "off";
    const hint = mode === "off"
      ? `Alerts are off for all plants. Turn them on in <button type="button" class="link-btn"
          data-action="settings">Settings</button>.`
      : `Alerts when it becomes ${
        mode === "both" ? "too dry or too wet" : mode === "dry" ? "too dry" : "too wet"
      }, while the dashboard is open.`;
    return section(
      "Alerts for this plant",
      `<label class="notify-row">
        <span class="switch"><input type="checkbox" class="notify-toggle" data-plant="${id}"
          ${r.notify ? "checked" : ""}/><span class="slider-pill"></span></span>
        <span class="notify-state">${r.notify ? "On" : "Off"}</span>
      </label>
      <div class="notify-hint">${hint}</div>`,
    );
  }

  function renderReport() {
    const list = sections();
    if (zoneFilter !== "all" && !list.some((s) => s.key === zoneFilter)) zoneFilter = "all";
    let html = renderBanners() + renderHero() + renderFilterRow(list);
    for (const s of list) {
      if (zoneFilter !== "all" && zoneFilter !== s.key) continue;
      html += `<section class="zone" aria-label="${esc(s.name)}">
        <div class="zone-head">
          <h2>${esc(s.name)}</h2>
          <span class="zone-count">${plural(s.readings.length, "plant")}</span>
        </div>
        <div class="grid grid--${layoutMode}" data-zone="${esc(s.key)}">${
        s.readings.map(renderCard).join("")
      }</div>
      </section>`;
    }
    return html;
  }

  function renderSensors() {
    const byGateway = new Map();
    for (const r of report.readings) {
      if (!byGateway.has(r.gateway_id)) byGateway.set(r.gateway_id, []);
      byGateway.get(r.gateway_id).push(r);
    }
    let html = renderBanners() + `<div class="setup-intro fade-in">
      <strong>Sensor table.</strong> Every soil channel PlantWatch reads, by gateway. Compare it
      with the Ecowitt app to check which plant each channel belongs to.</div>`;
    for (const rows of byGateway.values()) {
      rows.sort((a, b) => a.channel - b.channel);
      html += `<div class="setup-zone fade-in">
        <h3>${esc(rows[0].gateway_name)}</h3>
        <table class="setup-table">
          <thead><tr><th>CH</th><th>Plant</th><th class="num">Moisture</th><th class="num">Battery</th>
            <th>Status</th></tr></thead>
          <tbody>${
        rows.map((r) =>
          `<tr>
            <td>CH${Number(r.channel)}</td>
            <td>${esc(r.name)}</td>
            <td class="num">${
            typeof r.moisture === "number" ? `${Math.round(r.moisture)}%` : "–"
          }</td>
            <td class="num">${
            typeof r.battery === "number" ? `${r.battery.toFixed(1)} V` : "–"
          }</td>
            <td>${esc(r.headline)}</td>
          </tr>`
        ).join("")
      }</tbody>
        </table>
      </div>`;
    }
    return html;
  }

  function render() {
    if (!report) return;
    $("main").innerHTML = view === "sensors" ? renderSensors() : renderReport();
    $("main").setAttribute("aria-busy", "false");
    $("meta").textContent = `Updated ${relTime(report.generated_at)}`;
    $("counts-meta").textContent = plural(report.readings.length, "sensor");
    $("toggle-view").textContent = view === "sensors" ? "Back to plants" : "Sensor table";
  }

  function showError(title, message) {
    $("meta").textContent = "Couldn't load the report.";
    $("main").innerHTML = `<div class="error-card fade-in" role="alert">
      <h3>${esc(title)}</h3><p>${esc(message)}</p></div>`;
    $("counts-meta").textContent = "";
  }

  // ── Loading ───────────────────────────────────────────────────────────

  let loading = false;

  async function load() {
    if (loading || !api) return;
    loading = true;
    const button = $("refresh");
    button.dataset.spinning = "true";
    button.disabled = true;
    if (!report) $("meta").textContent = "Fetching the latest readings…";
    try {
      const data = await api.getReport();
      if (data.needs_onboarding) {
        stopAutoRefresh();
        PW.authUi.showOnboarding({
          api,
          engine,
          onDone: () => {
            startAutoRefresh();
            load();
          },
        });
        return;
      }
      report = data;
      lastError = null;
      render();
      notifyIfChanged();
    } catch (err) {
      if (err instanceof PW.AuthError) return; // the signed-out handler shows the login screen
      if (report) {
        lastError = err.message;
        render();
      } else {
        showError("Couldn't load the report", err.message);
      }
    } finally {
      loading = false;
      button.dataset.spinning = "false";
      button.disabled = false;
    }
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    refreshTimer = setInterval(() => {
      if (!document.hidden) load();
    }, REFRESH_MS);
  }

  function stopAutoRefresh() {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && report && Date.now() - new Date(report.generated_at) > STALE_MS) {
      load();
    }
  });

  setInterval(() => {
    if (report) $("meta").textContent = `Updated ${relTime(report.generated_at)}`;
  }, 30_000);

  // ── Browser notifications (while the dashboard is open) ─────────────────

  function notifyIfChanged() {
    const prefs = (report.user && report.user.prefs) || {};
    const mode = prefs.notify_mode || "off";
    const offline = Boolean(prefs.notify_offline);
    let last = {};
    try {
      last = JSON.parse(storageGet("pw-last-status") || "{}");
    } catch {
      last = {};
    }
    const current = {};
    for (const r of report.readings) {
      current[r.plant_id] = r.status;
      const previous = last[r.plant_id];
      if (!r.notify || previous === undefined || previous === r.status) continue;
      if (typeof Notification === "undefined" || Notification.permission !== "granted") continue;
      const dry = (s) => s === "dry" || s === "very_dry";
      let title = null;
      let body = "";
      if (offline && r.status === "no_reading") {
        title = `${r.name} stopped reporting`;
        body = r.offline_cause || "Check the sensor's battery and range.";
      } else if ((mode === "dry" || mode === "both") && dry(r.status) && !dry(previous)) {
        title = `${r.name} needs water`;
        body = r.advice;
      } else if ((mode === "wet" || mode === "both") && r.status === "too_wet") {
        title = `${r.name} is too wet`;
        body = r.advice;
      }
      if (title) {
        try {
          new Notification(title, { body, tag: `plant-${r.plant_id}`, icon: "icon-192.png" });
        } catch {
          // Some browsers only allow notifications from a service worker.
        }
      }
    }
    storageSet("pw-last-status", JSON.stringify(current));
  }

  // ── Settings modal ────────────────────────────────────────────────────

  function openSettings() {
    if (!report) return;
    const prefs = (report.user && report.user.prefs) || {};
    const mode = prefs.notify_mode || "off";
    const permission = typeof Notification === "undefined"
      ? "Not supported in this browser"
      : { granted: "Allowed", denied: "Blocked in browser settings", default: "Not requested yet" }[
        Notification.permission
      ];
    const options = [
      ["off", "Off"],
      ["dry", "When a plant gets too dry"],
      ["wet", "When a plant gets too wet"],
      ["both", "Both"],
    ];
    const account = api.mode === "demo"
      ? `<div class="info-text">Demo mode: settings are kept in this tab only.</div>`
      : `<div class="account-row">
          <div class="account-email">${esc(api.email() || "")}</div>
          <button type="button" class="link-btn" data-signout>Sign out</button>
        </div>`;

    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.innerHTML =
      `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div class="modal-head">
        <h3 id="settings-title">Settings</h3>
        <button type="button" class="icon-btn modal-close" aria-label="Close">×</button>
      </div>
      <div class="modal-body">
        <div class="info-label">Alerts</div>
        ${
        options.map(([value, label]) =>
          `<label class="radio-row"><input type="radio" name="notify-mode" value="${value}"
          ${mode === value ? "checked" : ""}/><span>${label}</span></label>`
        ).join("")
      }
        <label class="radio-row radio-row--split">
          <span>Also when a sensor stops reporting</span>
          <span class="switch"><input type="checkbox" name="notify-offline" ${
        prefs.notify_offline ? "checked" : ""
      }/><span class="slider-pill"></span></span>
        </label>
        <div class="info-text muted">Alerts fire for plants with "Alerts for this plant" turned on,
          while the dashboard is open. Browser permission: ${esc(permission)}.</div>
        <div class="modal-divider"></div>
        ${account}
      </div>
    </div>`;
    document.body.appendChild(wrap);

    const close = () => wrap.remove();
    wrap.querySelector(".modal-close").addEventListener("click", close);
    wrap.addEventListener("click", (event) => {
      if (event.target === wrap) close();
    });
    wrap.addEventListener("keydown", (event) => {
      if (event.key === "Escape") close();
    });
    wrap.querySelector(".modal-close").focus();

    const savePrefs = (patch) => {
      report.user = report.user || { email: null, prefs: {} };
      Object.assign(report.user.prefs, patch);
      render();
      save(api.updatePrefs(patch), "your settings");
    };
    wrap.querySelectorAll('input[name="notify-mode"]').forEach((input) => {
      input.addEventListener("change", () => {
        if (input.value !== "off") requestPermission();
        savePrefs({ notify_mode: input.value });
      });
    });
    wrap.querySelector('input[name="notify-offline"]').addEventListener("change", (event) => {
      if (event.target.checked) requestPermission();
      savePrefs({ notify_offline: event.target.checked });
    });
    const signOut = wrap.querySelector("[data-signout]");
    if (signOut) {
      signOut.addEventListener("click", () => {
        close();
        api.signOut();
      });
    }
  }

  function requestPermission() {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }

  // ── Interaction (event delegation on #main) ─────────────────────────────

  function onClick(event) {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const plantId = target.dataset.plant;
    switch (target.dataset.action) {
      case "filter":
        zoneFilter = target.dataset.zone;
        render();
        break;
      case "layout":
        layoutMode = target.dataset.layout === "list" ? "list" : "grid";
        storageSet("pw-layout", layoutMode);
        render();
        break;
      case "info": {
        const id = Number(plantId);
        if (openInfo.has(id)) openInfo.delete(id);
        else openInfo.add(id);
        render();
        break;
      }
      case "zone-pick":
        updateZone(plantId, Number(target.dataset.zoneId));
        break;
      case "range-reset":
        updateRange(plantId, null, null);
        break;
      case "settings":
        openSettings();
        break;
      case "reconnect":
        PW.authUi.showReconnect({ api, onDone: load });
        break;
    }
  }

  function onSubmit(event) {
    const form = event.target.closest("form[data-form]");
    if (!form) return;
    event.preventDefault();
    const plantId = form.dataset.plant;
    if (form.dataset.form === "rename") {
      const name = form.elements.name.value.trim().slice(0, 80);
      const r = findReading(plantId);
      if (!name || !r || name === r.name) return;
      r.name = name;
      render();
      save(api.updatePlant(plantId, { name }), "the name");
    } else if (form.dataset.form === "new-zone") {
      addZone(plantId, form.elements.zone.value);
    }
  }

  function onRangeInput(event) {
    const editor = event.target.closest(".range-editor");
    if (!editor) return;
    const low = editor.querySelector(".range-low");
    const high = editor.querySelector(".range-high");
    if (Number(low.value) >= Number(high.value)) {
      if (event.target === low) low.value = Number(high.value) - 1;
      else high.value = Number(low.value) + 1;
    }
    editor.querySelector(".range-low-val").textContent = `${low.value}%`;
    editor.querySelector(".range-high-val").textContent = `${high.value}%`;
    if (event.type === "change") {
      updateRange(editor.dataset.plant, Number(low.value), Number(high.value));
    }
  }

  function onChange(event) {
    if (event.target.classList.contains("range-input")) return onRangeInput(event);
    if (event.target.classList.contains("notify-toggle")) {
      const on = event.target.checked;
      const r = findReading(event.target.dataset.plant);
      if (!r) return;
      if (on) requestPermission();
      r.notify = on;
      render();
      save(api.updatePlant(r.plant_id, { notify: on }), "the alert setting");
    }
  }

  // ── Drag to reorder, or to move a plant to another zone ───────────────────

  let drag = null;

  function startDrag(event) {
    const handle = event.target.closest(".drag-handle");
    if (!handle || event.button > 0) return;
    const card = handle.closest(".card");
    event.preventDefault();
    drag = { card, from: card.parentElement, next: card.nextElementSibling };
    card.classList.add("dragging");
    document.body.classList.add("reordering");
    // Listen on the document, not the handle: moving the card re-parents the
    // handle, which would release pointer capture and strand the drag.
    document.addEventListener("pointermove", onDragMove);
    document.addEventListener("pointerup", endDrag);
    document.addEventListener("pointercancel", endDrag);
  }

  function onDragMove(event) {
    if (!drag) return;
    event.preventDefault();
    const under = document.elementFromPoint(event.clientX, event.clientY);
    if (!under) return;
    const target = under.closest(".card");
    if (target && target !== drag.card && target.parentElement.classList.contains("grid")) {
      const rect = target.getBoundingClientRect();
      const after = event.clientY - rect.top > rect.height / 2;
      target.parentElement.insertBefore(drag.card, after ? target.nextSibling : target);
    } else {
      const grid = under.closest(".grid");
      if (grid && drag.card.parentElement !== grid) grid.appendChild(drag.card);
    }
  }

  function endDrag() {
    document.removeEventListener("pointermove", onDragMove);
    document.removeEventListener("pointerup", endDrag);
    document.removeEventListener("pointercancel", endDrag);
    if (!drag) return;
    const { card, from, next } = drag;
    drag = null;
    card.classList.remove("dragging");
    document.body.classList.remove("reordering");
    if (card.parentElement === from && card.nextElementSibling === next) return; // not moved
    persistOrder(card);
  }

  /** Saves the order of the grid a card is in (and its zone, if it changed grids). */
  function persistOrder(card) {
    const grid = card.parentElement;
    const plantId = Number(card.dataset.plant);
    const key = grid.dataset.zone;
    const zoneId = key === "none" ? null : Number(key.slice(1));
    const ids = [...grid.querySelectorAll(".card")].map((c) => Number(c.dataset.plant));
    const r = findReading(plantId);
    if (r && r.zone_id !== zoneId) updateZone(plantId, zoneId);
    ids.forEach((id, index) => {
      const reading = findReading(id);
      if (reading) reading.display_order = index + 1;
    });
    render();
    save(api.setPlantOrder(ids), "the new order");
  }

  /** Arrow keys on a focused drag handle move the card within its zone. */
  function onHandleKey(event) {
    const handle = event.target.closest(".drag-handle");
    if (!handle || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    const card = handle.closest(".card");
    const sibling = event.key === "ArrowUp" ? card.previousElementSibling : card.nextElementSibling;
    if (!sibling) return;
    card.parentElement.insertBefore(card, event.key === "ArrowUp" ? sibling : sibling.nextSibling);
    const plantId = card.dataset.plant;
    persistOrder(card);
    const moved = document.querySelector(`.card[data-plant="${Number(plantId)}"] .drag-handle`);
    if (moved) moved.focus();
  }

  // ── Boot ──────────────────────────────────────────────────────────────

  function isConfigured(cfg) {
    return Boolean(
      cfg && /^https?:\/\//.test(cfg.supabaseUrl || "") && cfg.supabaseAnonKey &&
        !/YOUR-/.test(`${cfg.supabaseUrl} ${cfg.supabaseAnonKey}`),
    );
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Couldn't load ${src}`));
      document.head.appendChild(script);
    });
  }

  function showDemoBanner(configured) {
    const banner = $("demo-banner");
    const exit = configured
      ? `<a class="link-btn" href="./">Sign in to your garden</a>`
      : `See the README to connect real sensors.`;
    banner.innerHTML = `<strong>Demo mode:</strong> a fictional garden, evaluated by the real
      advice engine. Edits stay in this tab. ${exit}`;
    banner.hidden = false;
  }

  function wireUi() {
    const main = $("main");
    main.addEventListener("click", onClick);
    main.addEventListener("submit", onSubmit);
    main.addEventListener("input", (event) => {
      if (event.target.classList.contains("range-input")) onRangeInput(event);
    });
    main.addEventListener("change", onChange);
    main.addEventListener("pointerdown", startDrag);
    $("refresh").addEventListener("click", () => load());
    $("settings").addEventListener("click", openSettings);
    $("toggle-view").addEventListener("click", () => {
      view = view === "sensors" ? "report" : "sensors";
      render();
    });
    main.addEventListener("keydown", onHandleKey);
  }

  async function boot() {
    if (!engine) {
      showError("Missing file", "js/engine.js did not load. Run `deno task build:web`.");
      return;
    }
    wireUi();
    const cfg = window.PLANTWATCH_CONFIG;
    const params = new URLSearchParams(location.search);
    const configured = isConfigured(cfg);

    if (!configured || params.has("demo")) {
      try {
        await loadScript("js/demo-fixture.js");
      } catch (err) {
        showError("Couldn't start demo mode", err.message);
        return;
      }
      api = PW.createDemoApi(window.PLANTWATCH_DEMO, engine, { scenario: params.get("demo") });
      showDemoBanner(configured);
      await load();
      return;
    }

    const supabase = PW.createSupabase(cfg);
    api = PW.createLiveApi(supabase);
    const start = () => {
      load();
      startAutoRefresh();
    };
    supabase.onSignedOut(() => {
      report = null;
      stopAutoRefresh();
      PW.authUi.showLogin({ supabase, onSignedIn: start });
    });
    if (supabase.hasSession()) start();
    else PW.authUi.showLogin({ supabase, onSignedIn: start });
  }

  boot();
})();
