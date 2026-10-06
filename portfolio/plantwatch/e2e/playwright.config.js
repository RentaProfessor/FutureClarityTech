import { defineConfig, devices } from "@playwright/test";

// Serves web/ as-is (no config.js, so the app can start in demo mode) and runs
// the specs in tests/ against it. Live-mode specs inject a config and mock the
// Supabase API with page.route(), so no backend or secrets are needed.
export default defineConfig({
  testDir: "tests",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:8765",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "python3 -m http.server 8765 --bind 127.0.0.1 --directory ../web",
    url: "http://127.0.0.1:8765/",
    reuseExistingServer: !process.env.CI,
  },
});
