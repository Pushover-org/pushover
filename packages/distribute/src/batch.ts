// Turns an allocation into PayPal batches. The batch ID derives from the settlement and the
// round, so a retry can never create a second batch while PayPal remembers the ID. PayPal only
// remembers it for 30 days, so the database must also refuse a repeat for good (R6).
import { createPayoutBatch, type CreatePayoutBatchArgs, type CreatePayoutBatchResult, type PayoutItemInput, type PayPalClient } from "@pushover/paypal";
import type { Allocation } from "./allocate.ts";

/** PayPal's limit per call (docs/paypal-specs/payments_payouts_batch_v1.json). */
export const MAX_ITEMS_PER_BATCH = 15_000;

export interface Payee {
  claimId: string;
  email: string;
  wallet?: "PAYPAL" | "VENMO";
}

export interface ClaimBatchArgs {
  settlementId: string;
  /** Increases for each distribution of the same settlement. */
  round: number;
  allocation: Allocation;
  payees: Payee[];
  emailSubject: string;
  emailMessage: string;
  maxItems?: number;
}

const assertRound = (round: number) => {
  if (!Number.isInteger(round) || round < 1) throw new Error(`round must be 1 or more, got ${round}`);
};

/** A payout that rounded to nothing is left out: PayPal cannot send $0.00. */
export function buildClaimBatches(a: ClaimBatchArgs): CreatePayoutBatchArgs[] {
  assertRound(a.round);
  const max = a.maxItems ?? MAX_ITEMS_PER_BATCH;
  const emails = new Map(a.payees.map((p) => [p.claimId, p]));
  const items: PayoutItemInput[] = a.allocation.payouts
    .filter((p) => p.payoutCents > 0)
    .map((p) => {
      const payee = emails.get(p.claimId);
      if (!payee) throw new Error(`no payee for claim ${p.claimId}`);
      return { senderItemId: p.claimId, receiverEmail: payee.email, cents: p.payoutCents, ...(payee.wallet ? { recipientWallet: payee.wallet } : {}) };
    });
  if (items.length === 0) throw new Error("nothing to pay");
  const out: CreatePayoutBatchArgs[] = [];
  for (let i = 0, part = 1; i < items.length; i += max, part++) {
    out.push({ senderBatchId: `rs-${a.settlementId}-r${a.round}-p${part}`, emailSubject: a.emailSubject, emailMessage: a.emailMessage, items: items.slice(i, i + max) });
  }
  return out;
}

export function buildCyPresBatch(a: { settlementId: string; round: number; recipientEmail: string; cents: number; emailSubject: string; emailMessage: string }): CreatePayoutBatchArgs {
  assertRound(a.round);
  return {
    senderBatchId: `rs-${a.settlementId}-cypres-r${a.round}`,
    emailSubject: a.emailSubject,
    emailMessage: a.emailMessage,
    items: [{ senderItemId: `cypres-r${a.round}`, receiverEmail: a.recipientEmail, cents: a.cents }],
  };
}

/** Code alone calls PayPal. The result may be an earlier batch (`duplicate: true`), never a second one. */
export function sendBatch(pp: PayPalClient, batch: CreatePayoutBatchArgs): Promise<CreatePayoutBatchResult> {
  return createPayoutBatch(pp, batch);
}
