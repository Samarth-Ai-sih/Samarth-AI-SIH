import { defineConfig, devices } from "@playwright/test";

/**
 * Phase 17 API-driven browser contract. Mutating workflow tests are opt-in so
 * credentials, work IDs, and production data never enter the repository.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:8000",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
});
