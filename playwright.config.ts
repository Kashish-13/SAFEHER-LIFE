import { defineConfig } from "@playwright/test";

/**
 * Browser tests run against an already-running SafeHer server in DEMO mode
 * (fictional personas, simulated alerts only). See docs/TESTING.md.
 *   E2E_BASE_URL defaults to http://localhost:3100
 * Files run in order (01-pages, then 02-flows) because flows mutate demo data.
 */
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["json", { outputFile: "gate-a/playwright-results.json" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  outputDir: "test-results",
});
