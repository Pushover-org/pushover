import { existsSync } from "node:fs";
import type { NextConfig } from "next";

// One secrets file at the repo root (docs/architecture.md → Environment variables in a monorepo).
const rootEnv = new URL("../../.env.local", import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

// The workspace packages ship TypeScript source (exports → src/index.ts), so Next compiles them.
const config: NextConfig = {
  transpilePackages: ["@proofofclaim/checks", "@proofofclaim/claims", "@proofofclaim/db", "@proofofclaim/desk", "@proofofclaim/distribute", "@proofofclaim/examiner", "@proofofclaim/ledger", "@proofofclaim/paypal"],
  serverExternalPackages: ["sharp", "pg"],
  poweredByHeader: false,
};
export default config;
