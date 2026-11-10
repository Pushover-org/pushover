// A fresh e2e database with the demo settlement and two analysts, and the fake PayPal.
import { readFileSync } from "node:fs";
import { parseSettlement } from "@proofofclaim/claims";
import { createPool, insertSettlement, migrate } from "@proofofclaim/db";
import { setAnalyst } from "@proofofclaim/desk";
import { E2E } from "./env.ts";
import { startFakePayPal } from "./fake-paypal.ts";

export default async function globalSetup() {
  const admin = createPool(E2E.baseDatabaseUrl);
  await admin.query("DROP DATABASE IF EXISTS proofofclaim_e2e WITH (FORCE)");
  await admin.query("CREATE DATABASE proofofclaim_e2e");
  await admin.end();

  const pool = createPool(E2E.databaseUrl);
  await migrate(pool);
  const corpus = new URL("../../../packages/eval/corpus/claims-v1/settlement.json", import.meta.url);
  await insertSettlement(pool, parseSettlement(JSON.parse(readFileSync(corpus, "utf8"))));
  await setAnalyst(pool, { ...E2E.analyst, role: "analyst" }, "e2e");
  await setAnalyst(pool, { ...E2E.supervisor, role: "supervisor" }, "e2e");
  await pool.end();

  const paypal = await startFakePayPal(E2E.paypalPort);
  return async () => {
    await paypal.close();
  };
}
