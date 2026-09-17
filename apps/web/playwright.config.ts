import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.WEB_TEST_PORT ?? 3100);

export default defineConfig({
  testDir: "./test/browser",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  reporter: [["list"], ["html", { open: "never" }]],
  outputDir: "test-results",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node scripts/start-standalone.mjs",
    cwd: ".",
    url: `http://127.0.0.1:${port}/login`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      NEXT_PUBLIC_API_BASE_URL: `http://127.0.0.1:${port}/api/v1`,
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
    },
  },
});
