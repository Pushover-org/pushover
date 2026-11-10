// The claims desk: files a claim, has the examiner read its evidence, runs the checks and the
// decision table, and records a person's review. The live system's version of the eval's arm C
// (packages/eval/src/pipeline.ts), reading everything it needs from the database.
//
// The model only reads. Code decides (decision table v1) and nothing here calls PayPal.
import { createHash, randomBytes } from "node:crypto";
import { decide, DECISION_VERSION, FindingsSchema, type CheckResult, type Decision, type ExaminerStatus, type Findings, type Settlement } from "@proofofclaim/claims";
import { hashRotations, ipPrefixKey, runChecks, unitsEvidenced, type CheckConfig, type TaxTable } from "@proofofclaim/checks";
import {
  allArrivals, allDeclarations, checkResultsOf, earlierIdentities, earlierImageHashes, earlierReceiptDetails, getClaim, getEvidence, insertClaim, insertEvidence, insertFindings,
  latestDecision, latestFindings, moveClaim, recordAnalystDecision, recordDecision, withSettlementLock, withTransaction, type ClaimRow, type Pool, type PoolClient,
} from "@proofofclaim/db";
import { sniffImageType, type ExamineInput, type ExamineResult } from "@proofofclaim/examiner";

export interface Desk {
  pool: Pool;
  settlement: Settlement;
  table: TaxTable;
  config: CheckConfig;
  /** Key for hashing network prefixes (C9), so no raw IP address is stored. */
  networkSecret: string;
  /** Reads one piece of evidence. Null when no examiner is configured: proof claims then go to a person. */
  read: ((input: ExamineInput) => Promise<ExamineResult>) | null;
}

export interface FileClaimInput {
  tier: "proof" | "no_proof";
  unitsClaimed: number;
  name: string;
  email: string;
  addressLine: string;
  city: string;
  state: string;
  zip: string;
  declaration: string;
  ip: string | null;
  image: Uint8Array | null;
  paypal: { payerId: string; verified: boolean; emailVerified: boolean | null } | null;
  /** For seeding a recorded claim set; a live claim takes the time it arrives. */
  id?: string;
  submittedAt?: Date;
}

/** The claimant gave something the desk can't accept; the message is safe to show them. */
export class ClaimRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaimRejectedError";
  }
}

const newClaimId = () => `poc-${randomBytes(6).toString("hex")}`;

export async function fileClaim(desk: Desk, f: FileClaimInput): Promise<ClaimRow> {
  if (f.tier === "proof" && !f.image) throw new ClaimRejectedError("A claim with proof needs a photo of the receipt.");
  const type = f.image ? sniffImageType(f.image) : null;
  if (f.image && !type) throw new ClaimRejectedError("The receipt must be a JPEG, PNG, GIF or WebP photo.");
  // Hash before the transaction: a photo that can't be hashed still files, and C6 says UNKNOWN.
  const phash = f.image ? await hashRotations(f.image).then((r) => r[0] ?? null, () => null) : null;
  try {
    return await withTransaction(desk.pool, async (c) => {
      const claim = await insertClaim(c, {
        id: f.id ?? newClaimId(), settlementId: desk.settlement.id, tier: f.tier, unitsClaimed: f.unitsClaimed, name: f.name, email: f.email,
        addressLine: f.addressLine, city: f.city, state: f.state, zip: f.zip, declaration: f.declaration,
        ipKey: f.ip ? ipPrefixKey(f.ip, desk.networkSecret) : null, paypal: f.paypal, ...(f.submittedAt ? { submittedAt: f.submittedAt } : {}),
      });
      if (f.image && type) await insertEvidence(c, { claimId: claim.id, contentType: type, bytes: f.image, sha256: createHash("sha256").update(f.image).digest("hex"), phash });
      return claim;
    });
  } catch (err) {
    if (err instanceof Error && /claims_one_per_paypal_account/.test(err.message)) throw new ClaimRejectedError("This PayPal account has already filed a claim in this settlement.");
    throw err;
  }
}

/** Has the examiner read a proof claim's evidence, once. A failed reading is stored too: the table sends it to a person. */
export async function readEvidence(desk: Desk, claimId: string): Promise<void> {
  const claim = await getClaim(desk.pool, claimId);
  if (!claim || claim.tier !== "proof" || claim.status !== "SUBMITTED") return;
  if (await latestFindings(desk.pool, claimId)) return;
  const [evidence] = await getEvidence(desk.pool, claimId);
  if (!evidence || !desk.read) {
    await insertFindings(desk.pool, { claimId, model: "none", status: "NOT_RUN", findings: null, costUsd: 0 });
  } else {
    const r = await desk.read({ image: evidence.bytes, declaration: claim.declaration, products: desk.settlement.products });
    await insertFindings(desk.pool, { claimId, model: r.model, status: r.status, findings: r.status === "OK" ? r.findings : null, costUsd: r.costUsd });
  }
  await moveClaim(desk.pool, claimId, "SUBMITTED", "EXAMINED");
}

export interface DeskDecision {
  decision: Decision;
  checks: CheckResult[];
}

/**
 * Checks and decides a claim under the settlement lock, so two copies filed together can't both
 * pass C8. With `recheck`, an approved claim is checked again and recorded only if it now fails.
 */
export async function decideClaim(desk: Desk, claimId: string, opt: { recheck?: boolean } = {}): Promise<DeskDecision | null> {
  const stored = await latestFindings(desk.pool, claimId);
  const parsed = stored?.status === "OK" ? FindingsSchema.safeParse(stored.findings) : null;
  const findings: Findings | null = parsed?.success ? parsed.data : null;
  const status: ExaminerStatus = stored ? (stored.status === "OK" && !findings ? "INVALID" : stored.status) : "NOT_RUN";
  const [evidence] = await getEvidence(desk.pool, claimId);
  const rotations = evidence ? await hashRotations(evidence.bytes).catch(() => null) : null;

  return withSettlementLock(desk.pool, desk.settlement.id, async (tx) => {
    const c = await getClaim(tx, claimId);
    const open = opt.recheck ? ["APPROVE"] : ["SUBMITTED", "EXAMINED", "NEED_MORE"];
    if (!c || !open.includes(c.status)) return null;
    const proof = c.tier === "proof";
    const lookup = async <T>(q: () => Promise<T>): Promise<T | null> => q().catch(() => null);
    const { checks, unitsEvidenced: units } = runChecks(
      { claimId: c.id, tier: c.tier, unitsClaimed: c.unitsClaimed, claimantState: c.state, identity: { name: c.name, email: c.email, addressLine: c.addressLine, zip: c.zip }, declaration: c.declaration },
      {
        settlement: desk.settlement, table: desk.table, config: desk.config, findings: proof ? findings : null, imageRotations: proof ? rotations : null,
        earlierImages: await lookup(() => earlierImageHashes(tx, c.settlementId, c.seq)),
        earlierReceipts: await lookup(() => earlierReceiptDetails(tx, c.settlementId, c.seq)),
        earlierIdentities: await lookup(() => earlierIdentities(tx, c.settlementId, c.seq)),
        declarations: await lookup(() => allDeclarations(tx, c.settlementId)),
        arrivals: await lookup(() => allArrivals(tx, c.settlementId)),
      },
    );
    const decision = decide(desk.settlement, {
      tier: c.tier, unitsClaimed: c.unitsClaimed, unitsEvidenced: units, checks,
      // As in the eval's arm C: a no-proof claim has nothing to read, and the table knows it.
      examiner: proof ? { status, ...(findings ? { confidence: findings.confidence } : {}) } : { status: "NOT_RUN" },
    });
    if (opt.recheck && decision.outcome === "APPROVE") return { decision, checks };
    if (opt.recheck) {
      const last = await latestDecision(tx, c.id);
      if (last?.decidedBy.startsWith("analyst:")) {
        // A person approved it after seeing the system's checks, so the re-check doesn't undo that
        // for the same reasons. Only a cluster that formed since can pull it back.
        const held = await clusterFormedSince(tx, c.id, last.id, decision.checks, checks);
        if (!held) return null;
        await recordDecision(tx, { claimId: c.id, from: c.status, decision: held, checks, decidedBy: "system" });
        return { decision: held, checks };
      }
    }
    await recordDecision(tx, { claimId: c.id, from: c.status, decision, checks, decidedBy: "system" });
    return { decision, checks };
  });
}

/**
 * C7 (template text) and C9 (network velocity) are the only checks that look at claims filed
 * later; C6, C8 and C12 compare only with earlier ones. So for a claim a person approved, the
 * re-check holds it again only if C7 or C9 fails now and didn't in the system decision the person
 * reviewed. The hold is decision-v1's own rule 3.
 */
async function clusterFormedSince(tx: PoolClient, claimId: string, analystDecisionId: number, seen: Decision["checks"], now: CheckResult[]): Promise<Decision | null> {
  const { rows } = await tx.query<{ id: string }>("SELECT id FROM decisions WHERE claim_id = $1 AND decided_by = 'system' AND id < $2 ORDER BY id DESC LIMIT 1", [claimId, analystDecisionId]);
  const reviewed = new Map((rows[0] ? await checkResultsOf(tx, Number(rows[0].id)) : []).map((k) => [k.id, k.result]));
  for (const id of ["C7", "C9"] as const) {
    if (now.find((k) => k.id === id)?.result === "FAIL" && reviewed.get(id) !== "FAIL") {
      return { version: DECISION_VERSION, rule: 3, outcome: "REVIEW", reason: id === "C7" ? "TEMPLATE_CLUSTER" : "VELOCITY_CLUSTER", check: id, checks: seen };
    }
  }
  return null;
}

/** A person's decision on a claim in REVIEW. An approval pays what the evidence supports, never more than claimed. */
export async function reviewClaim(desk: Desk, claimId: string, outcome: "APPROVE" | "DENY", analyst: string): Promise<void> {
  const s = desk.settlement;
  const stored = await latestFindings(desk.pool, claimId);
  const parsed = stored?.status === "OK" ? FindingsSchema.safeParse(stored.findings) : null;
  await withSettlementLock(desk.pool, s.id, async (tx) => {
    const c = await getClaim(tx, claimId);
    if (!c || c.status !== "REVIEW") throw new ClaimRejectedError("Only a claim waiting for review can be reviewed.");
    if (outcome === "DENY") {
      await recordAnalystDecision(tx, { claimId, outcome, analyst, reason: "ANALYST_DENIED" });
      return;
    }
    let units = 1;
    let cents = s.tiers.noProof.flatCents;
    if (c.tier === "proof") {
      const evidenced = parsed?.success ? unitsEvidenced(parsed.data, s) : c.unitsClaimed;
      units = Math.max(1, Math.min(c.unitsClaimed, s.tiers.proof.maxUnits, evidenced));
      cents = units * s.tiers.proof.unitCents;
    }
    await recordAnalystDecision(tx, { claimId, outcome, analyst, reason: "ANALYST_APPROVED", units, entitlementCents: cents });
  });
}

/** File, read and decide in one go: what the claim form does. */
export async function submitClaim(desk: Desk, f: FileClaimInput): Promise<{ claim: ClaimRow; result: DeskDecision | null }> {
  const claim = await fileClaim(desk, f);
  await readEvidence(desk, claim.id);
  const result = await decideClaim(desk, claim.id);
  return { claim, result };
}

export { latestDecision };
