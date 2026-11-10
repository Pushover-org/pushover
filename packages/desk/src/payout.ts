// Distribute and read back (spec §1.3 steps 7–8). Code alone calls PayPal; the model is not
// involved. The batch is written to the database BEFORE PayPal is called, so a crash after the
// call leaves a record to reconcile, never money nobody knows about.
import { allocate, buildClaimBatches, sendBatch, type Allocation, type Payee } from "@proofofclaim/distribute";
import { canMoveClaim, getClaim, listClaims, markBatchSent, moveClaim, planBatch, recordItemRead, withTransaction, type ClaimState } from "@proofofclaim/db";
import { getPayoutBatch, payoutItemOutcome, valueToCents, type PayPalClient } from "@proofofclaim/paypal";
import { decideClaim } from "./desk.ts";
import type { Desk } from "./desk.ts";

/** PayPal's fee per payout item, as the sandbox charged it. Reserved per item; actual fees come from PayPal. */
export const FEE_PER_ITEM_CENTS = 25;

/**
 * The cluster re-check before Distribute. A claim approved early can belong to a bot cluster that
 * only formed later, so every approved claim is checked again against the whole settlement. A
 * claim only ever moves down (to REVIEW or DENY), never up.
 */
export async function recheckApproved(desk: Desk): Promise<{ claimId: string; outcome: string; reason: string }[]> {
  const moved: { claimId: string; outcome: string; reason: string }[] = [];
  for (const c of await listClaims(desk.pool, desk.settlement.id, "APPROVE")) {
    const r = await decideClaim(desk, c.id, { recheck: true });
    if (r && r.decision.outcome !== "APPROVE") moved.push({ claimId: c.id, outcome: r.decision.outcome, reason: r.decision.reason });
  }
  return moved;
}

export interface DistributionPlan {
  round: number;
  allocation: Allocation;
  payees: Payee[];
  /** The fund this round pays from: the settlement's, or less when a cap applies. */
  fundCents: number;
}

/** What Distribute would pay now. Nothing is written and nothing is sent. */
export async function planDistribution(desk: Desk, opt: { capCents?: number } = {}): Promise<DistributionPlan> {
  const s = desk.settlement;
  const approved = await desk.pool.query<{ id: string; payout_email: string; paypal_payer_id: string | null; entitlement_cents: number }>(
    `SELECT c.id, c.payout_email, c.paypal_payer_id, d.entitlement_cents FROM claims c
     JOIN LATERAL (SELECT entitlement_cents FROM decisions x WHERE x.claim_id = c.id ORDER BY x.id DESC LIMIT 1) d ON true
     WHERE c.settlement_id = $1 AND c.status = 'APPROVE' ORDER BY c.seq`,
    [s.id],
  );
  const { rows: r } = await desk.pool.query<{ round: number | null }>("SELECT max(round) AS round FROM payout_batches WHERE settlement_id = $1 AND kind = 'CLAIMS'", [s.id]);
  const fundCents = Math.min(s.fundCents, opt.capCents ?? s.fundCents);
  const reserve = Math.min(s.adminReserveCents, Math.floor(fundCents / 10));
  const allocation = allocate({
    fundCents, adminReserveCents: reserve, feePerItemCents: FEE_PER_ITEM_CENTS,
    entitlements: approved.rows.map((a) => ({ claimId: a.id, entitlementCents: a.entitlement_cents })),
  });
  const payees: Payee[] = approved.rows.map((a) => (a.paypal_payer_id ? { claimId: a.id, payerId: a.paypal_payer_id } : { claimId: a.id, email: a.payout_email }));
  return { round: (r[0]?.round ?? 0) + 1, allocation, payees, fundCents };
}

export interface DistributionResult {
  round: number;
  batches: { senderBatchId: string; paypalBatchId: string; status: string; items: number; cents: number; duplicate: boolean }[];
}

/** Plans each batch in the database, then sends it. A repeat of the same round sends nothing new. */
export async function distribute(desk: Desk, pp: PayPalClient, plan: DistributionPlan, by: string): Promise<DistributionResult> {
  const s = desk.settlement;
  const batches = buildClaimBatches({
    settlementId: s.id, round: plan.round, allocation: plan.allocation, payees: plan.payees,
    emailSubject: `Your payment from the ${s.name}`, emailMessage: "Your claim was approved. This is your share of the settlement fund.",
  });
  const out: DistributionResult = { round: plan.round, batches: [] };
  for (const [i, b] of batches.entries()) {
    await withTransaction(desk.pool, async (tx) => {
      await planBatch(tx, {
        settlementId: s.id, kind: "CLAIMS", round: plan.round, part: i + 1, senderBatchId: b.senderBatchId,
        items: b.items.map((it) => ({
          senderItemId: it.senderItemId, claimId: it.senderItemId, cents: it.cents,
          receiver: it.receiverPayerId ?? it.receiverEmail ?? "", recipientType: it.receiverPayerId ? "PAYPAL_ID" : "EMAIL",
        })),
      });
      await tx.query("INSERT INTO audit_log (actor, action, subject, detail) VALUES ($1, 'distribute', $2, $3)", [by, b.senderBatchId, JSON.stringify({ round: plan.round, fund_cents: plan.fundCents })]);
    });
    const sent = await sendBatch(pp, b);
    const fees = sent.header.fees ? valueToCents(sent.header.fees.value) : null;
    await markBatchSent(desk.pool, b.senderBatchId, { paypalBatchId: sent.header.payout_batch_id, batchStatus: sent.header.batch_status, feesCents: fees });
    out.batches.push({
      senderBatchId: b.senderBatchId, paypalBatchId: sent.header.payout_batch_id, status: sent.header.batch_status, items: b.items.length,
      cents: b.items.reduce((t, it) => t + it.cents, 0), duplicate: sent.duplicate,
    });
  }
  return out;
}

const CLAIM_STATE: Record<string, ClaimState | null> = { PAID: "PAID", UNCLAIMED: "UNCLAIMED", RETURNED: "RETURNED", FAILED: "FAILED", UNVERIFIED: "UNVERIFIED", IN_FLIGHT: null };

/** Reads a batch back from PayPal item by item, records each outcome, and moves each claim to match. */
export async function readBack(desk: Desk, pp: PayPalClient, batchId: number): Promise<{ status: string; outcomes: Record<string, number> }> {
  const { rows } = await desk.pool.query<{ paypal_batch_id: string | null }>("SELECT paypal_batch_id FROM payout_batches WHERE id = $1", [batchId]);
  const paypalId = rows[0]?.paypal_batch_id;
  if (!paypalId) throw new Error(`batch ${batchId} was never sent`);
  const b = await getPayoutBatch(pp, paypalId);
  await desk.pool.query("UPDATE payout_batches SET batch_status = $2, fees_cents = $3 WHERE id = $1", [batchId, b.batch_header.batch_status, b.batch_header.fees ? valueToCents(b.batch_header.fees.value) : null]);
  const outcomes: Record<string, number> = {};
  for (const it of b.items) {
    const senderItemId = it.payout_item.sender_item_id;
    if (!senderItemId) continue;
    const outcome = payoutItemOutcome(it.transaction_status);
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    await recordItemRead(desk.pool, {
      batchId, senderItemId, paypalItemId: it.payout_item_id, paypalStatus: it.transaction_status ?? null, outcome,
      feeCents: it.payout_item_fee ? valueToCents(it.payout_item_fee.value) : null, error: it.errors?.name ?? null,
    });
    const to = CLAIM_STATE[outcome];
    const claim = await getClaim(desk.pool, senderItemId);
    // The payout item row is the record; the claim follows only along a legal step.
    if (to && claim && claim.status !== to && canMoveClaim(claim.status, to)) await moveClaim(desk.pool, claim.id, claim.status, to);
  }
  return { status: b.batch_header.batch_status, outcomes };
}
