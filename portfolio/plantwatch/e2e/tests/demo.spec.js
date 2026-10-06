// Demo mode: no config.js, so the app runs on fixture data evaluated by the
// real advice engine. Covers rendering, editing, reordering and escaping.

import { expect, test } from "@playwright/test";

const card = (page, name) =>
  page.locator(".card", { has: page.locator(".card-name", { hasText: name }) });

async function setSlider(slider, value) {
  await slider.evaluate((el, v) => {
    el.value = String(v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

let pageErrors = [];

test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await page.goto("/");
  await expect(page.locator(".card")).toHaveCount(12);
});

test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

test("labels demo mode and renders computed statuses", async ({ page }) => {
  await expect(page.locator("#demo-banner")).toBeVisible();
  await expect(page.locator("#demo-banner")).toContainText("fictional garden");
  await expect(page.locator(".h-title")).toHaveText("2 plants need water");
  await expect(page.locator(".zone-head h2")).toHaveText([
    "Orchard",
    "Kitchen garden",
    "Front border",
  ]);
  await expect(card(page, "Mandarin")).toHaveAttribute(
    "data-status",
    "dry_rain_coming",
  );
  await expect(card(page, "Avocado")).toHaveAttribute(
    "data-status",
    "very_dry",
  );
  await expect(card(page, "Herb planter")).toHaveAttribute(
    "data-status",
    "too_wet",
  );
  await expect(card(page, "Boxwood hedge")).toHaveAttribute(
    "data-status",
    "no_reading",
  );
  await expect(card(page, "Boxwood hedge").locator(".last-seen")).toContainText(
    "6 hours ago",
  );
});

test("editing a range re-evaluates the plant immediately", async ({ page }) => {
  const lemon = card(page, "Lemon tree");
  await lemon.locator(".info-btn").click();
  await setSlider(lemon.locator(".range-high"), 75);
  await setSlider(card(page, "Lemon tree").locator(".range-low"), 60);
  await expect(card(page, "Lemon tree")).toHaveAttribute(
    "data-status",
    "very_dry",
  );
  await expect(card(page, "Lemon tree").locator(".advice")).toContainText(
    "13 points below the 60% floor",
  );
  await expect(page.locator(".h-title")).toHaveText("3 plants need water");

  await card(page, "Lemon tree").locator("[data-action=range-reset]").click();
  await expect(card(page, "Lemon tree")).toHaveAttribute("data-status", "good");
  await expect(card(page, "Lemon tree").locator(".moisture-range")).toHaveText(
    "Ideal 35–55%",
  );
});

test("plant names are rendered as text, not HTML", async ({ page }) => {
  let dialog = false;
  page.on("dialog", (d) => {
    dialog = true;
    return d.dismiss();
  });
  const payload = '<img src=x onerror="alert(1)">Fig';
  const lemon = card(page, "Lemon tree");
  await lemon.locator(".info-btn").click();
  await lemon.locator("form[data-form=rename] input").fill(payload);
  await lemon.locator("form[data-form=rename] button").click();
  await expect(card(page, payload)).toHaveCount(1);
  await expect(page.locator("img[src=x]")).toHaveCount(0);
  expect(dialog).toBe(false);
});

test("plants move between zones, including new ones", async ({ page }) => {
  const rosemary = card(page, "Rosemary");
  await rosemary.locator(".info-btn").click();
  await rosemary.locator("[data-action=zone-pick]", { hasText: "Front border" })
    .click();
  await expect(page.locator('.grid[data-zone="z3"] .card-name')).toContainText([
    "Rosemary",
  ]);

  await card(page, "Rosemary").locator("form[data-form=new-zone] input").fill(
    "Patio pots",
  );
  await card(page, "Rosemary").locator("form[data-form=new-zone] button")
    .click();
  await expect(page.locator(".zone-head h2")).toContainText(["Patio pots"]);

  await page.click("#refresh");
  await expect(page.locator(".zone-head h2")).toContainText(["Patio pots"]);
});

test("cards reorder with the arrow keys and by dragging", async ({ page }) => {
  const orchard = page.locator('.grid[data-zone="z1"] .card-name');
  await expect(orchard).toHaveText([
    "Lemon tree",
    "Mandarin",
    "Avocado",
    "Bay laurel",
  ]);
  await page.locator('.grid[data-zone="z1"] .card').first().locator(
    ".drag-handle",
  ).focus();
  await page.keyboard.press("ArrowDown");
  await expect(orchard).toHaveText([
    "Mandarin",
    "Lemon tree",
    "Avocado",
    "Bay laurel",
  ]);

  await page.setViewportSize({ width: 1280, height: 1400 }); // keep both cards on screen
  const from = await card(page, "Avocado").locator(".drag-handle")
    .boundingBox();
  const to = await page.locator('.grid[data-zone="z2"] .card').first()
    .boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + 10, { steps: 8 });
  await page.mouse.up();
  const kitchen = page.locator('.grid[data-zone="z2"] .card-name');
  await expect(kitchen).toHaveText([
    "Avocado",
    "Tomato bed",
    "Herb planter",
    "Rosemary",
  ]);
  await page.click("#refresh");
  await expect(kitchen).toHaveText([
    "Avocado",
    "Tomato bed",
    "Herb planter",
    "Rosemary",
  ]);
});

test("filters, list layout and the sensor table", async ({ page }) => {
  await page.locator(".filter-chip", { hasText: "Orchard" }).click();
  await expect(page.locator(".zone")).toHaveCount(1);
  await page.locator(".filter-chip", { hasText: "All" }).click();
  await page.locator("[data-action=layout][data-layout=list]").click();
  await expect(page.locator(".grid--list")).toHaveCount(3);
  await page.click("#toggle-view");
  await expect(page.locator(".setup-table")).toHaveCount(2);
  await expect(page.locator(".setup-zone h3")).toHaveText([
    "Garden hub",
    "Front hub",
  ]);
});

test("a rejected Ecowitt key is reported as such, not as dead sensors", async ({ page }) => {
  await page.goto("/?demo=api-error");
  await expect(page.locator(".banner--error")).toContainText(
    "Ecowitt rejected the saved API keys",
  );
  await expect(card(page, "Hydrangea").locator(".badge")).toHaveText("No data");
  await expect(card(page, "Hydrangea").locator(".advice")).toContainText(
    "The sensors are probably fine",
  );
});

test("makes no requests to third parties", async ({ page }) => {
  const origins = new Set();
  page.on("request", (r) => origins.add(new URL(r.url()).origin));
  await page.reload();
  await expect(page.locator(".card")).toHaveCount(12);
  expect([...origins]).toEqual(["http://127.0.0.1:8765"]);
});
