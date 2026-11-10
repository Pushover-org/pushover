// Loads the demo settlement: the fictional Acme Restaurant Beverage Settlement with the dev and
// pilot claims from claims-v1, filed in their recorded order and decided by the desk exactly as
// a live claim is. The held-out 100 stay unseen until the full eval (spec §6 R13).
// Pilot receipts reuse Haiku's readings from the R9 run; dev receipts are read once (about
// $0.03) and cached in .data/demo/. From the repo root, on an empty database:
//   pnpm demo:seed
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { parseSettlement } from "@proofofclaim/claims";
import { loadTaxTable, PROVISIONAL_CONFIG } from "@proofofclaim/checks";
import { createPool, getSettlementConfig, insertSettlement } from "@proofofclaim/db";
import { CostGuard, examine, type ExamineResult } from "@proofofclaim/examiner";
import { decideClaim, fileClaim, readEvidence, type Desk } from "../src/index.ts";

const CORPUS = new URL("../../eval/corpus/claims-v1/", import.meta.url);
const PILOT_READINGS = ".data/eval/claims-pilot-2026-11-01-haiku/readings.jsonl";
const CACHE = ".data/demo";
const MODEL = process.env["PUSHOVER_MODEL"] ?? "claude-haiku-5-5";

interface CorpusClaim {
  id: string; seq: number; split: string; tier: "proof" | "no_proof"; units_claimed: number; declaration: string;
  claimant: { name: string; email: string; address_line: string; zip: string; state: string };
  network: { ip: string; at: string };
}

const settlement = parseSettlement(JSON.parse(readFileSync(new URL("settlement.json", CORPUS), "utf8")));
const claims = readFileSync(new URL("manifest.jsonl", CORPUS), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as CorpusClaim)
  .filter((c) => c.split === "dev" || c.split === "pilot").sort((a, b) => a.seq - b.seq);

const cached = new Map<string, ExamineResult>();
for (const file of [PILOT_READINGS, `${CACHE}/readings.jsonl`]) {
  if (!existsSync(file)) continue;
  for (const l of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
    const { id, result } = JSON.parse(l) as { id: string; result: ExamineResult };
    cached.set(id, result);
  }
}
mkdirSync(CACHE, { recursive: true });

const pool = createPool();
if (await getSettlementConfig(pool, settlement.id)) {
  console.log(`${settlement.id} is already loaded. Decisions are append-only, so reseed into a fresh database.`);
  await pool.end();
  process.exit(0);
}
await insertSettlement(pool, settlement);

const guard = new CostGuard(0.5, 0);
const client = new Anthropic();
let current = "";
const desk: Desk = {
  pool, settlement, table: loadTaxTable(), config: PROVISIONAL_CONFIG, networkSecret: process.env["NETWORK_SECRET"] ?? "demo-network-secret",
  read: async (input) => {
    const hit = cached.get(current);
    if (hit) return hit;
    const r = await examine({ client, model: MODEL, guard }, input);
    appendFileSync(`${CACHE}/readings.jsonl`, `${JSON.stringify({ id: current, result: r })}\n`);
    console.log(`  read ${current} ${r.status} $${r.costUsd.toFixed(4)}`);
    return r;
  },
};

// Every claim is filed before any is decided, as when a claims window closes: the template and
// velocity checks (C7, C9) then see the whole set, as they did in the eval.
for (const c of claims) {
  const image = c.tier === "proof" ? readFileSync(`.data/claims-v1/${c.id}.jpg`) : null;
  await fileClaim(desk, {
    id: c.id, tier: c.tier, unitsClaimed: c.units_claimed, name: c.claimant.name, email: c.claimant.email, addressLine: c.claimant.address_line, city: "",
    state: c.claimant.state, zip: c.claimant.zip, declaration: c.declaration, ip: c.network.ip, image, paypal: null, submittedAt: new Date(c.network.at),
  });
}
const tally: Record<string, number> = {};
for (const c of claims) {
  current = c.id;
  await readEvidence(desk, c.id);
  const r = await decideClaim(desk, c.id);
  const key = r ? r.decision.outcome : "UNDECIDED";
  tally[key] = (tally[key] ?? 0) + 1;
}
console.log(`loaded ${claims.length} claims into ${settlement.id}:`, tally, `examiner spend this run $${guard.spent.toFixed(4)}`);
await pool.end();
