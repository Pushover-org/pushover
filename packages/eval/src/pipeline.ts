// Arm C (spec §1.4): findings → checks → decision table, claim by claim in filing order, the way
// the live system runs them (one at a time per settlement, R6). The eval runner (R9) feeds it the
// examiner's real readings; test/pipeline-vs-oracle.test.ts feeds it perfect ones.
import { decide, type CheckResult, type Decision, type ExaminerStatus, type Findings, type Settlement } from "@proofofclaim/claims";
import { ipPrefixKey, runChecks, type CheckConfig, type EarlierIdentity, type ImageHash, type ReceiptDetails, type TaxTable } from "@proofofclaim/checks";
import type { Claim } from "./corpus/schema.ts";

export interface Reading {
  status: ExaminerStatus;
  findings: Findings | null;
}

export interface ArmCResult {
  decision: Decision;
  checks: CheckResult[];
}

export interface ArmCInput {
  /** Every claim filed in the settlement. Clusters (C7, C9) are found across all of them. */
  claims: Claim[];
  /** The claims to read and decide (a slice). Default: all. Only these count as earlier claims. */
  decide?: Set<string>;
  /** Readings for proof claims; a proof claim with none counts as NOT_RUN. */
  readings: Map<string, Reading>;
  /** hashRotations of each proof claim's image; null if hashing failed. */
  hashes: Map<string, string[] | null>;
  settlement: Settlement;
  table: TaxTable;
  config: CheckConfig;
  /** Key for hashing network prefixes (C9), so no raw address is kept. */
  networkSecret: string;
}

export function runArmC(input: ArmCInput): Map<string, ArmCResult> {
  const ordered = [...input.claims].sort((a, b) => a.seq - b.seq);
  const declarations = ordered.map((c) => ({ claimId: c.id, text: c.declaration }));
  const arrivals = ordered.map((c) => ({ claimId: c.id, ipKey: ipPrefixKey(c.network.ip, input.networkSecret), atMs: Date.parse(c.network.at) }));
  const out = new Map<string, ArmCResult>();
  const images: ImageHash[] = [];
  const receipts: ReceiptDetails[] = [];
  const identities: EarlierIdentity[] = [];

  for (const c of ordered) {
    if (input.decide && !input.decide.has(c.id)) continue;
    const proof = c.tier === "proof";
    const reading = proof ? (input.readings.get(c.id) ?? { status: "NOT_RUN" as const, findings: null }) : null;
    const findings = reading?.status === "OK" ? reading.findings : null;
    const rotations = proof ? (input.hashes.get(c.id) ?? null) : null;
    const identity = { name: c.claimant.name, email: c.claimant.email, addressLine: c.claimant.address_line, zip: c.claimant.zip };

    const { checks, unitsEvidenced } = runChecks(
      { claimId: c.id, tier: c.tier, unitsClaimed: c.units_claimed, claimantState: c.claimant.state, identity, declaration: c.declaration },
      {
        settlement: input.settlement, table: input.table, config: input.config, findings, imageRotations: rotations,
        earlierImages: [...images], earlierReceipts: [...receipts], earlierIdentities: [...identities], declarations, arrivals,
      },
    );
    const decision = decide(input.settlement, {
      tier: c.tier, unitsClaimed: c.units_claimed, unitsEvidenced, checks,
      examiner: { status: reading?.status ?? "NOT_RUN", ...(findings ? { confidence: findings.confidence } : {}) },
    });
    out.set(c.id, { decision, checks });

    if (rotations?.[0]) images.push({ claimId: c.id, hash: rotations[0] });
    if (findings) receipts.push({ claimId: c.id, merchant: findings.merchant_name, date: findings.purchase_date, totalCents: findings.total_cents });
    identities.push({ ...identity, claimId: c.id, status: decision.outcome === "APPROVE" ? "APPROVED" : decision.outcome === "DENY" ? "CLOSED" : "PENDING" });
  }
  return out;
}
