import { configDefaults, defineConfig } from "vitest/config";

// Unit tests only. apps/web/e2e holds Playwright specs, which `pnpm e2e` runs (playwright.config.ts).
export default defineConfig({
  test: {
    name: "@proofofclaim/web",
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
