// Fraud rings on the database (plan items P25–P30). Detection is code (packages/checks/rings);
// the investigator only answers three questions about facts this file computes under stand-in
// labels, and stores what it was shown and what it said.
import { createHmac } from "node:crypto";
import { findRings, jaccard, normaliseBuilding, normaliseInbox, RING_CONFIG, shingles, type RingGroup } from "@proofofclaim/checks";
import { getGroup, insertInvestigation, ringClaims, setSignalKeys, syncGroups, withTransaction, type RingClaimRow } from "@proofofclaim/db";
import { investigate, type Answers, type GroupFacts, type InvestigationResult, type InvestigatorDeps } from "@proofofclaim/examiner";
import type { Desk } from "./desk.ts";

const keyed = (secret: string, kind: string, value: string | null) => (value ? createHmac("sha256", secret).update(`${kind}:${value}`).digest("hex") : null);

/** The keyed hashes ring detection compares: never the raw device ID, inbox or address. */
export function signalKeys(desk: Pick<Desk, "networkSecret">, a: { email: string; addressLine: string; zip: string; deviceId?: string | null }) {
  return {
    deviceKey: keyed(desk.networkSecret, "device", a.deviceId ?? null),
    inboxKey: keyed(desk.networkSecret, "inbox", normaliseInbox(a.email)),
    buildingKey: keyed(desk.networkSecret, "building", normaliseBuilding(a.addressLine, a.zip)),
  };
}

/** Finds the groups among all claims of the settlement now, and stores them (keeping decisions on unchanged groups). */
export async function detectRings(desk: Desk): Promise<RingGroup[]> {
  const rows = await ringClaims(desk.pool, desk.settlement.id);
  // Claims filed before signal keys existed get theirs now (inbox and building; a device can't be known later).
  for (const r of rows) {
    if (r.inboxKey === null || r.buildingKey === null) {
      const k = signalKeys(desk, r);
      await setSignalKeys(desk.pool, r.claimId, k);
      r.inboxKey ??= k.inboxKey;
      r.buildingKey ??= k.buildingKey;
    }
  }
  const groups = findRings(rows.map((r) => ({ claimId: r.claimId, deviceKey: r.deviceKey, inboxKey: r.inboxKey, buildingKey: r.buildingKey, networkKey: r.networkKey, declaration: r.declaration, filedAtMs: r.filedAt.getTime() })));
  await withTransaction(desk.pool, (c) => syncGroups(c, desk.settlement.id, groups));
  return groups;
}

const LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const label = (i: number) => `Claim ${i < 26 ? LABELS[i] : `${LABELS[Math.floor(i / 26) - 1]}${LABELS[i % 26]}`}`;

/**
 * What the investigator may see: per member, a stand-in label, tier, state, latest outcome, minutes
 * after the group's first filing and the amount asked; and which labels share which signal. No
 * name, email, address, ZIP, network, PayPal ID or claim ID. The label map stays with us.
 */
export async function groupFacts(desk: Desk, members: string[]): Promise<{ facts: GroupFacts; labels: Record<string, string> }> {
  const all = await ringClaims(desk.pool, desk.settlement.id);
  const rows = all.filter((r) => members.includes(r.claimId)).sort((a, b) => a.filedAt.getTime() - b.filedAt.getTime() || a.seq - b.seq);
  const first = rows[0]?.filedAt.getTime() ?? 0;
  const { rows: decisions } = await desk.pool.query<{ claim_id: string; outcome: string }>(
    "SELECT DISTINCT ON (claim_id) claim_id, outcome FROM decisions WHERE claim_id = ANY($1) ORDER BY claim_id, id DESC",
    [members],
  );
  const outcome = new Map(decisions.map((d) => [d.claim_id, d.outcome]));
  const s = desk.settlement;
  const asked = (r: RingClaimRow) => (r.tier === "no_proof" ? s.tiers.noProof.flatCents : Math.min(r.unitsClaimed, s.tiers.proof.maxUnits) * s.tiers.proof.unitCents);
  const labels: Record<string, string> = {};
  const byClaim = new Map<string, string>();
  rows.forEach((r, i) => {
    labels[label(i)] = r.claimId;
    byClaim.set(r.claimId, label(i));
  });
  const facts: GroupFacts = {
    members: rows.map((r) => ({
      label: byClaim.get(r.claimId) as string, tier: r.tier, state: r.state, outcome: outcome.get(r.claimId) ?? null,
      filedMinutesAfterFirst: Math.round((r.filedAt.getTime() - first) / 60_000), askedCents: asked(r),
    })),
    links: [],
  };
  const sets = new Map(rows.map((r) => [r.claimId, shingles(r.declaration, RING_CONFIG.storyShingle)]));
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i] as RingClaimRow;
      const b = rows[j] as RingClaimRow;
      const between: [string, string] = [byClaim.get(a.claimId) as string, byClaim.get(b.claimId) as string];
      if (a.deviceKey && a.deviceKey === b.deviceKey) facts.links.push({ kind: "device", between });
      if (a.inboxKey && a.inboxKey === b.inboxKey) facts.links.push({ kind: "inbox", between });
      const sim = jaccard(sets.get(a.claimId) ?? new Set(), sets.get(b.claimId) ?? new Set());
      if (sim >= RING_CONFIG.storyThreshold) facts.links.push({ kind: "story", between, similarity: Math.round(sim * 100) / 100 });
      if (a.buildingKey && a.buildingKey === b.buildingKey) facts.links.push({ kind: "building", between });
      if (a.networkKey && a.networkKey === b.networkKey) facts.links.push({ kind: "network", between });
    }
  }
  return { facts, labels };
}

/** Investigates one stored group (asking the model, or replaying a recorded answer) and records it. */
export async function investigateGroup(
  desk: Desk,
  groupId: number,
  deps: InvestigatorDeps | null,
  replay?: (factsSha256: string) => Answers | null,
): Promise<InvestigationResult & { facts: GroupFacts }> {
  const g = await getGroup(desk.pool, groupId);
  if (!g || g.settlementId !== desk.settlement.id) throw new Error(`no group ${groupId} in this settlement`);
  const { facts, labels } = await groupFacts(desk, g.members);
  const r = await investigate(deps, facts, replay);
  await insertInvestigation(desk.pool, {
    groupId, factsSha256: r.factsSha256, facts, labels, model: r.model, status: r.status, answers: r.answers, recommendation: r.recommendation, error: r.error, costUsd: r.costUsd,
  });
  return { ...r, facts };
}
