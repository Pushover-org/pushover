import { defineConfig } from "@playwright/test";
import { E2E, serverEnv } from "./apps/web/e2e/env.ts";

// End-to-end tests (spec R10): the real app on its own database (proofofclaim_e2e, recreated
// each run), a fake PayPal on localhost and no examiner, so a run costs nothing and sends nothing.
// The tests share one database and run in order.
export default defineConfig({
  testDir: "apps/web/e2e",
  forbidOnly: !!process.env["CI"],
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: process.env["CI"] ? "github" : "list",
  globalSetup: "./apps/web/e2e/global-setup.ts",
  use: { baseURL: E2E.baseURL, trace: "retain-on-failure" },
  webServer: {
    // A production build, as deployed (and next dev allows one dev server per app directory).
    command: `pnpm --filter @proofofclaim/web exec next build && pnpm --filter @proofofclaim/web exec next start -p ${E2E.port}`,
    url: `${E2E.baseURL}/login`,
    reuseExistingServer: false,
    timeout: 400_000,
    env: serverEnv,
  },
});
