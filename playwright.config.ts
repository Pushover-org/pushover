import { defineConfig } from "@playwright/test";

// E2E specs live in apps/web/e2e (spec §7.3). The web server and fake PayPal
// server are wired in when apps/web exists (§9 step 10).
export default defineConfig({
  testDir: "apps/web/e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
});
