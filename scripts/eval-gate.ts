// The eval gate before every deploy (plan item P52). It re-scores the recorded Haiku 5.5 pilot run
// (packages/eval/results/claims-pilot-2026-11-01-haiku) with the code as it is now: the same
// readings, so the same answers from the model, through today's checks and decision table. It
// spends nothing: a reading missing from the cache is refused, not bought. The deploy
// stops if any number is worse than the recorded one:
//   fraud paid, ineligible paid, honest claimants wrongly denied, honest workload, the GO/NO-GO
//   gate itself, and how many claims reach the expected outcome.
// Needs the local evidence images and readings (git-ignored .data/; docs/deploy.md).
//   node --env-file-if-exists=.env.local scripts/eval-gate.ts
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";

const RECORDED = "claims-pilot-2026-11-01-haiku";
const MODEL = "claude-haiku-5-5";

interface ArmC {
  fraudCents: number;
  ineligibleCents: number;
  honestWronglyDenied: { k: number };
  honestWorkload: { k: number };
  outcomeMatchesExpected: number;
}
interface Summary { armC: ArmC; gate: { go: boolean } }

const read = (dir: string): Summary => JSON.parse(readFileSync(`packages/eval/results/${dir}/summary.json`, "utf8")) as Summary;

if (!existsSync(`.data/eval/${RECORDED}/readings.jsonl`)) {
  console.error(`eval gate: the recorded readings are missing (.data/eval/${RECORDED}/). Copy them from the original laptop.`);
  process.exit(1);
}

// The budget is what the recorded run already spent plus a tenth of a cent, so any reading that
// isn't cached would be refused by the cost guard instead of bought.
const spent = ["readings.jsonl", "model-alone.jsonl"]
  .flatMap((f) => readFileSync(`.data/eval/${RECORDED}/${f}`, "utf8").split("\n").filter(Boolean))
  .reduce((s, l) => s + ((JSON.parse(l) as { result: { costUsd: number } }).result.costUsd ?? 0), 0);
const budget = (spent + 0.001).toFixed(5);

const run = `gate-${Date.now()}`;
cpSync(`.data/eval/${RECORDED}`, `.data/eval/${run}`, { recursive: true });
let now: Summary | null;
try {
  execFileSync(process.execPath, ["--env-file-if-exists=.env.local", "packages/eval/scripts/eval-claims.ts", "--run-id", run, "--model", MODEL, "--split", "pilot", "--budget", budget], {
    stdio: ["ignore", "inherit", "inherit"],
    // The model is never called (every reading is cached); the SDK client only needs a key to be built.
    env: { ...process.env, ANTHROPIC_API_KEY: process.env["ANTHROPIC_API_KEY"] || "not-used-by-the-gate" },
  });
  now = read(run);
} catch {
  now = null;
} finally {
  rmSync(`.data/eval/${run}`, { recursive: true, force: true });
  rmSync(`packages/eval/results/${run}`, { recursive: true, force: true });
}
if (!now) {
  console.error("\nEVAL GATE: BLOCKED. The re-scoring run failed (above).");
  process.exit(1);
}

const was = read(RECORDED);
const lowerIsBetter: [string, number, number][] = [
  ["fraud paid (cents)", was.armC.fraudCents, now.armC.fraudCents],
  ["ineligible paid (cents)", was.armC.ineligibleCents, now.armC.ineligibleCents],
  ["honest claimants wrongly denied", was.armC.honestWronglyDenied.k, now.armC.honestWronglyDenied.k],
  ["honest claimants sent to review or asked for more", was.armC.honestWorkload.k, now.armC.honestWorkload.k],
];
const worse = lowerIsBetter.filter(([, w, n]) => n > w).map(([name, w, n]) => `${name}: ${w} → ${n}`);
if (now.armC.outcomeMatchesExpected < was.armC.outcomeMatchesExpected) worse.push(`claims reaching the expected outcome: ${was.armC.outcomeMatchesExpected} → ${now.armC.outcomeMatchesExpected}`);
if (was.gate.go && !now.gate.go) worse.push("the pre-registered gate went from GO to NO-GO");

console.log("");
for (const [name, w, n] of lowerIsBetter) console.log(`  ${name}: recorded ${w}, now ${n}`);
console.log(`  claims reaching the expected outcome: recorded ${was.armC.outcomeMatchesExpected}, now ${now.armC.outcomeMatchesExpected}`);
if (worse.length) {
  console.error(`\nEVAL GATE: BLOCKED. Worse than the recorded run:\n  ${worse.join("\n  ")}`);
  process.exit(1);
}
console.log("\nEVAL GATE: PASS (nothing worse than the recorded run)");
