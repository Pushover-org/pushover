// The e2e run's own world: its own database, a fake PayPal on localhost, no examiner (so no API
// spend and no network), and fixed throwaway secrets. Nothing here touches dev data or real PayPal.
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

function baseDatabaseUrl(): string {
  if (process.env["DATABASE_URL"]) return process.env["DATABASE_URL"];
  const file = new URL("../../../.env.local", import.meta.url);
  const url = existsSync(file) ? parseEnv(readFileSync(file, "utf8"))["DATABASE_URL"] : undefined;
  if (!url) throw new Error("e2e needs DATABASE_URL (a Postgres it may create a database in)");
  return url;
}

const base = baseDatabaseUrl();
const e2eUrl = new URL(base);
e2eUrl.pathname = "/proofofclaim_e2e";

export const E2E = {
  port: 3200,
  baseURL: "http://localhost:3200",
  baseDatabaseUrl: base,
  databaseUrl: e2eUrl.toString(),
  paypalPort: 3299,
  sessionSecret: "e2e-only-session-secret-not-used-anywhere-else",
  settlement: "acme-restaurant-beverage",
  analyst: { email: "e2e-analyst@judges.example", name: "E2E Analyst", password: "e2e analyst password" },
  supervisor: { email: "e2e-supervisor@judges.example", name: "E2E Supervisor", password: "e2e supervisor password" },
} as const;

/** The web server's environment. An empty ANTHROPIC_API_KEY wins over .env.local (loadEnvFile never overwrites). */
export const serverEnv: Record<string, string> = {
  DATABASE_URL: E2E.databaseUrl,
  SESSION_SECRET: E2E.sessionSecret,
  NETWORK_SECRET: "e2e-network-secret",
  ANTHROPIC_API_KEY: "",
  PAYPAL_API_BASE: `http://127.0.0.1:${E2E.paypalPort}`,
  PAYPAL_GUARDED_CLIENT_ID: "e2e-client",
  PAYPAL_GUARDED_CLIENT_SECRET: "e2e-secret",
  PAYPAL_RPM: "600",
  // Throwaway 32-byte keys for sealing and pseudonymising payer IDs in the e2e database only.
  PAYER_SEAL_KEY: Buffer.alloc(32, 11).toString("base64"),
  PAYER_PSEUDONYM_KEY: Buffer.alloc(32, 12).toString("base64"),
};
