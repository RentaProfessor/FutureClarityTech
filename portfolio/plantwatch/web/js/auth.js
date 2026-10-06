/* PlantWatch: sign-in, onboarding and "update Ecowitt keys" screens.
 * Rendered into a full-screen overlay; the dashboard stays hidden underneath. */
(function () {
  "use strict";
  const PW = (window.PW = window.PW || {});

  const esc = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]);

  const BRAND_MARK = `<span class="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2a7 7 0 0 0-7 7c0 3.5 2.5 6 7 13 4.5-7 7-9.5 7-13a7 7 0 0 0-7-7z"/><path d="M12 11v11"/>
      </svg>
    </span>`;

  const DEFAULT_ZONE = "Garden";
  const ZONE_SUGGESTIONS = ["Garden", "Back garden", "Front garden", "Patio", "Greenhouse"];

  function overlay() {
    let el = document.getElementById("pw-auth-overlay");
    if (!el) {
      el = document.createElement("div");
      el.id = "pw-auth-overlay";
      document.body.appendChild(el);
    }
    showApp(false);
    return el;
  }

  function close() {
    const el = document.getElementById("pw-auth-overlay");
    if (el) el.remove();
    showApp(true);
  }

  function showApp(show) {
    const app = document.querySelector(".app");
    if (app) app.hidden = !show;
  }

  function setError(el, message) {
    const box = el.querySelector(".auth-error");
    box.textContent = message || "";
    box.hidden = !message;
  }

  function setBusy(button, busy, label) {
    button.disabled = busy;
    button.textContent = label;
  }

  // ── Sign in / create account ──────────────────────────────────────────

  function showLogin({ supabase, onSignedIn }) {
    const el = overlay();
    let mode = "signin";

    const draw = (notice) => {
      const signingIn = mode === "signin";
      el.innerHTML = `
        <div class="auth-card">
          <div class="auth-brand">${BRAND_MARK}<h1>PlantWatch</h1></div>
          <p class="auth-sub">${signingIn ? "Sign in to your garden" : "Create your account"}</p>
          <form class="auth-form" novalidate>
            <label class="auth-field"><span>Email</span>
              <input type="email" name="email" autocomplete="email" inputmode="email" required
                placeholder="you@example.com"/></label>
            <label class="auth-field"><span>Password</span>
              <input type="password" name="password" required minlength="6" placeholder="At least 6 characters"
                autocomplete="${signingIn ? "current-password" : "new-password"}"/></label>
            <div class="auth-error" role="alert" hidden></div>
            <button type="submit" class="auth-submit">${
        signingIn ? "Sign in" : "Create account"
      }</button>
          </form>
          <div class="auth-toggle">
            ${signingIn ? "New here?" : "Already have an account?"}
            <button type="button" class="link-btn" data-switch>${
        signingIn ? "Create an account" : "Sign in"
      }</button>
          </div>
          <div class="auth-toggle"><a class="link-btn" href="?demo">Try the demo</a></div>
        </div>`;
      if (notice) setError(el, notice);

      el.querySelector("[data-switch]").addEventListener("click", () => {
        mode = signingIn ? "signup" : "signin";
        draw();
      });

      const form = el.querySelector("form");
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = form.querySelector(".auth-submit");
        const email = form.email.value.trim();
        const password = form.password.value;
        if (!email || password.length < 6) {
          setError(el, "Enter your email and a password of at least 6 characters.");
          return;
        }
        setError(el, "");
        setBusy(button, true, signingIn ? "Signing in…" : "Creating account…");
        try {
          if (signingIn) {
            await supabase.signIn(email, password);
          } else if (!(await supabase.signUp(email, password))) {
            mode = "signin";
            draw("Check your email to confirm your account, then sign in.");
            return;
          }
          close();
          onSignedIn();
        } catch (err) {
          setError(el, err.message || "Something went wrong.");
          setBusy(button, false, signingIn ? "Sign in" : "Create account");
        }
      });
    };

    draw();
  }

  // ── Ecowitt keys form (shared by onboarding and "update keys") ───────────

  function keysForm({ title, intro, submitLabel, secondary }) {
    return `
      <div class="auth-card onboard-card">
        <div class="auth-brand"><h1>${esc(title)}</h1></div>
        <p class="auth-sub">${esc(intro)}</p>
        <form class="auth-form">
          <label class="auth-field"><span>Application Key</span>
            <input type="text" name="appKey" required autocomplete="off" spellcheck="false"
              placeholder="Ecowitt Application Key"/></label>
          <label class="auth-field"><span>API Key</span>
            <input type="text" name="apiKey" required autocomplete="off" spellcheck="false"
              placeholder="Ecowitt API Key"/></label>
          <div class="auth-error" role="alert" hidden></div>
          <button type="submit" class="auth-submit">${esc(submitLabel)}</button>
        </form>
        <div class="auth-toggle">${secondary}</div>
      </div>`;
  }

  async function submitKeys(el, api, busyLabel, idleLabel) {
    const form = el.querySelector("form");
    const button = form.querySelector(".auth-submit");
    const appKey = form.appKey.value.trim();
    const apiKey = form.apiKey.value.trim();
    if (!appKey || !apiKey) {
      setError(el, "Both keys are required.");
      return null;
    }
    setError(el, "");
    setBusy(button, true, busyLabel);
    try {
      return await api.discoverDevices(appKey, apiKey);
    } catch (err) {
      setError(el, err.message || "Couldn't reach Ecowitt.");
      setBusy(button, false, idleLabel);
      return null;
    }
  }

  // ── Onboarding: keys → name each sensor → one atomic save ────────────────

  function showOnboarding({ api, engine, onDone }) {
    const el = overlay();
    const species = engine.SPECIES_PROFILES;
    let discovered = [];

    const signOut = async () => {
      await api.signOut();
      location.reload();
    };

    const connectStep = () => {
      el.innerHTML = keysForm({
        title: "Set up your garden",
        intro: "Enter the Application Key and API Key from your ecowitt.net account. " +
          "PlantWatch uses them to find your gateways and soil sensors.",
        submitLabel: "Find my sensors",
        secondary: `<button type="button" class="link-btn" data-signout>Sign out</button>`,
      });
      el.querySelector("[data-signout]").addEventListener("click", signOut);
      el.querySelector("form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const result = await submitKeys(el, api, "Connecting…", "Find my sensors");
        if (!result) return;
        discovered = result.gateways || [];
        if (!discovered.some((g) => g.channels.length)) {
          setError(el, "No soil sensors are reporting on that Ecowitt account yet.");
          setBusy(el.querySelector(".auth-submit"), false, "Find my sensors");
          return;
        }
        organizeStep();
      });
    };

    const organizeStep = () => {
      const options = species
        .map((s) =>
          `<option value="${esc(s.key)}"${s.key === "unknown" ? " selected" : ""}>${
            esc(s.label)
          }</option>`
        )
        .join("");
      const sections = discovered.map((g) => {
        const rows = g.channels.map((c) => `
          <div class="ob-ch" data-mac="${esc(g.mac)}" data-channel="${Number(c.channel)}">
            <div class="ob-ch-id">CH${Number(c.channel)} · ${
          c.moisture == null ? "–" : Math.round(c.moisture)
        }%</div>
            <input class="ob-name text-input" maxlength="80" placeholder="Plant name (e.g. Lemon tree)"
              aria-label="Plant name for channel ${Number(c.channel)}"/>
            <select class="ob-species select-input" aria-label="Plant type">${options}</select>
            <input class="ob-zone text-input" list="ob-zones" maxlength="80" value="${DEFAULT_ZONE}"
              aria-label="Zone"/>
          </div>`).join("");
        return `<div class="ob-gw">
          <div class="ob-gw-head">${esc(g.name)} <span class="ch-tag">${g.channels.length} sensor${
          g.channels.length === 1 ? "" : "s"
        }</span></div>
          ${g.error ? `<div class="info-text">${esc(g.error)}</div>` : ""}
          ${rows || `<div class="info-text">No soil sensors are reporting on this gateway.</div>`}
        </div>`;
      }).join("");

      el.innerHTML = `
        <div class="auth-card onboard-card onboard-wide">
          <div class="auth-brand"><h1>Name your sensors</h1></div>
          <p class="auth-sub">Give each sensor the plant it sits next to, its type, and a zone.
            You can change all of this later.</p>
          <datalist id="ob-zones"></datalist>
          <div class="ob-list">${sections}</div>
          <div class="auth-error" role="alert" hidden></div>
          <button type="button" class="auth-submit" data-finish>Finish setup</button>
          <div class="auth-toggle">
            <button type="button" class="link-btn" data-back>Back</button> ·
            <button type="button" class="link-btn" data-signout>Sign out</button>
          </div>
        </div>`;

      const datalist = el.querySelector("#ob-zones");
      const refreshZoneSuggestions = () => {
        const typed = [...el.querySelectorAll(".ob-zone")].map((i) => i.value.trim());
        const names = [...new Set([...typed, ...ZONE_SUGGESTIONS].filter(Boolean))];
        datalist.innerHTML = names.map((n) => `<option value="${esc(n)}"></option>`).join("");
      };
      refreshZoneSuggestions();
      el.querySelector(".ob-list").addEventListener("change", refreshZoneSuggestions);
      el.querySelector("[data-back]").addEventListener("click", connectStep);
      el.querySelector("[data-signout]").addEventListener("click", signOut);

      el.querySelector("[data-finish]").addEventListener("click", async (event) => {
        const button = event.currentTarget;
        const gateways = discovered.map((g) => ({
          mac: g.mac,
          name: g.name,
          station_type: g.station_type,
          latitude: g.latitude,
          longitude: g.longitude,
          timezone: g.timezone,
        }));
        const plants = [...el.querySelectorAll(".ob-ch")].map((row) => ({
          mac: row.dataset.mac,
          channel: Number(row.dataset.channel),
          name: row.querySelector(".ob-name").value.trim(),
          species: row.querySelector(".ob-species").value,
          zone: row.querySelector(".ob-zone").value.trim() || DEFAULT_ZONE,
        }));
        setError(el, "");
        setBusy(button, true, "Saving…");
        try {
          await api.completeOnboarding(gateways, plants);
          close();
          onDone();
        } catch (err) {
          setError(el, err.message || "Couldn't save your garden.");
          setBusy(button, false, "Finish setup");
        }
      });
    };

    connectStep();
  }

  // ── Replace rejected Ecowitt keys ──────────────────────────────────────

  function showReconnect({ api, onDone }) {
    const el = overlay();
    el.innerHTML = keysForm({
      title: "Update Ecowitt keys",
      intro: "Ecowitt rejected the saved keys. Enter a current Application Key and API Key " +
        "from your ecowitt.net account.",
      submitLabel: "Save keys",
      secondary: `<button type="button" class="link-btn" data-cancel>Cancel</button>`,
    });
    el.querySelector("[data-cancel]").addEventListener("click", close);
    el.querySelector("form").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (await submitKeys(el, api, "Checking…", "Save keys")) {
        close();
        onDone();
      }
    });
  }

  PW.authUi = { showLogin, showOnboarding, showReconnect, close };
})();
