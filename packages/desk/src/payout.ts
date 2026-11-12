// Distribute and read back (spec §1.3 steps 7–8). Code alone calls PayPal; the model is not
// involved. The batch is written to the database BEFORE PayPal is called, so a crash after the
// call leaves a record to reconcile, never money nobody knows about.
import { allocate, buildClaimBatches, sendBatch, type Allocation, type Payee } from "@proofofclaim/distribute";
import { createHash } from "node:crypto";
import {
  canMoveClaim, decideProposal, deploymentInstance, getClaim, getProposal, insertProposal, listClaims, markBatchSent, moveClaim, openProposal, planBatch, recordItemRead, withTransaction,
  type Analyst, type ClaimState, type MoneyProposal,
} from "@proofofclaim/db";
import { getBalance, getPayoutBatch, payoutItemOutcome, valueToCents, type PayPalClient } from "@proofofclaim/paypal";
import { decideClaim } from "./desk.ts";
import { commitLedger, ledgerNote } from "./ledger.ts";
import { openPayerId } from "./payer-id.ts";
import { detectRings, heldGroupCount } from "./rings.ts";
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
  /** This round's payouts: shares of the whole fund, for the claims paid now. */
  allocation: Allocation;
  payees: Payee[];
  /** The settlement's fund; every share is of this, whatever the round's cap. */
  fundCents: number;
  /** Approved claims left for a later round because this round's cap was reached. */
  deferred: number;
  /** Approved claims from PayPal accounts that aren't verified: paid once the claimant logs in verified (P2). */
  waitingVerification: number;
  /** How each payee appears on the record: the email, or the PayPal account's pseudonym. Never a payer ID. */
  receivers: Record<string, string>;
}

/** States of a claim that already has its share in a payout (or had one come back). */
const ALREADY_SENT = ["SCHEDULED", "PAID", "UNCLAIMED", "UNVERIFIED", "RETURNED", "FAILED", "CY_PRES_ELIGIBLE"];

/**
 * What Distribute would pay now. Nothing is written and nothing is sent.
 *
 * Shares are always of the whole fund, over every claim entitled to one (approved now or already
 * sent in an earlier round), so a later round can't pay the fund out twice. A cap (the demo's
 * daily sandbox limit) never shrinks anyone's share: it pays approved claims in filing order, each
 * in full, until the cap is reached, and the rest wait for the next round.
 */
export async function planDistribution(desk: Desk, opt: { capCents?: number } = {}): Promise<DistributionPlan> {
  const s = desk.settlement;
  const { rows } = await desk.pool.query<{
    id: string; status: string; payout_email: string; paypal_pseudonym: string | null; paypal_payer_sealed: Buffer | null; paypal_verified: boolean | null; entitlement_cents: number;
  }>(
    `SELECT c.id, c.status, c.payout_email, c.paypal_pseudonym, c.paypal_payer_sealed, c.paypal_verified, d.entitlement_cents FROM claims c
     JOIN LATERAL (SELECT entitlement_cents FROM decisions x WHERE x.claim_id = c.id AND x.outcome = 'APPROVE' ORDER BY x.id DESC LIMIT 1) d ON true
     WHERE c.settlement_id = $1 AND (c.status = 'APPROVE' OR c.status = ANY($2)) ORDER BY c.seq`,
    [s.id, ALREADY_SENT],
  );
  const { rows: r } = await desk.pool.query<{ round: number | null }>("SELECT max(round) AS round FROM payout_batches WHERE settlement_id = $1 AND kind = 'CLAIMS'", [s.id]);
  const whole = allocate({
    fundCents: s.fundCents, adminReserveCents: s.adminReserveCents, feePerItemCents: FEE_PER_ITEM_CENTS,
    entitlements: rows.map((a) => ({ claimId: a.id, entitlementCents: a.entitlement_cents })),
  });
  const share = new Map(whole.payouts.map((p) => [p.claimId, p]));
  const approved = rows.filter((a) => a.status === "APPROVE");
  // An unverified PayPal account keeps its share in the allocation but isn't paid yet.
  const waiting = approved.filter((a) => a.paypal_verified === false);
  const payable = approved.filter((a) => a.paypal_verified !== false);
  const payNow: Allocation["payouts"] = [];
  let total = 0;
  for (const a of payable) {
    const p = share.get(a.id);
    if (!p || p.payoutCents === 0) continue;
    if (opt.capCents !== undefined && total + p.payoutCents > opt.capCents) break;
    payNow.push(p);
    total += p.payoutCents;
  }
  const paid = new Set(payNow.map((p) => p.claimId));
  const allocation: Allocation = { ...whole, payouts: payNow, reservedFeesCents: payNow.length * FEE_PER_ITEM_CENTS };
  const payees: Payee[] = [];
  const receivers: Record<string, string> = {};
  for (const a of payable.filter((x) => paid.has(x.id))) {
    if (a.paypal_payer_sealed && a.paypal_pseudonym) {
      if (!desk.keys) throw new Error("paying a PayPal account needs PAYER_SEAL_KEY and PAYER_PSEUDONYM_KEY");
      payees.push({ claimId: a.id, payerId: openPayerId(desk.keys, s.id, a.id, a.paypal_payer_sealed) });
      receivers[a.id] = `pseudonym:${a.paypal_pseudonym}`;
    } else {
      payees.push({ claimId: a.id, email: a.payout_email });
      receivers[a.id] = a.payout_email;
    }
  }
  return {
    round: (r[0]?.round ?? 0) + 1, allocation, payees, fundCents: s.fundCents, deferred: payable.length - payNow.length, waitingVerification: waiting.length, receivers,
  };
}

export interface DistributionResult {
  round: number;
  batches: { senderBatchId: string; paypalBatchId: string; status: string; items: number; cents: number; duplicate: boolean }[];
}

/** P23: no money while any group of linked claims waits for a person. Groups are looked for again first. */
async function refuseWhileGroupsHeld(desk: Desk): Promise<void> {
  await detectRings(desk);
  const held = await heldGroupCount(desk);
  if (held > 0) {
    throw new MoneyRefusedError(`${held} group${held === 1 ? "" : "s"} of linked claims ${held === 1 ? "is" : "are"} still held for a person. Clear or deny ${held === 1 ? "it" : "each"} before paying.`);
  }
}

/** How long a proposal waits for its second person. */
export const PROPOSAL_TTL_MINUTES = 24 * 60;

/** Money refused for a reason a person can act on. Nothing was sent. */
export class MoneyRefusedError extends Error {
  override name = "MoneyRefusedError";
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * Plan item P34: is the money there? PayPal's balance is as of a past time (about two hours behind
 * in the sandbox), so whatever we sent after that time, with its fees, is taken off first. One
 * PayPal account pays every settlement, so every settlement's batches count.
 */
export async function checkBalance(desk: Desk, pp: PayPalClient, needCents: number, items: number): Promise<{ availableCents: number; sentSinceCents: number; asOf: Date }> {
  const b = await getBalance(pp);
  const { rows } = await desk.pool.query<{ cents: string; items: string }>(
    `SELECT COALESCE(sum(b.amount_cents), 0) AS cents,
            (SELECT count(*) FROM payout_items i JOIN payout_batches x ON x.id = i.batch_id WHERE x.created_at > $1 AND x.paypal_batch_id IS NOT NULL) AS items
     FROM payout_batches b WHERE b.created_at > $1 AND b.paypal_batch_id IS NOT NULL`,
    [b.asOf],
  );
  const sentSinceCents = Number(rows[0]?.cents ?? 0) + Number(rows[0]?.items ?? 0) * FEE_PER_ITEM_CENTS;
  const room = b.availableCents - sentSinceCents;
  const want = needCents + items * FEE_PER_ITEM_CENTS;
  if (room < want) {
    throw new MoneyRefusedError(
      `PayPal shows ${usd(b.availableCents)} available as of ${b.asOf.toISOString().slice(0, 16).replace("T", " ")} UTC, less ${usd(sentSinceCents)} we've sent since: ${usd(room)}. This round needs ${usd(want)} with fees. Nothing was sent.`,
    );
  }
  return { availableCents: b.availableCents, sentSinceCents, asOf: b.asOf };
}


/** What a proposal fixes: every payee, amount and receiver. The approver's plan must hash the same. */
export function planDigest(settlementId: string, plan: DistributionPlan): { hash: Buffer; summary: PlanSummary } {
  // The proposal stores this summary: pseudonyms and emails only, never a payer ID.
  const items = plan.allocation.payouts.filter((p) => p.payoutCents > 0).map((p) => ({ claimId: p.claimId, cents: p.payoutCents, receiver: plan.receivers[p.claimId] ?? "" }));
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
  await refuseWhileGroupsHeld(desk);
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
  await refuseWhileGroupsHeld(desk);
  await recheckApproved(desk);
  const plan = await planDistribution(desk, opt);
  const { hash } = planDigest(desk.settlement.id, plan);
  if (!hash.equals(p.planHash)) {
    await withTransaction(desk.pool, (tx) => decideProposal(tx, { id: p.id, status: "SUPERSEDED", by: approver }));
    throw new MoneyRefusedError("Claims changed since this was proposed, so the plan is different. Nothing was sent; propose the round again.");
  }
  await checkBalance(desk, pp, p.totalCents, plan.allocation.payouts.length);
  if (!desk.rulesFiles) throw new MoneyRefusedError("The rules' fingerprint isn't configured, so the ledger can't be committed. Nothing was sent.");
  const won = await withTransaction(desk.pool, (tx) => decideProposal(tx, { id: p.id, status: "APPROVED", by: approver }));
  if (!won) throw new MoneyRefusedError("Someone else decided this proposal first.");
  // The decision ledger is fixed before any batch exists; the database refuses a batch without it.
  const ledger = await commitLedger(desk, { proposalId: p.id, kind: "CLAIMS", round: plan.round, planHash: p.planHash, by: `analyst:${approver.email}` });
  return distribute(desk, pp, plan, { proposalId: p.id, planHash: p.planHash, ledger, proposedBy: p.proposedBy, approvedBy: approver });
}

export { openProposal };

/**
 * Plans each batch in the database, then sends it. Only `approveAndDistribute` calls this: the
 * database refuses a batch without an approved proposal.
 */
async function distribute(
  desk: Desk,
  pp: PayPalClient,
  plan: DistributionPlan,
  who: { proposalId: number; planHash: Buffer; ledger: { id: number; digest: string; drandRound: number }; proposedBy: Analyst; approvedBy: Analyst },
): Promise<DistributionResult> {
  const s = desk.settlement;
  const note = ledgerNote(s.id, "CLAIMS", plan.round, who.ledger, who.planHash);
  const batches = buildClaimBatches({
    instance: await deploymentInstance(desk.pool), settlementId: s.id, round: plan.round, allocation: plan.allocation, payees: plan.payees, note,
    emailSubject: `Your payment from the ${s.name}`,
    emailMessage: `Your claim was approved. This is your share of the settlement fund. Round ${plan.round}, ledger sha256:${who.ledger.digest.slice(0, 16)}.`,
  });
  const out: DistributionResult = { round: plan.round, batches: [] };
  for (const [i, b] of batches.entries()) {
    await withTransaction(desk.pool, async (tx) => {
      await planBatch(tx, {
        settlementId: s.id, kind: "CLAIMS", round: plan.round, part: i + 1, senderBatchId: b.senderBatchId, proposalId: who.proposalId, ledgerCommitmentId: who.ledger.id,
        items: b.items.map((it) => ({
          senderItemId: it.senderItemId, claimId: it.senderItemId, cents: it.cents,
          receiver: plan.receivers[it.senderItemId] ?? it.receiverEmail ?? "", recipientType: it.receiverPayerId ? "PAYPAL_ID" : "EMAIL",
        })),
      });
      await tx.query("INSERT INTO audit_log (actor, action, subject, detail) VALUES ($1, 'distribute', $2, $3)", [
        `analyst:${who.approvedBy.email}`, b.senderBatchId,
        JSON.stringify({ round: plan.round, fund_cents: plan.fundCents, proposal_id: who.proposalId, ledger_commitment_id: who.ledger.id, proposed_by: who.proposedBy.email, approved_by: who.approvedBy.email }),
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

const STATES: ClaimState[] = ["SUBMITTED", "EXAMINED", "APPROVE", "DENY", "NEED_MORE", "REVIEW", "SCHEDULED", "PAID", "UNCLAIMED", "RETURNED", "FAILED", "CY_PRES_ELIGIBLE", "UNVERIFIED"];

/**
 * The shortest run of legal moves from one state to another. PayPal can report an item's end state
 * at the first read (RETURNED, if nobody looked for 30 days), and the claim must still pass through
 * the states in between (SCHEDULED, UNCLAIMED, RETURNED). Null if there is no legal way.
 */
export function pathBetween(from: ClaimState, to: ClaimState): ClaimState[] | null {
  const prev = new Map<ClaimState, ClaimState>();
  const queue: ClaimState[] = [from];
  const seen = new Set<ClaimState>([from]);
  while (queue.length) {
    const at = queue.shift() as ClaimState;
    if (at === to) break;
    for (const next of STATES) {
      if (!seen.has(next) && canMoveClaim(at, next)) {
        seen.add(next);
        prev.set(next, at);
        queue.push(next);
      }
    }
  }
  if (!seen.has(to) || from === to) return null;
  const path: ClaimState[] = [];
  for (let s: ClaimState | undefined = to; s && s !== from; s = prev.get(s)) path.unshift(s);
  return path;
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
      feeCents: it.payout_item_fee ? valueToCents(it.payout_item_fee.value) : null, error: it.errors?.name ?? null, paypalTransactionId: it.transaction_id ?? null, paypalNote: it.payout_item.note ?? null,
    });
    const to = CLAIM_STATE[outcome];
    const claim = await getClaim(desk.pool, senderItemId);
    // The payout item row is the record; the claim follows only along a legal step.
    const path = to && claim && claim.status !== to ? pathBetween(claim.status, to) : null;
    if (to && claim && path) {
      let at = claim.status;
      for (const step of path) {
        await moveClaim(desk.pool, claim.id, at, step);
        at = step;
      }
      // Money that came back starts the re-offer window (C4).
      if (to === "RETURNED" || to === "FAILED") await desk.pool.query("UPDATE claims SET money_back_at = COALESCE(money_back_at, now()) WHERE id = $1", [claim.id]);
    }
  }
  return { status: b.batch_header.batch_status, outcomes };
}
