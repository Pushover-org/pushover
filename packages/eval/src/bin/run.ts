// pnpm eval:run --run-id <id> [--corpus packages/eval/corpus/pilot.jsonl] [--model <id>] [--seed 1]
//               [--budget-usd 1] [--only A1-001,L3-001] [--check]
// Baseline only (§9 step 7). --check reports the pool orders the run needs and spends nothing.
// Writes packages/eval/results/<run-id>/{meta.json, rows.csv, transcripts.jsonl, summary.json}
// and one attack_runs row per item.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createToolkit, BASELINE_CALL_SETTINGS } from "@pushover/baseline";
import { createPool, getActivePolicy } from "@pushover/db";
import { limiterFromEnv, paypalClientFromEnv } from "@pushover/paypal";
import { poolCounts } from "../checkout.ts";
import { loadCorpus, SCENARIOS, type OrderSlot } from "../corpus.ts";
import { runBaselineItem, shuffleBySeed, summarize, type RunRow } from "../run.ts";

const { values: v } = parseArgs({
  options: {
    "run-id": { type: "string" },
    corpus: { type: "string", default: "packages/eval/corpus/pilot.jsonl" },
    model: { type: "string" },
    seed: { type: "string", default: "1" },
    "budget-usd": { type: "string", default: "1" },
    only: { type: "string" },
    check: { type: "boolean", default: false },
  },
});
const env = (k: string) => {
  const x = process.env[k];
  if (!x) throw new Error(`missing environment variable ${k}`);
  return x;
};
const runId = v["run-id"];
if (!runId || !/^[A-Za-z0-9-]+$/.test(runId)) throw new Error("--run-id is required (letters, digits, dashes)");
const model = v.model ?? env("PUSHOVER_MODEL");
const seed = Number(v.seed);
const budget = Number(v["budget-usd"]);
const only = v.only ? new Set(v.only.split(",")) : null;

let items = loadCorpus(v.corpus);
if (only) items = items.filter((i) => only.has(i.id));
items = shuffleBySeed(items, seed);

const db = createPool();
try {
  // Pool orders needed, by kind. A multi order also satisfies nothing else, so count separately.
  const need: Record<OrderSlot["kind"], number> = { big: 0, multi: 0, normal: 0 };
  for (const it of items) for (const s of Object.values(SCENARIOS[it.scenario]) as OrderSlot[]) need[s.kind]++;
  const have = await poolCounts(db, "BASELINE");
  const enough = have.big >= need.big && have.multi >= need.multi && have.normal >= need.normal + need.multi;
  console.log(`pool BASELINE: need big ${need.big}, multi ${need.multi}, normal ${need.normal} (+${need.multi} multi); have big ${have.big}, multi ${have.multi}, normal ${have.normal} -> ${enough ? "enough" : "NOT ENOUGH"}`);
  if (v.check || !enough) {
    process.exitCode = enough ? 0 : 1;
  } else {
    const outDir = `packages/eval/results/${runId}`;
    if (existsSync(`${outDir}/rows.csv`)) throw new Error(`${outDir} already has results; pick a new --run-id`);
    mkdirSync(outDir, { recursive: true });

    const policy = await getActivePolicy(db);
    const creds = { clientId: env("PAYPAL_BASELINE_CLIENT_ID"), clientSecret: env("PAYPAL_BASELINE_CLIENT_SECRET") };
    const pp = paypalClientFromEnv("baseline", limiterFromEnv());
    const deps = { db, pp, toolkit: createToolkit(creds), baseline: { paypal: creds, anthropicApiKey: env("ANTHROPIC_API_KEY") }, policy };
    const baselinePkg = JSON.parse(readFileSync("packages/baseline/package.json", "utf8")) as { dependencies: Record<string, string> };
    const git = (...a: string[]) => execFileSync("git", a, { encoding: "utf8" }).trim();
    writeFileSync(`${outDir}/meta.json`, JSON.stringify({
      run_id: runId, started_at: new Date().toISOString(), agent: "baseline", model, seed,
      corpus: v.corpus, corpus_sha256: createHash("sha256").update(readFileSync(v.corpus)).digest("hex"), items: items.map((i) => i.id),
      git_sha: git("rev-parse", "HEAD"), git_dirty: git("status", "--porcelain").length > 0,
      policy_version: policy.version, baseline_call_settings: BASELINE_CALL_SETTINGS,
      pinned: Object.fromEntries(["@paypal/agent-toolkit", "ai", "@ai-sdk/anthropic"].map((k) => [k, baselinePkg.dependencies[k]])),
      budget_usd: budget,
    }, null, 2) + "\n");

    const rows: RunRow[] = [];
    let spent = 0;
    for (const item of items) {
      // Stop before an item that could cross the budget: assume it costs as much as the dearest so far.
      const next = Math.max(0, ...rows.map((r) => r.cost_usd));
      if (spent + next > budget) {
        console.log(`budget: stopping before ${item.id} (spent $${spent.toFixed(4)}, next up to $${next.toFixed(4)}, budget $${budget})`);
        break;
      }
      const { row, transcript } = await runBaselineItem(deps, item, { runId, model, seed, now: new Date() });
      rows.push(row);
      spent += row.cost_usd;
      appendFileSync(`${outDir}/transcripts.jsonl`, JSON.stringify(transcript) + "\n");
      await db.query(
        `INSERT INTO attack_runs (run_id, item_id, attack_class, agent, model, seed, moved_cents, owed_cents, unwarranted_cents, legit, outcome, false_refusal, duplicate_refunds, tool_calls, cost_usd)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [row.run_id, row.item_id, row.attack_class, row.agent, row.model, row.seed, row.moved_cents, row.owed_cents, row.unwarranted_cents,
          row.legit, row.outcome, row.false_refusal, row.duplicate_refunds, JSON.stringify(transcript.turns), row.cost_usd],
      );
      const usd = (c: number | null) => (c === null ? "unknown" : `$${(c / 100).toFixed(2)}`);
      console.log(`${row.item_id} ${row.outcome} moved ${usd(row.moved_cents)} owed ${usd(row.owed_cents)} unwarranted ${usd(row.unwarranted_cents)}`
        + `${row.duplicate_refunds ? ` duplicates ${row.duplicate_refunds}` : ""}${row.skipped_review ? " SKIPPED-REVIEW" : ""}`
        + `${row.false_refusal ? " FALSE-REFUSAL" : ""} $${row.cost_usd.toFixed(4)}${row.error ? ` error: ${row.error}` : ""}`);
    }

    const cols: (keyof RunRow)[] = ["run_id", "item_id", "attack_class", "legit", "agent", "model", "seed", "outcome", "moved_cents", "owed_cents",
      "unwarranted_cents", "false_refusal", "skipped_review", "staff_review", "duplicate_refunds", "new_refund_ids", "input_tokens", "output_tokens", "cost_usd", "error"];
    const cell = (x: unknown) => {
      const s = x === null ? "" : Array.isArray(x) ? x.join(" ") : String(x);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    writeFileSync(`${outDir}/rows.csv`, [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n") + "\n");
    const summary = summarize(rows);
    writeFileSync(`${outDir}/summary.json`, JSON.stringify(summary, null, 2) + "\n");
    console.log(JSON.stringify(summary, null, 2));
  }
} finally {
  await db.end();
}
