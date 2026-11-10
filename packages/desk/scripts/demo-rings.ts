// Finds the groups among the demo settlement's claims and asks the investigator about each,
// recording its answers in data/replay/investigations.json (by the hash of the exact facts), so
// the public demo and CI replay them with no API key (plan item P30). A few groups on Haiku cost
// about a cent. From the repo root, after `pnpm demo:seed`:
//   pnpm demo:rings
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { parseSettlement } from "@proofofclaim/claims";
import { loadTaxTable, PROVISIONAL_CONFIG } from "@proofofclaim/checks";
import { createPool, getSettlementConfig, listGroups } from "@proofofclaim/db";
import { CostGuard, type Answers } from "@proofofclaim/examiner";
import { detectRings, investigateGroup, type Desk } from "../src/index.ts";

const SETTLEMENT = process.argv[2] ?? "acme-restaurant-beverage";
const REPLAY = "data/replay/investigations.json";
const pool = createPool();
const raw = await getSettlementConfig(pool, SETTLEMENT);
if (!raw) throw new Error(`no settlement ${SETTLEMENT}; run pnpm demo:seed first`);
const desk: Desk = {
  pool, settlement: parseSettlement(raw), table: loadTaxTable(), config: PROVISIONAL_CONFIG, networkSecret: process.env["NETWORK_SECRET"] ?? "demo-network-secret", read: null, keys: null,
};
const recorded: Record<string, Answers> = existsSync(REPLAY) ? (JSON.parse(readFileSync(REPLAY, "utf8")) as Record<string, Answers>) : {};
const key = process.env["ANTHROPIC_API_KEY"];
const guard = new CostGuard(0.5);
const deps = key ? { client: new Anthropic({ apiKey: key }), model: process.env["PUSHOVER_MODEL"] ?? "claude-haiku-5-5", guard } : null;

const found = await detectRings(desk);
console.log(`${found.length} groups among the claims of ${SETTLEMENT}`);
for (const g of await listGroups(pool, SETTLEMENT, { activeOnly: true })) {
  const r = await investigateGroup(desk, g.id, deps, (sha) => recorded[sha] ?? null);
  if (r.answers) recorded[r.factsSha256] = r.answers;
  console.log(`  group ${g.id}: ${g.members.length} claims, signals ${JSON.stringify(g.signals)} → ${r.status} ${r.answers ? JSON.stringify(r.answers) : r.error} → ${r.recommendation}`);
}
writeFileSync(REPLAY, `${JSON.stringify(recorded, null, 2)}\n`);
console.log(`recorded ${Object.keys(recorded).length} answers in ${REPLAY}; spent $${guard.spent.toFixed(4)}`);
await pool.end();
