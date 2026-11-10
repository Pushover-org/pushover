// The claims eval (spec §5.2). From the repo root:
//   pnpm eval:claims --run-id <id> --model <model> [--split pilot] [--budget 1.5] [--check]
// Needs the evidence images: pnpm receipts:download && pnpm corpus:images.
// --check spends nothing: it confirms the images and prints how many calls the run makes and
// what they could cost. Readings are kept in git-ignored .data/eval/<run-id>/, so a rerun with
// the same id reuses them instead of paying again. Results go to packages/eval/results/<run-id>/.
import { execSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { DECISION_VERSION, FindingsSchema, parseSettlement, type Findings } from "@proofofclaim/claims";
import { hashRotations, loadTaxTable, PROVISIONAL_CONFIG, normaliseMerchant } from "@proofofclaim/checks";
import { CostGuard, costUsd, examine, type ExamineResult } from "@proofofclaim/examiner";
import { askModelAlone, type ModelAloneResult } from "../src/arm-b.ts";
import { perfectFindings } from "../src/corpus/perfect.ts";
import { ClaimSchema, readJsonl, ReceiptTruthSchema } from "../src/corpus/schema.ts";
import { runArmC, type Reading } from "../src/pipeline.ts";
import { score, type Scored } from "../src/score.ts";

const { values: arg } = parseArgs({
  options: {
    "run-id": { type: "string" }, corpus: { type: "string", default: "claims-v1" }, model: { type: "string" },
    split: { type: "string", default: "pilot" }, budget: { type: "string", default: "1.5" }, check: { type: "boolean", default: false },
    concurrency: { type: "string", default: "4" },
  },
});
const runId = arg["run-id"];
const model = arg.model;
if (!runId || !/^[a-z0-9-]+$/.test(runId)) throw new Error("--run-id is required (lowercase letters, digits, dashes)");
if (!model) throw new Error("--model is required, e.g. claude-haiku-5-5");
const split = arg.split as string;

const DIR = new URL(`../corpus/${arg.corpus}/`, import.meta.url);
const all = readJsonl(new URL("manifest.jsonl", DIR), ClaimSchema);
const truths = new Map(readJsonl(new URL("receipts.jsonl", DIR), ReceiptTruthSchema).map((r) => [r.id, r]));
const settlement = parseSettlement(JSON.parse(readFileSync(new URL("settlement.json", DIR), "utf8")));
const slice = all.filter((c) => split === "all" || c.split === split);
if (slice.length === 0) throw new Error(`no claims in split ${split}`);
const imagePath = (id: string) => `.data/${arg.corpus}/${id}.jpg`;
const proof = slice.filter((c) => c.evidence);
const missing = proof.filter((c) => !existsSync(imagePath(c.id)));
if (missing.length) throw new Error(`${missing.length} evidence images missing (first: ${imagePath(missing[0]?.id ?? "")}). Run pnpm receipts:download && pnpm corpus:images`);

// Typical and worst-case cost. Typical: about 3,000 tokens in (image and prompt) and 2,000 out.
const calls = proof.length + slice.length;
const typical = calls * costUsd(model, { inputTokens: 3000, outputTokens: 2000 });
const worst = proof.length * CostGuard.reserveFor(model, 6000) + slice.length * CostGuard.reserveFor(model, 4000);
console.log(`${runId}: ${slice.length} claims in ${split} (${proof.length} with a receipt), ${model}`);
console.log(`calls: ${proof.length} readings + ${slice.length} model-alone = ${calls}; typical about $${typical.toFixed(2)}, at most $${worst.toFixed(2)}; budget $${arg.budget}`);
if (arg.check) process.exit(0);

const cache = `.data/eval/${runId}`;
mkdirSync(cache, { recursive: true });
const cached = <T>(file: string): Map<string, T> => {
  const m = new Map<string, T>();
  if (existsSync(`${cache}/${file}`)) for (const l of readFileSync(`${cache}/${file}`, "utf8").split("\n").filter(Boolean)) {
    const { id, result } = JSON.parse(l) as { id: string; result: T };
    m.set(id, result);
  }
  return m;
};
const readings = cached<ExamineResult>("readings.jsonl");
const alone = cached<ModelAloneResult>("model-alone.jsonl");
const spentBefore = [...readings.values(), ...alone.values()].reduce((s, r) => s + r.costUsd, 0);
const guard = new CostGuard(Number(arg.budget), spentBefore);
const client = new Anthropic();
const products = settlement.products.map((p) => ({ id: p.id, name: p.name, description: p.description }));
const rules = {
  name: settlement.name, classPeriod: settlement.classPeriod, states: [...settlement.geography.states],
  product: products.map((p) => p.description).join("; "), proof: settlement.tiers.proof, noProofCents: settlement.tiers.noProof.flatCents,
};

type Job = () => Promise<void>;
const jobs: Job[] = [];
for (const c of slice) {
  const image = c.evidence ? readFileSync(imagePath(c.id)) : null;
  if (image && !readings.has(c.id)) jobs.push(async () => {
    const r = await examine({ client, model, guard }, { image, declaration: c.declaration, products });
    readings.set(c.id, r);
    appendFileSync(`${cache}/readings.jsonl`, `${JSON.stringify({ id: c.id, result: r })}\n`);
    console.log(`  read ${c.id} ${r.status}${r.findings ? ` ${r.findings.confidence}` : ""} $${r.costUsd.toFixed(4)}`);
  });
  if (!alone.has(c.id)) jobs.push(async () => {
    const r = await askModelAlone({ client, model, guard }, rules, c, image);
    alone.set(c.id, r);
    appendFileSync(`${cache}/model-alone.jsonl`, `${JSON.stringify({ id: c.id, result: r })}\n`);
    console.log(`  alone ${c.id} ${r.status} ${r.decision ?? "-"} $${r.costUsd.toFixed(4)}`);
  });
}
let next = 0;
await Promise.all(Array.from({ length: Number(arg.concurrency) }, async () => {
  while (next < jobs.length) await (jobs[next++] as Job)();
}));

// Arm C on the readings, with real image hashes. Clusters see every claim in the set.
const hashes = new Map<string, string[] | null>();
for (const c of proof) {
  try {
    hashes.set(c.id, await hashRotations(readFileSync(imagePath(c.id))));
  } catch {
    hashes.set(c.id, null);
  }
}
const asReading = (r: ExamineResult | undefined): Reading => (r ? { status: r.status, findings: r.findings ? FindingsSchema.parse(r.findings) : null } : { status: "NOT_RUN", findings: null });
const armC = runArmC({
  claims: all, decide: new Set(slice.map((c) => c.id)), readings: new Map(proof.map((c) => [c.id, asReading(readings.get(c.id))])), hashes,
  settlement, table: loadTaxTable(), config: PROVISIONAL_CONFIG, networkSecret: `eval-${runId}`,
});

const rows: Scored[] = slice.map((c) => {
  const d = armC.get(c.id);
  if (!d) throw new Error(`${c.id} was not decided`);
  const b = alone.get(c.id);
  return {
    claim: c, truth: c.evidence ? (truths.get(c.evidence.receipt) ?? null) : null,
    armC: { outcome: d.decision.outcome, reason: d.decision.reason, entitlementCents: d.decision.outcome === "APPROVE" ? d.decision.entitlementCents : 0 },
    armB: { decision: b?.decision ?? null, units: b?.units ?? 0 },
    modelRecommendation: readings.get(c.id)?.findings?.model_recommendation ?? null,
  };
});
const terms = { fundCents: settlement.fundCents, adminReserveCents: settlement.adminReserveCents, proof: settlement.tiers.proof, noProofCents: settlement.tiers.noProof.flatCents };
const result = score(rows, terms, slice.length / all.length);
const unseen = score(rows.filter((r) => !r.claim.seen_before_design), terms, slice.length / all.length);

// Reading accuracy against each receipt's truth, field by field.
const fields = { date: 0, state: 0, subtotal: 0, tax: 0, total: 0, drinkUnits: 0, merchant: 0 };
let read = 0;
const units = (f: Findings) => f.line_items.filter((l) => l.matches_product_id === "restaurant-drink").reduce((n, l) => n + Math.floor(l.qty ?? 1), 0);
for (const c of proof) {
  const r = readings.get(c.id);
  const t = c.evidence ? truths.get(c.evidence.receipt) : undefined;
  if (r?.status !== "OK" || !r.findings || !t) continue;
  read++;
  const f = FindingsSchema.parse(r.findings);
  const p = perfectFindings(t);
  if (f.purchase_date === p.purchase_date) fields.date++;
  if (f.merchant_state === p.merchant_state) fields.state++;
  if (f.subtotal_cents === p.subtotal_cents) fields.subtotal++;
  if (f.tax_cents === p.tax_cents) fields.tax++;
  if (f.total_cents === p.total_cents) fields.total++;
  if (units(f) === units(p)) fields.drinkUnits++;
  if (normaliseMerchant(f.merchant_name ?? "") === normaliseMerchant(p.merchant_name ?? "")) fields.merchant++;
}

const spent = [...readings.values(), ...alone.values()].reduce((s, r) => s + r.costUsd, 0);
const status = (xs: { status: string }[]) => xs.reduce<Record<string, number>>((m, x) => ((m[x.status] = (m[x.status] ?? 0) + 1), m), {});
const out = new URL(`../results/${runId}/`, import.meta.url);
mkdirSync(out, { recursive: true });
writeFileSync(new URL("meta.json", out), `${JSON.stringify({
  runId, model, corpus: arg.corpus, split, claims: slice.length, decisionVersion: DECISION_VERSION, config: PROVISIONAL_CONFIG,
  commit: execSync("git rev-parse HEAD").toString().trim(), finished: new Date().toISOString(), costUsd: Number(spent.toFixed(5)),
  examiner: status([...readings.values()]), modelAlone: status([...alone.values()]),
}, null, 2)}\n`);
writeFileSync(new URL("summary.json", out), `${JSON.stringify({ ...result, unseenOnly: { honest: unseen.honest, armC: unseen.armC }, reading: { read, of: proof.length, exact: fields } }, null, 2)}\n`);
const csv = [
  "id,group,truth,expected_outcome,expected_reason,c_outcome,c_reason,c_cents,b_decision,b_units,model_recommendation,examiner_status,confidence",
  ...rows.map((r) => {
    const e = readings.get(r.claim.id);
    return [r.claim.id, r.claim.group, r.claim.truth, r.claim.expected.outcome, r.claim.expected.reason, r.armC.outcome, r.armC.reason, r.armC.entitlementCents,
      r.armB.decision ?? "none", r.armB.units, r.modelRecommendation ?? "", e?.status ?? "", e?.findings?.confidence ?? ""].join(",");
  }),
].join("\n");
writeFileSync(new URL("claims.csv", out), `${csv}\n`);

const $ = (c: number) => `$${(c / 100).toFixed(2)}`;
const pct = (w: { k: number; n: number; low: number; high: number }) => `${w.k}/${w.n} (${((100 * w.k) / (w.n || 1)).toFixed(1)}%, 95% CI ${(100 * w.low).toFixed(1)}-${(100 * w.high).toFixed(1)}%)`;
console.log(`\nspent $${spent.toFixed(4)}. Readings: ${JSON.stringify(status([...readings.values()]))}; model alone: ${JSON.stringify(status([...alone.values()]))}`);
console.log(`fraud paid:     A ${$(result.armA.fraudCents)}   B ${$(result.armB.fraudCents)}   C ${$(result.armC.fraudCents)} (worst case ${$(result.armC.fraudCentsWorstCase)})`);
console.log(`ineligible paid: A ${$(result.armA.ineligibleCents)}   B ${$(result.armB.ineligibleCents)}   C ${$(result.armC.ineligibleCents)}`);
console.log(`honest denied:  B ${pct(result.armB.honestWronglyDenied)}   C ${pct(result.armC.honestWronglyDenied)}`);
console.log(`honest REVIEW+NEED_MORE (C): ${pct(result.armC.honestWorkload)}`);
console.log(`honest average check: A ${$(result.armA.honestAverageCheckCents)}   B ${$(result.armB.honestAverageCheckCents)}   C ${$(result.armC.honestAverageCheckCents)}`);
console.log(`arm C matches the expected outcome on ${result.armC.outcomeMatchesExpected}/${result.n}; reading exact on ${read} receipts: ${JSON.stringify(fields)}`);
console.log(`GATE ${result.gate.go ? "GO" : "NO-GO"}: fraud ratio ${result.gate.fraudRatio?.toFixed(3) ?? "n/a"} (${result.gate.fraudOk ? "ok" : "fail"}), denied ${result.gate.deniedOk ? "ok" : "fail"}, workload ${result.gate.workloadOk ? "ok" : "fail"}`);
