// Cy-près (plan item B5): money that came back and wasn't re-offered in time goes to the
// nonprofit the court chose, in its own Payouts batch, with the same two-person approval as any
// money leaving the fund. Each claim's returned money is recorded against the transfer that
// carried it, so it can go only once (migration 0008).
import { createHash } from "node:crypto";
import { buildCyPresBatch, sendBatch } from "@proofofclaim/distribute";
import { decideProposal, deploymentInstance, getProposal, insertProposal, markBatchSent, planBatch, recordCyPres, withTransaction, type Analyst, type MoneyProposal } from "@proofofclaim/db";
import { valueToCents, type PayPalClient } from "@proofofclaim/paypal";
import type { Desk } from "./desk.ts";
import { commitLedger, ledgerNote } from "./ledger.ts";
import { checkBalance, MoneyRefusedError, PROPOSAL_TTL_MINUTES } from "./payout.ts";

export interface CyPresPlan {
  settlementId: string;
  kind: "CY_PRES";
  round: number;
  recipient: { name: string; email: string };
  /** Each claim whose payout came back and is now cy-près eligible, with what came back. */
  items: { claimId: string; cents: number }[];
  totalCents: number;
}

/** What a cy-près transfer would carry now. Nothing is written or sent. */
export async function planCyPres(desk: Desk): Promise<CyPresPlan> {
  const s = desk.settlement;
  const { rows } = await desk.pool.query<{ id: string; cents: string }>(
    `SELECT c.id, i.amount_cents AS cents FROM claims c
     JOIN LATERAL (SELECT amount_cents FROM payout_items x WHERE x.claim_id = c.id AND x.outcome IN ('RETURNED', 'FAILED') ORDER BY x.id DESC LIMIT 1) i ON true
     WHERE c.settlement_id = $1 AND c.status = 'CY_PRES_ELIGIBLE' AND NOT EXISTS (SELECT 1 FROM cy_pres_claims k WHERE k.claim_id = c.id)
     ORDER BY c.seq`,
    [s.id],
  );
  const { rows: r } = await desk.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM payout_batches WHERE settlement_id = $1 AND kind = 'CY_PRES'", [s.id]);
  const items = rows.map((x) => ({ claimId: x.id, cents: Number(x.cents) }));
  return { settlementId: s.id, kind: "CY_PRES", round: (r[0]?.n ?? 0) + 1, recipient: { name: s.cyPres.name, email: s.cyPres.payoutEmail }, items, totalCents: items.reduce((t, i) => t + i.cents, 0) };
}

const digest = (plan: CyPresPlan) => createHash("sha256").update(JSON.stringify(plan)).digest();

/** First person: records the exact transfer for a second person to approve. Nothing is sent. */
export async function proposeCyPres(desk: Desk, by: Analyst): Promise<MoneyProposal> {
  const plan = await planCyPres(desk);
  if (plan.totalCents === 0) throw new MoneyRefusedError("No returned money is waiting for cy-près.");
  const id = await withTransaction(desk.pool, (tx) =>
    insertProposal(tx, { settlementId: plan.settlementId, kind: "CY_PRES", planHash: digest(plan), plan, totalCents: plan.totalCents, by, ttlMinutes: PROPOSAL_TTL_MINUTES }),
  );
  const p = await getProposal(desk.pool, id);
  if (!p) throw new Error(`proposal ${id} vanished`);
  return p;
}

/** Second person: a different supervisor approves, and only then is PayPal called. */
export async function approveCyPres(desk: Desk, pp: PayPalClient, approver: Analyst, proposalId: number): Promise<{ batchId: number; paypalBatchId: string; status: string; cents: number }> {
  const p = await getProposal(desk.pool, proposalId);
  if (!p || p.settlementId !== desk.settlement.id || p.kind !== "CY_PRES" || p.status !== "PROPOSED") throw new MoneyRefusedError("That proposal is no longer open.");
  if (p.proposedBy.id === approver.id) throw new MoneyRefusedError("A different person has to approve: you proposed this one.");
  if (approver.role !== "supervisor") throw new MoneyRefusedError("Only a supervisor can approve money leaving the fund.");
  if (p.expiresAt.getTime() <= Date.now()) throw new MoneyRefusedError("This proposal expired. Propose it again.");
  const plan = await planCyPres(desk);
  const hash = digest(plan);
  if (!hash.equals(p.planHash)) {
    await withTransaction(desk.pool, (tx) => decideProposal(tx, { id: p.id, status: "SUPERSEDED", by: approver }));
    throw new MoneyRefusedError("The returned money changed since this was proposed. Nothing was sent; propose it again.");
  }
  await checkBalance(desk, pp, plan.totalCents, 1);
  if (!desk.rulesFiles) throw new MoneyRefusedError("The rules' fingerprint isn't configured, so the ledger can't be committed. Nothing was sent.");
  const won = await withTransaction(desk.pool, (tx) => decideProposal(tx, { id: p.id, status: "APPROVED", by: approver }));
  if (!won) throw new MoneyRefusedError("Someone else decided this proposal first.");
  const ledger = await commitLedger(desk, { proposalId: p.id, kind: "CY_PRES", round: plan.round, planHash: hash, by: `analyst:${approver.email}` });

  const s = desk.settlement;
  const batch = buildCyPresBatch({
    instance: await deploymentInstance(desk.pool), settlementId: s.id, round: plan.round, recipientEmail: plan.recipient.email, cents: plan.totalCents, note: ledgerNote(s.id, "CY_PRES", plan.round, ledger, hash),
    emailSubject: `Cy-près distribution from the ${s.name}`,
    emailMessage: `Settlement money that could not be delivered to class members, sent to ${plan.recipient.name} as the court directed. Ledger sha256:${ledger.digest.slice(0, 16)}.`,
  });
  // Written before PayPal is called, like every batch.
  const batchId = await withTransaction(desk.pool, async (tx) => {
    const id = await planBatch(tx, {
      settlementId: s.id, kind: "CY_PRES", round: plan.round, part: 1, senderBatchId: batch.senderBatchId, proposalId: p.id, ledgerCommitmentId: ledger.id,
      items: batch.items.map((it) => ({ senderItemId: it.senderItemId, claimId: null, receiver: plan.recipient.email, cents: it.cents })),
    });
    await recordCyPres(tx, {
      settlementId: s.id, batchId: id, recipientName: plan.recipient.name, recipientEmail: plan.recipient.email, cents: plan.totalCents,
      approvedBy: `analyst:${approver.email}`, claims: plan.items,
    });
    return id;
  });
  const sent = await sendBatch(pp, batch);
  await markBatchSent(desk.pool, batch.senderBatchId, { paypalBatchId: sent.header.payout_batch_id, batchStatus: sent.header.batch_status, feesCents: sent.header.fees ? valueToCents(sent.header.fees.value) : null });
  return { batchId, paypalBatchId: sent.header.payout_batch_id, status: sent.header.batch_status, cents: plan.totalCents };
}
