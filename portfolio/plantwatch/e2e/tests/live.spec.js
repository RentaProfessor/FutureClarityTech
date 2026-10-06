// Live mode against a mocked Supabase API: sign-in, onboarding through the
// complete_onboarding RPC, settings saved with the user's JWT, and the session
// rules (stay signed in through outages, sign out when the refresh token is
// rejected).

import { expect, test } from "@playwright/test";
import { mockSupabase, signedIn } from "./mock-supabase.js";

const card = (page, name) =>
  page.locator(".card", { has: page.locator(".card-name", { hasText: name }) });

test("sign-in, then onboarding saves everything in one RPC", async ({ page }) => {
  const api = await mockSupabase(page);
  await page.goto("/");
  await expect(page.locator(".app")).toBeHidden();
  await page.fill('input[name="email"]', "gardener@example.com");
  await page.fill('input[name="password"]', "correct horse battery");
  await page.click(".auth-submit");

  // Rejected keys are explained, then accepted keys list the sensors.
  await page.fill('input[name="appKey"]', "APP");
  await page.fill('input[name="apiKey"]', "BAD");
  await page.click(".auth-submit");
  await expect(page.locator(".auth-error")).toContainText(
    "Ecowitt rejected these keys",
  );
  await page.fill('input[name="apiKey"]', "GOOD");
  await page.click(".auth-submit");

  const rows = page.locator(".ob-ch");
  await expect(rows).toHaveCount(2);
  await expect(page.locator(".ob-zone").first()).toHaveValue("Garden"); // not the gateway name
  await rows.nth(0).locator(".ob-name").fill("Lemon tree");
  await rows.nth(0).locator(".ob-species").selectOption("citrus");
  await rows.nth(1).locator(".ob-zone").fill("Patio");
  await page.click("[data-finish]");

  await expect(page.locator(".zone-head h2")).toHaveText(["Garden", "Patio"]);
  const rpc = api.calls.filter((c) => c.path === "/rest/v1/rpc/complete_onboarding");
  expect(rpc).toHaveLength(1);
  expect(rpc[0].authorization).toBe("Bearer jwt-1");
  expect(rpc[0].body.p_gateways[0]).toMatchObject({
    mac: "00:00:5E:00:53:01",
    timezone: "Europe/London",
  });
  expect(rpc[0].body.p_plants).toEqual([
    {
      mac: "00:00:5E:00:53:01",
      channel: 1,
      name: "Lemon tree",
      species: "citrus",
      zone: "Garden",
    },
    {
      mac: "00:00:5E:00:53:01",
      channel: 2,
      name: "",
      species: "unknown",
      zone: "Patio",
    },
  ]);
  const separateWrites = api.calls.filter((c) =>
    /^\/rest\/v1\/(zones|gateways|profiles)/.test(c.path)
  );
  expect(separateWrites).toEqual([]);
});

test("plant settings and preferences are saved with the user's JWT", async ({ page }) => {
  const api = await mockSupabase(page, { onboarded: true });
  await signedIn(page);
  await page.goto("/");
  const lemon = card(page, "Lemon tree");
  await lemon.locator(".info-btn").click();
  await lemon.locator(".range-low").evaluate((el) => {
    el.value = "30";
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await card(page, "Lemon tree").locator(".notify-row").click();
  await card(page, "Lemon tree").locator("form[data-form=new-zone] input").fill(
    "Patio",
  );
  await card(page, "Lemon tree").locator("form[data-form=new-zone] button")
    .click();
  await expect(page.locator(".zone-head h2")).toHaveText(["Orchard", "Patio"]);

  await page.click("#settings");
  await page.locator('input[name="notify-mode"][value="dry"]').check();
  await page.keyboard.press("Escape");

  await expect.poll(() => api.prefs.notify_mode).toBe("dry");
  const writes = api.calls.filter((c) => c.method !== "GET" && c.path.startsWith("/rest/v1/"));
  expect(writes.map((c) => [c.method, c.path + c.search, c.body])).toEqual([
    ["PATCH", "/rest/v1/plants?id=eq.100", { ideal_low: 30, ideal_high: 55 }],
    ["PATCH", "/rest/v1/plants?id=eq.100", { notify: true }],
    ["POST", "/rest/v1/zones?select=id,name,sort", {
      user_id: "user-a",
      name: "Patio",
      sort: 1,
    }],
    ["PATCH", "/rest/v1/plants?id=eq.100", { zone_id: 2 }],
    [
      "PATCH",
      "/rest/v1/user_prefs?user_id=eq.user-a",
      expect.objectContaining({ notify_mode: "dry" }),
    ],
  ]);
  for (const call of writes) {
    expect(call.authorization).toBe("Bearer jwt-1");
    expect(call.apikey).toBe("anon-key");
  }
});

test("an outage during token refresh keeps the user signed in", async ({ page }) => {
  const api = await mockSupabase(page, { onboarded: true });
  api.refresh = "unavailable";
  await signedIn(page, { expired: true });
  await page.goto("/");
  await expect(page.locator(".error-card")).toContainText(
    "server is unavailable",
  );
  await expect(page.locator("#pw-auth-overlay")).toHaveCount(0);

  api.refresh = "ok";
  await page.click("#refresh");
  await expect(page.locator(".card")).toHaveCount(2);
  expect(api.calls.at(-1).authorization).toBe("Bearer jwt-2");
});

test("a rejected refresh token signs the user out", async ({ page }) => {
  const api = await mockSupabase(page, { onboarded: true });
  api.refresh = "rejected";
  await signedIn(page, { expired: true });
  await page.goto("/");
  await expect(page.locator("#pw-auth-overlay .auth-card")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("pw-session")))
    .toBeNull();
});

test("a 401 refreshes the token once and retries", async ({ page }) => {
  const api = await mockSupabase(page, {
    onboarded: true,
    reportUnauthorizedOnce: true,
  });
  await signedIn(page);
  await page.goto("/");
  await expect(page.locator(".card")).toHaveCount(2);
  const sequence = api.calls.map((c) => `${c.method} ${c.path} ${c.authorization ?? ""}`.trim());
  expect(sequence.slice(0, 3)).toEqual([
    "GET /functions/v1/report-v2 Bearer jwt-1",
    "POST /auth/v1/token",
    "GET /functions/v1/report-v2 Bearer jwt-2",
  ]);
});

test("rejected Ecowitt keys can be replaced from the banner", async ({ page }) => {
  await mockSupabase(page, {
    onboarded: true,
    gatewayError: {
      kind: "auth",
      message: "Illegal Api_Key Parameter",
      code: 40011,
    },
  });
  await signedIn(page);
  await page.goto("/");
  await expect(card(page, "Lemon tree").locator(".badge")).toHaveText(
    "No data",
  );
  await page.click(".banner [data-action=reconnect]");
  await page.fill('input[name="appKey"]', "APP");
  await page.fill('input[name="apiKey"]', "GOOD");
  await page.click(".auth-submit");
  await expect(page.locator(".banner--error")).toHaveCount(0);
  await expect(card(page, "Lemon tree")).toHaveAttribute("data-status", "dry");
});
