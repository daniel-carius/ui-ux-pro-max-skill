import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3000);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;

/** E2E sempre em viewport mobile 390x844 (SPEC 2). */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "mobile-chromium",
      use: {
        ...devices["iPhone 14"],
        browserName: "chromium",
        defaultBrowserType: "chromium",
        viewport: { width: 390, height: 844 },
      },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: process.env.CI ? `pnpm start --port ${port}` : `pnpm dev --port ${port}`,
        url: `${baseURL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
