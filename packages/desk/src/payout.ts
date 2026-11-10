// Distribute and read back (spec §1.3 steps 7–8). Code alone calls PayPal; the model is not
// involved. The batch is written to the database BEFORE PayPal is called, so a crash after the
// call leaves a record to reconcile, never money nobody knows about.
import { allocate, buildClaimBatches, sendBatch, type Allocation, type Payee } from "@proofofclaim/distribute";
import { createHash } from "node:crypto";
import {
  canMoveClaim, decideProposal, getClaim, getProposal, insertProposal, listClaims, markBatchSent, moveClaim, openProposal, planBatch, recordItemRead, withTransaction,
  type Analyst, type ClaimState, type MoneyProposal,
} from "@proofofclaim/db";
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

/** How long a proposal waits for its second person. */
export const PROPOSAL_TTL_MINUTES = 24 * 60;

/** Money refused for a reason a person can act on. Nothing was sent. */
export class MoneyRefusedError extends Error {
  override name = "MoneyRefusedError";
}

/** What a proposal fixes: every payee, amount and receiver. The approver's plan must hash the same. */
export function planDigest(settlementId: string, plan: DistributionPlan): { hash: Buffer; summary: PlanSummary } {
  const receiver = new Map(plan.payees.map((p) => [p.claimId, p.payerId ? `PAYPAL_ID:${p.payerId}` : `EMAIL:${p.email ?? ""}`]));
  const items = plan.allocation.payouts.filter((p) => p.payoutCents > 0).map((p) => ({ claimId: p.claimId, cents: p.payoutCents, receiver: receiver.get(p.claimId) ?? "" }));
  const summary: PlanSummary = {
    settlementId, kind: "CLAIMS", round: plan.round, fundCents: plan.fundCents, totalCents: items.reduce((t, i) => t + i.cents, 0),
    reservedFeesCents: plan.allocation.reservedFeesCents, scaled: plan.allocation.scaled, items,
  };
  return { hash: createHash("sha256").update(JSON.stringify(summary)).digest(), summary };
}

export interface PlanSummary {
  settlementId: string;
  kind: "CLAIMS";
  round: number;
  fundCents: number;
  totalCents: number;
  reservedFeesCents: number;
  scaled: boolean;
  items: { claimId: string; cents: number; receiver: string }[];
}

/**
 * First person: re-checks every approved claim, plans the round and records the exact plan for a
 * second person to approve. Nothing is sent.
 */
export async function proposeDistribution(desk: Desk, by: Analyst, opt: { capCents?: number } = {}): Promise<{ proposal: MoneyProposal; moved: Awaited<ReturnType<typeof recheckApproved>> }> {
  const moved = await recheckApproved(desk);
  const plan = await planDistribution(desk, opt);
  const { hash, summary } = planDigest(desk.settlement.id, plan);
  if (summary.items.length === 0) throw new MoneyRefusedError("No approved claims are waiting to be paid.");
  const id = await withTransaction(desk.pool, (tx) =>
    insertProposal(tx, { settlementId: desk.settlement.id, kind: "CLAIMS", planHash: hash, plan: summary, totalCents: summary.totalCents, by, ttlMinutes: PROPOSAL_TTL_MINUTES }),
  );
  const proposal = await getProposal(desk.pool, id);
  if (!proposal) throw new Error(`proposal ${id} vanished`);
  return { proposal, moved };
}

/** The proposer, or any supervisor, withdraws an open proposal. */
export async function cancelProposal(desk: Desk, by: Analyst, proposalId: number): Promise<void> {
  const p = await getProposal(desk.pool, proposalId);
  if (!p || p.settlementId !== desk.settlement.id || p.status !== "PROPOSED") throw new MoneyRefusedError("That proposal is no longer open.");
  if (p.proposedBy.id !== by.id && by.role !== "supervisor") throw new MoneyRefusedError("Only the person who proposed it, or a supervisor, can withdraw it.");
  await withTransaction(desk.pool, (tx) => decideProposal(tx, { id: p.id, status: "CANCELLED", by }));
}

/**
 * Second person: approves an open proposal and sends it. The approver must be a supervisor and
 * not the proposer. Every approved claim is re-checked and the round planned again; if the plan is
 * not exactly the one proposed, nothing is sent and the proposal is superseded.
 */
export async function approveAndDistribute(desk: Desk, pp: PayPalClient, approver: Analyst, proposalId: number, opt: { capCents?: number } = {}): Promise<DistributionResult> {
  const p = await getProposal(desk.pool, proposalId);
  if (!p || p.settlementId !== desk.settlement.id || p.kind !== "CLAIMS" || p.status !== "PROPOSED") throw new MoneyRefusedError("That proposal is no longer open.");
  if (p.proposedBy.id === approver.id) throw new MoneyRefusedError("A different person has to approve: you proposed this one.");
  if (approver.role !== "supervisor") throw new MoneyRefusedError("Only a supervisor can approve money leaving the fund.");
  if (p.expiresAt.getTime() <= Date.now()) throw new MoneyRefusedError("This proposal expired. Propose the round again.");
  await recheckApproved(desk);
  const plan = await planDistribution(desk, opt);
  const { hash } = planDigest(desk.settlement.id, plan);
  if (!hash.equals(p.planHash)) {
    await withTransaction(desk.pool, (tx) => decideProposal(tx, { id: p.id, status: "SUPERSEDED", by: approver }));
    throw new MoneyRefusedError("Claims changed since this was proposed, so the plan is different. Nothing was sent; propose the round again.");
  }
  const won = await withTransaction(desk.pool, (tx) => decideProposal(tx, { id: p.id, status: "APPROVED", by: approver }));
  if (!won) throw new MoneyRefusedError("Someone else decided this proposal first.");
  return distribute(desk, pp, plan, { proposalId: p.id, proposedBy: p.proposedBy, approvedBy: approver });
}

export { openProposal };

/**
 * Plans each batch in the database, then sends it. Only `approveAndDistribute` calls this: the
 * database refuses a batch without an approved proposal.
 */
async function distribute(desk: Desk, pp: PayPalClient, plan: DistributionPlan, who: { proposalId: number; proposedBy: Analyst; approvedBy: Analyst }): Promise<DistributionResult> {
  const s = desk.settlement;
  const batches = buildClaimBatches({
    settlementId: s.id, round: plan.round, allocation: plan.allocation, payees: plan.payees,
    emailSubject: `Your payment from the ${s.name}`, emailMessage: "Your claim was approved. This is your share of the settlement fund.",
  });
  const out: DistributionResult = { round: plan.round, batches: [] };
  for (const [i, b] of batches.entries()) {
    await withTransaction(desk.pool, async (tx) => {
      await planBatch(tx, {
        settlementId: s.id, kind: "CLAIMS", round: plan.round, part: i + 1, senderBatchId: b.senderBatchId, proposalId: who.proposalId,
        items: b.items.map((it) => ({
          senderItemId: it.senderItemId, claimId: it.senderItemId, cents: it.cents,
          receiver: it.receiverPayerId ?? it.receiverEmail ?? "", recipientType: it.receiverPayerId ? "PAYPAL_ID" : "EMAIL",
        })),
      });
      await tx.query("INSERT INTO audit_log (actor, action, subject, detail) VALUES ($1, 'distribute', $2, $3)", [
        `analyst:${who.approvedBy.email}`, b.senderBatchId,
        JSON.stringify({ round: plan.round, fund_cents: plan.fundCents, proposal_id: who.proposalId, proposed_by: who.proposedBy.email, approved_by: who.approvedBy.email }),
      ]);
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
  const { rows } = await desk.pool.query<{ paypal_batch_id: string | null }>("SELECT paypal_batch_id FROM payout_batches WHERE id = $1 AND settlement_id = $2", [batchId, desk.settlement.id]);
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
