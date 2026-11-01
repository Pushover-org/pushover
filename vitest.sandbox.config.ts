import { defineConfig } from "vitest/config";

// Tests that move sandbox money. Run on demand (`pnpm test:sandbox`), never in `pnpm test`.
export default defineConfig({
  test: {
    include: ["packages/*/sandbox/**/*.sandbox.ts"],
    testTimeout: 180_000,
    fileParallelism: false,
  },
});
