// Proof of Claim queries. Bigints arrive from pg as strings; toNumber refuses anything a
// JavaScript number could not hold exactly, because money must never round silently.
import type { CheckResult, Decision, Findings, Settlement } from "@proofofclaim/claims";
import type { Pool, PoolClient, Queryable } from "../pool.ts";
import { withTransaction } from "../pool.ts";

function toNumber(v: string | number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isSafeInteger(n)) throw new Error(`value ${v} does not fit a safe integer`);
  return n;
}

export type ClaimState = "SUBMITTED" | "EXAMINED" | "APPROVE" | "DENY" | "NEED_MORE" | "REVIEW" | "SCHEDULED" | "PAID" | "UNCLAIMED" | "RETURNED" | "FAILED" | "CY_PRES_ELIGIBLE" | "UNVERIFIED";

/** Spec §4.6. A person or a cluster re-check can move a decided claim; money states only go forward. */
const NEXT: Record<ClaimState, readonly ClaimState[]> = {
  SUBMITTED: ["EXAMINED", "APPROVE", "DENY", "NEED_MORE", "REVIEW"],
  EXAMINED: ["APPROVE", "DENY", "NEED_MORE", "REVIEW"],
  NEED_MORE: ["EXAMINED", "APPROVE", "DENY", "NEED_MORE", "REVIEW"],
  REVIEW: ["APPROVE", "DENY", "REVIEW"],
  APPROVE: ["SCHEDULED", "REVIEW", "DENY"], // the cluster re-check before Distribute can hold it
  DENY: ["REVIEW"],
  SCHEDULED: ["PAID", "UNCLAIMED", "FAILED", "UNVERIFIED"],
  UNCLAIMED: ["PAID", "RETURNED", "UNVERIFIED"],
  RETURNED: ["CY_PRES_ELIGIBLE"],
  FAILED: ["CY_PRES_ELIGIBLE"],
  UNVERIFIED: ["PAID", "UNCLAIMED", "RETURNED", "FAILED"],
  PAID: ["UNVERIFIED"],
  CY_PRES_ELIGIBLE: [],
};

export function canMoveClaim(from: ClaimState, to: ClaimState): boolean {
  return NEXT[from].includes(to);
}

export async function appendAudit(db: Queryable, a: { actor: string; action: string; subject: string; detail: unknown }): Promise<void> {
  await db.query("INSERT INTO audit_log (actor, action, subject, detail) VALUES ($1, $2, $3, $4)", [a.actor, a.action, a.subject, JSON.stringify(a.detail)]);
}

export async function insertSettlement(pool: Pool, s: Settlement): Promise<void> {
  await withTransaction(pool, async (c) => {
    await c.query("INSERT INTO settlements (id, name, config, fund_cents) VALUES ($1, $2, $3, $4)", [s.id, s.name, JSON.stringify(s), s.fundCents]);
    for (const p of s.products) {
      await c.query("INSERT INTO settlement_products (settlement_id, product_id, name, description) VALUES ($1, $2, $3, $4)", [s.id, p.id, p.name, p.description]);
    }
  });
}

/** The raw stored config. The caller runs it through parseSettlement. */
export async function getSettlementConfig(db: Queryable, id: string): Promise<unknown | null> {
  const { rows } = await db.query<{ config: unknown }>("SELECT config FROM settlements WHERE id = $1", [id]);
  return rows[0]?.config ?? null;
}

export interface NewClaim {
  id: string;
  settlementId: string;
  tier: "proof" | "no_proof";
  unitsClaimed: number;
  name: string;
  email: string;
  addressLine: string;
  city: string;
  state: string;
  zip: string;
  declaration: string;
  ipKey: string | null;
  submittedAt?: Date;
  /** Set when the claimant logged in with PayPal (migration 0005). */
  paypal?: { payerId: string; verified: boolean; emailVerified: boolean | null } | null;
}

export interface ClaimRow extends Omit<NewClaim, "submittedAt" | "paypal"> {
  paypal: { payerId: string; verified: boolean; emailVerified: boolean | null } | null;
  seq: number;
  status: ClaimState;
  submittedAt: Date;
}

interface RawClaim {
  id: string; settlement_id: string; seq: string; tier: "proof" | "no_proof"; units_claimed: number; claimant_name: string; payout_email: string;
  address_line: string; city: string; state: string; zip: string; declaration: string; ip_key: string | null; status: ClaimState; submitted_at: Date;
  paypal_payer_id: string | null; paypal_verified: boolean | null; paypal_email_verified: boolean | null;
}
const claimFrom = (r: RawClaim): ClaimRow => ({
  id: r.id, settlementId: r.settlement_id, seq: toNumber(r.seq), tier: r.tier, unitsClaimed: r.units_claimed, name: r.claimant_name, email: r.payout_email,
  addressLine: r.address_line, city: r.city, state: r.state, zip: r.zip, declaration: r.declaration, ipKey: r.ip_key, status: r.status, submittedAt: r.submitted_at,
  paypal: r.paypal_payer_id === null ? null : { payerId: r.paypal_payer_id, verified: r.paypal_verified === true, emailVerified: r.paypal_email_verified },
});

export async function insertClaim(db: Queryable, c: NewClaim): Promise<ClaimRow> {
  const { rows } = await db.query<RawClaim>(
    `INSERT INTO claims (id, settlement_id, tier, units_claimed, claimant_name, payout_email, address_line, city, state, zip, declaration, ip_key, submitted_at,
       paypal_payer_id, paypal_verified, paypal_email_verified)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, COALESCE($13, now()), $14, $15, $16) RETURNING *`,
    [c.id, c.settlementId, c.tier, c.unitsClaimed, c.name, c.email, c.addressLine, c.city, c.state, c.zip, c.declaration, c.ipKey, c.submittedAt ?? null,
      c.paypal?.payerId ?? null, c.paypal?.verified ?? null, c.paypal?.emailVerified ?? null],
  );
  return claimFrom(rows[0] as RawClaim);
}

export async function getClaim(db: Queryable, id: string): Promise<ClaimRow | null> {
  const { rows } = await db.query<RawClaim>("SELECT * FROM claims WHERE id = $1", [id]);
  return rows[0] ? claimFrom(rows[0]) : null;
}

export async function listClaims(db: Queryable, settlementId: string, status?: ClaimState): Promise<ClaimRow[]> {
  const { rows } = await db.query<RawClaim>(
    `SELECT * FROM claims WHERE settlement_id = $1 AND ($2::claim_state IS NULL OR status = $2) ORDER BY seq`,
    [settlementId, status ?? null],
  );
  return rows.map(claimFrom);
}

/** Moves a claim only along a legal step, and only if nobody else has moved it first. */
export async function moveClaim(db: Queryable, id: string, from: ClaimState, to: ClaimState): Promise<void> {
  if (!canMoveClaim(from, to)) throw new Error(`claim ${id} cannot go from ${from} to ${to}`);
  const res = await db.query("UPDATE claims SET status = $3 WHERE id = $1 AND status = $2", [id, from, to]);
  if (res.rowCount !== 1) throw new Error(`claim ${id} is not in state ${from}`);
}

export async function insertEvidence(db: Queryable, e: { claimId: string; contentType: string; bytes: Uint8Array; sha256: string; phash: string | null }): Promise<void> {
  await db.query("INSERT INTO claim_evidence (claim_id, content_type, bytes, sha256, phash) VALUES ($1, $2, $3, $4, $5)", [e.claimId, e.contentType, Buffer.from(e.bytes), e.sha256, e.phash]);
}

export async function getEvidence(db: Queryable, claimId: string): Promise<{ contentType: string; bytes: Buffer; sha256: string; phash: string | null }[]> {
  const { rows } = await db.query<{ content_type: string; bytes: Buffer; sha256: string; phash: string | null }>("SELECT content_type, bytes, sha256, phash FROM claim_evidence WHERE claim_id = $1 ORDER BY id", [claimId]);
  return rows.map((r) => ({ contentType: r.content_type, bytes: r.bytes, sha256: r.sha256, phash: r.phash }));
}

export async function insertFindings(db: Queryable, f: { claimId: string; model: string; status: "OK" | "INVALID" | "REFUSED" | "NOT_RUN"; findings: Findings | null; costUsd: number }): Promise<void> {
  await db.query("INSERT INTO findings (claim_id, model, status, findings, cost_usd) VALUES ($1, $2, $3, $4, $5)", [f.claimId, f.model, f.status, f.findings === null ? null : JSON.stringify(f.findings), f.costUsd]);
}

/** The latest reading. The JSON is as stored; the caller validates it with FindingsSchema. */
export async function latestFindings(db: Queryable, claimId: string): Promise<{ status: "OK" | "INVALID" | "REFUSED" | "NOT_RUN"; findings: unknown; model: string } | null> {
  const { rows } = await db.query<{ status: "OK" | "INVALID" | "REFUSED" | "NOT_RUN"; findings: unknown; model: string }>("SELECT status, findings, model FROM findings WHERE claim_id = $1 ORDER BY id DESC LIMIT 1", [claimId]);
  return rows[0] ?? null;
}

// Lookups for the checks. "Earlier" is filing order. A failure throws; the caller passes null to
// packages/checks, which makes the check UNKNOWN.

export async function earlierImageHashes(db: Queryable, settlementId: string, seq: number): Promise<{ claimId: string; hash: string }[]> {
  const { rows } = await db.query<{ claim_id: string; phash: string }>(
    `SELECT e.claim_id, e.phash FROM claim_evidence e JOIN claims c ON c.id = e.claim_id
     WHERE c.settlement_id = $1 AND c.seq < $2 AND e.phash IS NOT NULL ORDER BY c.seq`,
    [settlementId, seq],
  );
  return rows.map((r) => ({ claimId: r.claim_id, hash: r.phash }));
}

export async function earlierReceiptDetails(db: Queryable, settlementId: string, seq: number): Promise<{ claimId: string; merchant: string | null; date: string | null; totalCents: number | null }[]> {
  const { rows } = await db.query<{ claim_id: string; merchant: string | null; date: string | null; total: string | null }>(
    `SELECT DISTINCT ON (f.claim_id) f.claim_id, f.findings->>'merchant_name' AS merchant, f.findings->>'purchase_date' AS date, f.findings->>'total_cents' AS total
     FROM findings f JOIN claims c ON c.id = f.claim_id
     WHERE c.settlement_id = $1 AND c.seq < $2 AND f.status = 'OK' ORDER BY f.claim_id, f.id DESC`,
    [settlementId, seq],
  );
  return rows.map((r) => ({ claimId: r.claim_id, merchant: r.merchant, date: r.date, totalCents: r.total === null ? null : toNumber(r.total) }));
}

const PAID_LIKE: readonly ClaimState[] = ["APPROVE", "SCHEDULED", "PAID", "UNCLAIMED", "UNVERIFIED"];
const CLOSED: readonly ClaimState[] = ["DENY", "RETURNED", "FAILED", "CY_PRES_ELIGIBLE"];

/** C8's view: approved (or further along), closed, or still pending. */
export async function earlierIdentities(db: Queryable, settlementId: string, seq: number): Promise<{ claimId: string; status: "APPROVED" | "PENDING" | "CLOSED"; name: string; email: string; addressLine: string; zip: string }[]> {
  const { rows } = await db.query<RawClaim>("SELECT * FROM claims WHERE settlement_id = $1 AND seq < $2 ORDER BY seq", [settlementId, seq]);
  return rows.map((r) => ({
    claimId: r.id, name: r.claimant_name, email: r.payout_email, addressLine: r.address_line, zip: r.zip,
    status: PAID_LIKE.includes(r.status) ? "APPROVED" : CLOSED.includes(r.status) ? "CLOSED" : "PENDING",
  }));
}

export async function allDeclarations(db: Queryable, settlementId: string): Promise<{ claimId: string; text: string }[]> {
  const { rows } = await db.query<{ id: string; declaration: string }>("SELECT id, declaration FROM claims WHERE settlement_id = $1 ORDER BY seq", [settlementId]);
  return rows.map((r) => ({ claimId: r.id, text: r.declaration }));
}

export async function allArrivals(db: Queryable, settlementId: string): Promise<{ claimId: string; ipKey: string | null; atMs: number }[]> {
  const { rows } = await db.query<{ id: string; ip_key: string | null; submitted_at: Date }>("SELECT id, ip_key, submitted_at FROM claims WHERE settlement_id = $1 ORDER BY seq", [settlementId]);
  return rows.map((r) => ({ claimId: r.id, ipKey: r.ip_key, atMs: r.submitted_at.getTime() }));
}

/**
 * Check-and-decide, one at a time per settlement. Without this, two copies of a claim filed
 * together can each see no approved match and both be approved. The lock ends with the transaction.
 */
export async function withSettlementLock<T>(pool: Pool, settlementId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  return withTransaction(pool, async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`settlement:${settlementId}`]);
    return fn(c);
  });
}

const STATE_FOR: Record<Decision["outcome"], ClaimState> = { APPROVE: "APPROVE", DENY: "DENY", NEED_MORE: "NEED_MORE", REVIEW: "REVIEW" };

/**
 * Stores a decision with its check results, moves the claim, and writes the audit entry. Pass a
 * transaction client so all of it happens or none of it does.
 */
export async function recordDecision(c: PoolClient, a: { claimId: string; from: ClaimState; decision: Decision; checks: CheckResult[]; decidedBy: string }): Promise<number> {
  const d = a.decision;
  const approve = d.outcome === "APPROVE" ? d : null;
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO decisions (claim_id, decision_version, outcome, rule, reason, check_id, document_request, units, units_claimed, entitlement_cents, decided_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [a.claimId, d.version, d.outcome, d.rule, d.reason, "check" in d ? (d.check ?? null) : null, d.outcome === "NEED_MORE" ? d.documentRequest : null,
      approve?.units ?? null, approve?.unitsClaimed ?? null, approve?.entitlementCents ?? null, a.decidedBy],
  );
  const id = toNumber((rows[0] as { id: string }).id);
  for (const r of a.checks) await c.query("INSERT INTO check_results (decision_id, check_id, result, detail) VALUES ($1, $2, $3, $4)", [id, r.id, r.result, r.detail]);
  if (a.from !== STATE_FOR[d.outcome]) await moveClaim(c, a.claimId, a.from, STATE_FOR[d.outcome]);
  await appendAudit(c, { actor: a.decidedBy, action: "decision", subject: a.claimId, detail: { decision_id: id, outcome: d.outcome, reason: d.reason, version: d.version } });
  return id;
}

/** A person's decision on a REVIEW claim. Never carries a rule number. */
export async function recordAnalystDecision(c: PoolClient, a: { claimId: string; outcome: "APPROVE" | "DENY"; analyst: string; reason: "ANALYST_APPROVED" | "ANALYST_DENIED"; units?: number; entitlementCents?: number }): Promise<number> {
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO decisions (claim_id, decision_version, outcome, rule, reason, units, entitlement_cents, decided_by)
     VALUES ($1, 'decision-v1', $2, NULL, $3, $4, $5, $6) RETURNING id`,
    [a.claimId, a.outcome, a.reason, a.units ?? null, a.entitlementCents ?? null, `analyst:${a.analyst}`],
  );
  const id = toNumber((rows[0] as { id: string }).id);
  await moveClaim(c, a.claimId, "REVIEW", a.outcome);
  await appendAudit(c, { actor: `analyst:${a.analyst}`, action: "review", subject: a.claimId, detail: { decision_id: id, outcome: a.outcome } });
  return id;
}

export async function latestDecision(db: Queryable, claimId: string): Promise<{ id: number; outcome: Decision["outcome"]; reason: string; rule: number | null; units: number | null; entitlementCents: number | null; decidedBy: string } | null> {
  const { rows } = await db.query<{ id: string; outcome: Decision["outcome"]; reason: string; rule: number | null; units: number | null; entitlement_cents: number | null; decided_by: string }>(
    "SELECT id, outcome, reason, rule, units, entitlement_cents, decided_by FROM decisions WHERE claim_id = $1 ORDER BY id DESC LIMIT 1", [claimId]);
  const r = rows[0];
  return r ? { id: toNumber(r.id), outcome: r.outcome, reason: r.reason, rule: r.rule, units: r.units, entitlementCents: r.entitlement_cents, decidedBy: r.decided_by } : null;
}

export async function checkResultsOf(db: Queryable, decisionId: number): Promise<CheckResult[]> {
  const { rows } = await db.query<{ check_id: CheckResult["id"]; result: CheckResult["result"]; detail: string }>("SELECT check_id, result, detail FROM check_results WHERE decision_id = $1 ORDER BY check_id", [decisionId]);
  return rows.map((r) => ({ id: r.check_id, result: r.result, detail: r.detail }));
}

export interface PlannedBatch {
  settlementId: string;
  kind: "CLAIMS" | "CY_PRES";
  round: number;
  part: number;
  senderBatchId: string;
  /** The approved money proposal this batch carries out (migration 0006). */
  proposalId: number;
  items: { senderItemId: string; claimId: string | null; receiver: string; cents: number; recipientType?: "EMAIL" | "PAYPAL_ID" }[];
}

/**
 * Written BEFORE the call to PayPal, so a crash after it leaves a record to reconcile, never money
 * nobody knows about. A repeat, or a claim that already has a live payout, fails here and pays nothing.
 */
export async function planBatch(c: PoolClient, b: PlannedBatch): Promise<number> {
  const amount = b.items.reduce((s, i) => s + i.cents, 0);
  const { rows } = await c.query<{ id: string }>(
    "INSERT INTO payout_batches (settlement_id, kind, round, part, sender_batch_id, amount_cents, proposal_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
    [b.settlementId, b.kind, b.round, b.part, b.senderBatchId, amount, b.proposalId],
  );
  const id = toNumber((rows[0] as { id: string }).id);
  for (const i of b.items) {
    await c.query("INSERT INTO payout_items (batch_id, claim_id, sender_item_id, receiver, amount_cents, recipient_type) VALUES ($1, $2, $3, $4, $5, $6)", [id, i.claimId, i.senderItemId, i.receiver, i.cents, i.recipientType ?? "EMAIL"]);
    if (i.claimId !== null) await moveClaim(c, i.claimId, "APPROVE", "SCHEDULED");
  }
  await appendAudit(c, { actor: "system", action: "batch_planned", subject: b.senderBatchId, detail: { batch_id: id, kind: b.kind, items: b.items.length, amount_cents: amount, proposal_id: b.proposalId } });
  return id;
}

export async function markBatchSent(db: Queryable, senderBatchId: string, a: { paypalBatchId: string; batchStatus: string; feesCents: number | null }): Promise<void> {
  const res = await db.query("UPDATE payout_batches SET paypal_batch_id = $2, batch_status = $3, fees_cents = $4 WHERE sender_batch_id = $1", [senderBatchId, a.paypalBatchId, a.batchStatus, a.feesCents]);
  if (res.rowCount !== 1) throw new Error(`no planned batch ${senderBatchId}`);
}

export async function recordItemRead(db: Queryable, a: { batchId: number; senderItemId: string; paypalItemId: string | null; paypalStatus: string | null; outcome: "PAID" | "UNCLAIMED" | "RETURNED" | "FAILED" | "IN_FLIGHT" | "UNVERIFIED"; feeCents: number | null; error: string | null }): Promise<void> {
  const res = await db.query(
    `UPDATE payout_items SET paypal_item_id = $3, paypal_status = $4, outcome = $5, fee_cents = $6, error = $7, read_at = now()
     WHERE batch_id = $1 AND sender_item_id = $2`,
    [a.batchId, a.senderItemId, a.paypalItemId, a.paypalStatus, a.outcome, a.feeCents, a.error],
  );
  if (res.rowCount !== 1) throw new Error(`no payout item ${a.senderItemId} on batch ${a.batchId}`);
}

export async function payoutItemsOf(db: Queryable, batchId: number): Promise<{ senderItemId: string; claimId: string | null; receiver: string; cents: number; outcome: string; paypalStatus: string | null; feeCents: number | null }[]> {
  const { rows } = await db.query<{ sender_item_id: string; claim_id: string | null; receiver: string; amount_cents: number; outcome: string; paypal_status: string | null; fee_cents: number | null }>(
    "SELECT sender_item_id, claim_id, receiver, amount_cents, outcome, paypal_status, fee_cents FROM payout_items WHERE batch_id = $1 ORDER BY id", [batchId]);
  return rows.map((r) => ({ senderItemId: r.sender_item_id, claimId: r.claim_id, receiver: r.receiver, cents: r.amount_cents, outcome: r.outcome, paypalStatus: r.paypal_status, feeCents: r.fee_cents }));
}

export async function recordCyPres(c: PoolClient, a: { settlementId: string; batchId: number; recipientName: string; recipientEmail: string; cents: number; approvedBy: string }): Promise<void> {
  await c.query("INSERT INTO cy_pres_transfers (settlement_id, batch_id, recipient_name, recipient_email, cents, approved_by) VALUES ($1, $2, $3, $4, $5, $6)", [a.settlementId, a.batchId, a.recipientName, a.recipientEmail, a.cents, a.approvedBy]);
  await appendAudit(c, { actor: a.approvedBy, action: "cy_pres_approved", subject: a.settlementId, detail: { batch_id: a.batchId, cents: a.cents } });
}
