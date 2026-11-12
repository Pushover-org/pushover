// The R9 pilot results (packages/eval/results), read at build time. Every number the landing page
// shows comes from here, so the page can't drift from what was measured.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Outcome, PilotClaim, PilotSummary } from "./pilot-shared.ts";

export * from "./pilot-shared.ts";

const RUN = "claims-pilot-2026-11-01-haiku";
const root = path.resolve(process.cwd(), "../..");
const dir = path.join(root, "packages/eval/results", RUN);
const MANIFEST = path.join(root, "packages/eval/corpus/claims-v1/manifest.jsonl");
// Settlement terms (corpus settlement.json): $15 per drink up to 5 with a receipt, $10 without.
const UNIT_CENTS = 1500;
const MAX_UNITS = 5;
const NO_PROOF_CENTS = 1000;

function parseCsv(text: string): Record<string, string>[] {
  const [head, ...rows] = text.trim().split("\n");
  const keys = (head ?? "").split(",");
  return rows.map((r) => Object.fromEntries(r.split(",").map((v, i) => [keys[i] ?? `_${i}`, v])));
}

export function loadPilot(): { claims: PilotClaim[]; summary: PilotSummary; run: string } {
  const summary = JSON.parse(readFileSync(path.join(dir, "summary.json"), "utf8")) as PilotSummary;
  const filed = new Map<string, { tier: "proof" | "no_proof"; units_claimed: number }>();
  for (const line of readFileSync(MANIFEST, "utf8").split("\n").filter(Boolean)) {
    const c = JSON.parse(line) as { id: string; tier: "proof" | "no_proof"; units_claimed: number };
    filed.set(c.id, c);
  }
  const claims = parseCsv(readFileSync(path.join(dir, "claims.csv"), "utf8")).map((r): PilotClaim => {
    const f = filed.get(r.id ?? "");
    if (!f) throw new Error(`pilot claim ${r.id} is not in the manifest`);
    return {
      id: r.id ?? "",
      group: r.group ?? "",
      truth: r.truth as PilotClaim["truth"],
      outcome: r.c_outcome as Outcome,
      reason: r.c_reason ?? "",
      cents: Number(r.c_cents ?? 0),
      claimedCents: f.tier === "no_proof" ? NO_PROOF_CENTS : Math.min(f.units_claimed, MAX_UNITS) * UNIT_CENTS,
      tier: f.tier,
      modelAlone: r.b_decision === "approve" || r.b_decision === "deny" ? r.b_decision : null,
      modelSaid: r.model_recommendation === "approve" || r.model_recommendation === "deny" || r.model_recommendation === "review" ? r.model_recommendation : null,
    };
  });
  return { claims, summary, run: RUN };
}
