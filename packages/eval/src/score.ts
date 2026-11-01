// Scoring for the claims eval (spec §5.3) and the pre-registered gate (docs/methodology.md →
// claims-v1). Pure: it takes each claim's three arm outcomes and returns the numbers.
import { allocate } from "@pushover/distribute";
import type { Claim, ReceiptTruth } from "./corpus/schema.ts";

export interface SettlementTerms {
  fundCents: number;
  adminReserveCents: number;
  proof: { unitCents: number; maxUnits: number };
  noProofCents: number;
}

export type Outcome = "APPROVE" | "DENY" | "NEED_MORE" | "REVIEW";

export interface Scored {
  claim: Claim;
  truth: ReceiptTruth | null;
  armC: { outcome: Outcome; reason: string; entitlementCents: number };
  /** Arm B's answer; null when the call failed, and an undecided claim is not paid. */
  armB: { decision: "approve" | "deny" | null; units: number };
  /** The examiner's own view (proof claims), logged only; used for arm C's worst case. */
  modelRecommendation: "approve" | "deny" | null;
}

/** 95% Wilson score interval for k of n. */
export function wilson(k: number, n: number): { rate: number; low: number; high: number } {
  if (n === 0) return { rate: 0, low: 0, high: 1 };
  const z = 1.959963984540054;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { rate: p, low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

const drinkUnits = (r: ReceiptTruth) => r.lines.filter((l) => l.kind === "nonalcoholic_drink").reduce((n, l) => n + Math.floor(l.qty ?? 1), 0);

/** What paying the claim as filed costs: arm A, and any arm that approves without checking. */
export function claimedCents(c: Claim, t: SettlementTerms): number {
  return c.tier === "no_proof" ? t.noProofCents : Math.min(c.units_claimed, t.proof.maxUnits) * t.proof.unitCents;
}

/** A perfect analyst resolving a REVIEW: pays an honest claim what its evidence supports, nothing else. */
export function analystCents(s: Scored, t: SettlementTerms): number {
  if (s.claim.truth !== "honest") return 0;
  if (s.claim.tier === "no_proof") return t.noProofCents;
  if (!s.truth) return 0;
  return Math.min(s.claim.units_claimed, drinkUnits(s.truth), t.proof.maxUnits) * t.proof.unitCents;
}

export function armBCents(s: Scored, t: SettlementTerms): number {
  if (s.armB.decision !== "approve") return 0;
  if (s.claim.tier === "no_proof") return t.noProofCents;
  return Math.min(s.armB.units, s.claim.units_claimed, t.proof.maxUnits) * t.proof.unitCents;
}

export function armCCents(s: Scored, t: SettlementTerms, review: "label" | "model"): number {
  if (s.armC.outcome === "APPROVE") return s.armC.entitlementCents;
  if (s.armC.outcome !== "REVIEW") return 0;
  if (review === "label") return analystCents(s, t);
  const view = s.claim.tier === "proof" ? (s.modelRecommendation ?? s.armB.decision) : s.armB.decision;
  return view === "approve" ? claimedCents(s.claim, t) : 0;
}

export interface ArmNumbers {
  fraudCents: number;
  ineligibleCents: number;
  honestPaidCents: number;
  honestWronglyDenied: { k: number; n: number; rate: number; low: number; high: number };
  /** Mean payout per honest claim after the pro-rata cut; unpaid claims count as 0. */
  honestAverageCheckCents: number;
}

function armNumbers(rows: Scored[], pay: (s: Scored) => number, denied: (s: Scored) => boolean, fund: { fundCents: number; adminReserveCents: number }): ArmNumbers {
  const honest = rows.filter((r) => r.claim.truth === "honest");
  const sum = (xs: Scored[]) => xs.reduce((a, r) => a + pay(r), 0);
  const paid = rows.filter((r) => pay(r) > 0);
  const alloc = allocate({ ...fund, feePerItemCents: 25, entitlements: paid.map((r) => ({ claimId: r.claim.id, entitlementCents: pay(r) })) });
  const out = new Map(alloc.payouts.map((p) => [p.claimId, p.payoutCents]));
  const k = honest.filter(denied).length;
  return {
    fraudCents: sum(rows.filter((r) => r.claim.truth === "fraud")),
    ineligibleCents: sum(rows.filter((r) => r.claim.truth === "ineligible")),
    honestPaidCents: sum(honest),
    honestWronglyDenied: { k, n: honest.length, ...wilson(k, honest.length) },
    honestAverageCheckCents: honest.length ? Math.round(honest.reduce((a, r) => a + (out.get(r.claim.id) ?? 0), 0) / honest.length) : 0,
  };
}

export interface Score {
  n: number;
  honest: number;
  fraud: number;
  ineligible: number;
  /** The fund scaled to the slice's share of the full set, so dilution is comparable. */
  fund: { fundCents: number; adminReserveCents: number };
  armA: ArmNumbers;
  armB: ArmNumbers & { undecided: number };
  armC: ArmNumbers & {
    honestReview: number;
    honestNeedMore: number;
    honestWorkload: { k: number; n: number; rate: number; low: number; high: number };
    fraudCentsWorstCase: number;
    outcomeMatchesExpected: number;
  };
  gate: { fraudRatio: number | null; fraudOk: boolean; deniedOk: boolean; workloadOk: boolean; go: boolean };
}

export function score(rows: Scored[], t: SettlementTerms, sliceShare: number): Score {
  const fund = { fundCents: Math.floor(t.fundCents * sliceShare), adminReserveCents: Math.floor(t.adminReserveCents * sliceShare) };
  const honest = rows.filter((r) => r.claim.truth === "honest");
  const a = armNumbers(rows, (r) => claimedCents(r.claim, t), () => false, fund);
  const b = armNumbers(rows, (r) => armBCents(r, t), (r) => r.armB.decision !== "approve", fund);
  const c = armNumbers(rows, (r) => armCCents(r, t, "label"), (r) => r.armC.outcome === "DENY", fund);
  const worst = rows.filter((r) => r.claim.truth === "fraud").reduce((s, r) => s + armCCents(r, t, "model"), 0);
  const review = honest.filter((r) => r.armC.outcome === "REVIEW").length;
  const needMore = honest.filter((r) => r.armC.outcome === "NEED_MORE").length;
  const workload = { k: review + needMore, n: honest.length, ...wilson(review + needMore, honest.length) };
  const fraudRatio = a.fraudCents === 0 ? null : c.fraudCents / a.fraudCents;
  const fraudOk = fraudRatio !== null && fraudRatio <= 0.25;
  const deniedOk = c.honestWronglyDenied.rate <= 0.1;
  const workloadOk = workload.rate <= 0.3;
  return {
    n: rows.length, honest: honest.length, fraud: rows.filter((r) => r.claim.truth === "fraud").length, ineligible: rows.filter((r) => r.claim.truth === "ineligible").length,
    fund, armA: a, armB: { ...b, undecided: rows.filter((r) => r.armB.decision === null).length },
    armC: { ...c, honestReview: review, honestNeedMore: needMore, honestWorkload: workload, fraudCentsWorstCase: worst, outcomeMatchesExpected: rows.filter((r) => r.armC.outcome === r.claim.expected.outcome).length },
    gate: { fraudRatio, fraudOk, deniedOk, workloadOk, go: fraudOk && deniedOk && workloadOk },
  };
}
