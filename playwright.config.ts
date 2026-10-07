import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  use: {
    baseURL: "http://127.0.0.1:8001",
    trace: "retain-on-failure",
    launchOptions: process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"]
      ? {
          executablePath: process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"],
          args: ["--no-sandbox"],
        }
      : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 812 } },
    },
  ],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 8001",
    url: "http://127.0.0.1:8001",
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: "https://example.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
      VITE_API_URL: "http://127.0.0.1:8000",
    },
  },
});
