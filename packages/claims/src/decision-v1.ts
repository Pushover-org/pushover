// Decision table v1 (Proof of Claim spec §4.4, with the corrections in docs/architecture.md →
// Decision table v1). Pure: no I/O, no clock, no model. The examiner's own approve/deny
// recommendation is not an input, so it cannot influence a decision.
import { CHECKS_FOR_TIER, type CheckId, type CheckOutcome, type CheckResult, type Tier } from "./checks.ts";
import { DENY_REASON, DOCUMENT_REQUEST, type DenyCheckId, type ReasonCode } from "./reasons.ts";
import type { Settlement } from "./settlement.ts";

export const DECISION_VERSION = "decision-v1";

export type ExaminerStatus = "OK" | "INVALID" | "REFUSED" | "NOT_RUN";

export interface DecisionInput {
  tier: Tier;
  /** Units the claimant asked for (proof tier). */
  unitsClaimed: number;
  /** Proof tier: qualifying units the evidence shows. The claim never pays for more than this. */
  unitsEvidenced?: number | undefined;
  /** How the examiner run went; only its findings feed the checks. */
  examiner: { status: ExaminerStatus; confidence?: "high" | "medium" | "low" };
  /** Results from packages/checks. A missing applicable check counts as UNKNOWN. */
  checks: CheckResult[];
}

interface Common {
  version: typeof DECISION_VERSION;
  /** The rule in decision-v1 that matched, for the audit trail. */
  rule: number;
  reason: ReasonCode;
  /** The check results the decision saw, applicable checks only, missing ones as UNKNOWN. */
  checks: Record<string, CheckOutcome>;
}

export type Decision =
  | (Common & { outcome: "APPROVE"; tier: Tier; units: number; unitsClaimed: number; entitlementCents: number })
  | (Common & { outcome: "DENY"; check: CheckId })
  | (Common & { outcome: "NEED_MORE"; check: CheckId; documentRequest: string })
  | (Common & { outcome: "REVIEW"; check?: CheckId });

const DENY_ON_EVIDENCE: readonly DenyCheckId[] = ["C1", "C2", "C3", "C4"];

export function decide(settlement: Settlement, input: DecisionInput): Decision {
  if (!Number.isInteger(input.unitsClaimed) || input.unitsClaimed < 1) throw new Error(`unitsClaimed must be a positive integer`);
  const applicable = CHECKS_FOR_TIER[input.tier];
  const results = new Map<CheckId, CheckOutcome>();
  for (const c of input.checks) {
    if (results.has(c.id)) throw new Error(`check ${c.id} given twice`);
    results.set(c.id, c.result);
  }
  const seen: Record<string, CheckOutcome> = {};
  for (const id of applicable) seen[id] = results.get(id) ?? "UNKNOWN";
  const r = (id: CheckId): CheckOutcome => seen[id] ?? "UNKNOWN";
  const base = { version: DECISION_VERSION, checks: seen } as const;
  const evidence = input.tier === "proof";

  // 0. The evidence reading itself failed (spec §4.2): never approve, a person looks.
  if (evidence) {
    const s = input.examiner.status;
    if (s === "INVALID") return { ...base, outcome: "REVIEW", rule: 0, reason: "EXAMINER_INVALID" };
    if (s === "REFUSED") return { ...base, outcome: "REVIEW", rule: 0, reason: "EXAMINER_REFUSED" };
    if (s === "NOT_RUN") return { ...base, outcome: "REVIEW", rule: 0, reason: "EXAMINER_NOT_RUN" };
    // A reading the examiner doubts must not deny anyone: a misread number would fail a check
    // below. So this comes before every denial, and a person looks.
    if (input.examiner.confidence === "low") return { ...base, outcome: "REVIEW", rule: 0, reason: "LOW_CONFIDENCE" };
  }

  // 1. The evidence contradicts the settlement's rules; geography applies to every claim.
  for (const id of [...(evidence ? DENY_ON_EVIDENCE : []), "C5" as const]) {
    if (r(id) === "FAIL") return { ...base, outcome: "DENY", rule: 1, reason: DENY_REASON[id], check: id };
  }

  // 2. Duplicates.
  for (const id of [...(evidence ? ["C6" as const] : []), "C8" as const]) {
    if (r(id) === "FAIL") return { ...base, outcome: "DENY", rule: 2, reason: DENY_REASON[id], check: id };
  }

  // 3. Clusters go to a person, who can deny the whole cluster.
  if (r("C7") === "FAIL") return { ...base, outcome: "REVIEW", rule: 3, reason: "TEMPLATE_CLUSTER", check: "C7" };
  if (r("C9") === "FAIL") return { ...base, outcome: "REVIEW", rule: 3, reason: "VELOCITY_CLUSTER", check: "C9" };
  // Same merchant, date and total as another claim. This rests on what the model read, so it
  // never denies; only a perceptual-hash match (C6) does.
  if (evidence && r("C12") === "FAIL") return { ...base, outcome: "REVIEW", rule: 3, reason: "REPEAT_RECEIPT_DETAILS", check: "C12" };

  // 4. Signs of editing. Never a denial on its own.
  if (evidence && r("C10") === "FAIL") return { ...base, outcome: "REVIEW", rule: 4, reason: "VISUAL_ANOMALY", check: "C10" };

  // 5. Unknown, and the claimant can fix it: ask for the specific document.
  for (const id of applicable) {
    const request = DOCUMENT_REQUEST[id];
    if (request && r(id) === "UNKNOWN") return { ...base, outcome: "NEED_MORE", rule: 5, reason: "NEED_DOCUMENT", check: id, documentRequest: request };
  }

  // 6. Unknown on our side (tax table gap, image hash, dedupe or velocity lookup failed):
  //    unknown is never a pass, so a person decides.
  for (const id of applicable) {
    if (r(id) === "UNKNOWN") return { ...base, outcome: "REVIEW", rule: 6, reason: id === "C4" ? "TAX_UNCONFIRMED" : "CHECK_UNVERIFIED", check: id };
  }

  // 7. No-proof tier: the flat amount, one claim per person (C8 enforced above).
  if (!evidence) {
    return { ...base, outcome: "APPROVE", rule: 7, reason: "APPROVED_NO_PROOF", tier: "no_proof", units: 1, unitsClaimed: input.unitsClaimed, entitlementCents: settlement.tiers.noProof.flatCents };
  }

  // 8. Proof tier: units capped at what the evidence shows and at the tier maximum (C11 caps,
  //    it never denies). No evidenced units means nothing can be paid yet, so a person looks.
  const { unitCents, maxUnits } = settlement.tiers.proof;
  const evidenced = input.unitsEvidenced;
  if (evidenced === undefined || !Number.isInteger(evidenced) || evidenced < 1) return { ...base, outcome: "REVIEW", rule: 6, reason: "CHECK_UNVERIFIED", check: "C11" };
  const units = Math.min(input.unitsClaimed, evidenced, maxUnits);
  return { ...base, outcome: "APPROVE", rule: 8, reason: "APPROVED_PROOF", tier: "proof", units, unitsClaimed: input.unitsClaimed, entitlementCents: units * unitCents };
}
