import type { NextConfig } from "next";

// The workspace packages ship TypeScript source (exports → src/index.ts), so Next compiles them.
const config: NextConfig = {
  transpilePackages: ["@pushover/checks", "@pushover/claims", "@pushover/db", "@pushover/distribute", "@pushover/examiner", "@pushover/paypal"],
  serverExternalPackages: ["sharp", "pg"],
  poweredByHeader: false,
};
export default config;
