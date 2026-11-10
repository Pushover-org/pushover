// The live scoreboard (plan items P21, C6) for a settlement whose claims carry ground-truth labels
// (the demo). It reads the current decisions, so it moves as analysts decide; the arithmetic is in
// lib/scoreboard.ts.
import type { Settlement } from "@proofofclaim/claims";
import { listGroups } from "@proofofclaim/db";
import { score, type Scoreboard } from "../scoreboard.ts";
import { asFiledCents, claimViews, demoTruth, pool } from "./data.ts";

export async function scoreboard(S: Settlement): Promise<Scoreboard | null> {
  const [views, truth, groups] = await Promise.all([
    claimViews(S.id),
    demoTruth(),
    listGroups(pool(), S.id, { activeOnly: true }),
  ]);
  const labelled = views.filter((v) => truth.has(v.id));
  if (labelled.length === 0) return null;
  const groupOf = new Map(
    groups.flatMap((g) => g.members.map((m) => [m, g.status] as const)),
  );
  const { rows } = await pool().query<{
    claim_id: string;
    outcome: string;
    entitlement_cents: number | null;
  }>(
    "SELECT DISTINCT ON (claim_id) claim_id, outcome, entitlement_cents FROM decisions WHERE decided_by = 'system' AND claim_id = ANY($1) ORDER BY claim_id, id DESC",
    [labelled.map((v) => v.id)],
  );
  const system = new Map(
    rows.map((r) => [
      r.claim_id,
      { outcome: r.outcome, entitlementCents: r.entitlement_cents },
    ]),
  );
  return score(
    labelled.map((v) => ({
      id: v.id,
      truth: truth.get(v.id)?.truth ?? "",
      tier: v.tier,
      modelSaid: v.modelSaid,
      asFiledCents: asFiledCents(v, S),
      system: system.get(v.id) ?? null,
      outcome: v.outcome,
      entitlementCents: v.entitlementCents,
      group: groupOf.get(v.id) ?? null,
    })),
  );
}
