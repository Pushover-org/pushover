// The decision ledger on the database (plan items P33, C1, C2, P44). commitLedger runs when a
// second person approves money, before any batch exists (the database refuses a batch without
// it). recordBeacons runs in the worker once the committed drand round is out.
import { checkResultsOf, commitmentsAwaitingBeacon, getCommitment, insertCommitment, recordBeacon, type Pool } from "@proofofclaim/db";
import {
  auditSample, canonical, commitmentDigest, fetchBeacon, LEDGER_VERSION, merkleRoot, QUICKNET, roundAt, rulesSha256, SAMPLE_SIZE, sha256Hex, type CheckOutcome, type Commitment, type DecisionLeaf,
  type RulesFingerprint,
} from "@proofofclaim/ledger";
import type { Desk } from "./desk.ts";

/** How far ahead the committed drand round is: it must not exist when the root is fixed. */
export const DRAND_LEAD_SECONDS = 30;

/** Every decided claim of the settlement, as its latest decision stands now. */
export async function decisionLeaves(desk: Desk): Promise<DecisionLeaf[]> {
  const { rows } = await desk.pool.query<{
    id: string; outcome: string; reason: string; rule: number | null; decision_version: string; decided_by: string; entitlement_cents: number | null;
    evidence_sha256: string | null; findings: unknown; system_decision_id: string | null;
  }>(
    `SELECT c.id, d.outcome, d.reason, d.rule, d.decision_version, d.decided_by, d.entitlement_cents,
            (SELECT e.sha256 FROM claim_evidence e WHERE e.claim_id = c.id ORDER BY e.id LIMIT 1) AS evidence_sha256,
            (SELECT f.findings FROM findings f WHERE f.claim_id = c.id AND f.status = 'OK' ORDER BY f.id DESC LIMIT 1) AS findings,
            sd.id AS system_decision_id
     FROM claims c
     JOIN LATERAL (SELECT * FROM decisions x WHERE x.claim_id = c.id ORDER BY x.id DESC LIMIT 1) d ON true
     LEFT JOIN LATERAL (SELECT id FROM decisions x WHERE x.claim_id = c.id AND x.decided_by = 'system' ORDER BY x.id DESC LIMIT 1) sd ON true
     WHERE c.settlement_id = $1 ORDER BY c.id`,
    [desk.settlement.id],
  );
  const leaves: DecisionLeaf[] = [];
  for (const r of rows) {
    const checks: Record<string, CheckOutcome> = {};
    if (r.system_decision_id) for (const k of await checkResultsOf(desk.pool, Number(r.system_decision_id))) checks[k.id] = k.result;
    leaves.push({
      claim: r.id, outcome: r.outcome, reason: r.reason, rule: r.rule, version: r.decision_version, decidedBy: r.decided_by.startsWith("analyst:") ? "analyst" : "rules",
      amountCents: r.entitlement_cents, evidenceSha256: r.evidence_sha256, findingsSha256: r.findings ? sha256Hex(canonical(r.findings)) : null, checks,
    });
  }
  return leaves;
}

/** The rules in force: the table's and tax table's file hashes (from the deployment) and this settlement's configuration. */
export function rulesOf(desk: Desk): RulesFingerprint | null {
  return desk.rulesFiles ? { ...desk.rulesFiles, settlement: sha256Hex(canonical(desk.settlement)) } : null;
}

/**
 * Freezes the ledger for an approved proposal: the root of every decision, the rules' fingerprint
 * and a drand round DRAND_LEAD_SECONDS ahead. Returns what the payouts' notes carry.
 */
export async function commitLedger(
  desk: Desk,
  a: { proposalId: number; kind: "CLAIMS" | "CY_PRES"; round: number; planHash: Buffer; by: string; now?: Date },
): Promise<{ id: number; digest: string; drandRound: number; root: string }> {
  const rules = rulesOf(desk);
  if (!rules) throw new Error("the rules' fingerprint isn't configured, so the ledger can't be committed");
  const leaves = await decisionLeaves(desk);
  const now = a.now ?? new Date();
  const drandRound = roundAt(new Date(now.getTime() + DRAND_LEAD_SECONDS * 1000));
  const commitment: Commitment = {
    version: LEDGER_VERSION, settlementId: desk.settlement.id, kind: a.kind, round: a.round, planSha256: a.planHash.toString("hex"), root: merkleRoot(leaves),
    leafCount: leaves.length, rules, rulesSha256: rulesSha256(rules), drand: { chain: QUICKNET.hash, round: drandRound }, committedAt: now.toISOString(),
  };
  const digest = commitmentDigest(commitment);
  const id = await desk.pool.connect().then(async (c) => {
    try {
      return await insertCommitment(c, { settlementId: desk.settlement.id, proposalId: a.proposalId, kind: a.kind, round: a.round, root: commitment.root, digest, commitment, leaves, drandRound, by: a.by });
    } finally {
      c.release();
    }
  });
  return { id, digest, drandRound, root: commitment.root };
}

/** The note on each payout: PayPal's own record then names the ledger, the drand round and the plan. */
export const ledgerNote = (settlementId: string, kind: string, round: number, ledger: { digest: string; drandRound: number }, planHash: Buffer) =>
  `Proof of Claim ${settlementId} ${kind.toLowerCase()} round ${round}, ledger sha256:${ledger.digest}, drand quicknet round ${ledger.drandRound}, plan sha256:${planHash.toString("hex")}`;

/**
 * For each commitment whose drand round should be out: fetch it from drand's relays, verify it
 * against quicknet's key, and record it with the audit sample it picks. Unpublished rounds wait.
 */
export async function recordBeacons(pool: Pool, opt: { now?: Date; fetchFn?: typeof fetch } = {}): Promise<number> {
  let done = 0;
  for (const { id, drandRound } of await commitmentsAwaitingBeacon(pool, roundAt(opt.now ?? new Date()))) {
    const beacon = await fetchBeacon(drandRound, opt.fetchFn);
    if (!beacon) continue;
    const c = await getCommitment(pool, id);
    if (!c) continue;
    const leaves = c.leaves as DecisionLeaf[];
    await recordBeacon(pool, id, beacon, auditSample(leaves, c.root, beacon.randomness, Math.min(SAMPLE_SIZE, leaves.length)));
    done++;
  }
  return done;
}

export { SAMPLE_SIZE };
