// The money read model: where every cent of the fund is, from the payout records PayPal confirmed.
import { pool } from "./data.ts";

/** Sandbox money the public demo may send in 24 hours (spec §4.7 abuse limits). */
export const DEMO_DAILY_CAP_CENTS = 5000;

export interface PayoutRow {
  batchId: number;
  senderBatchId: string;
  paypalBatchId: string | null;
  batchStatus: string | null;
  round: number;
  claimId: string | null;
  name: string | null;
  receiver: string;
  recipientType: string;
  cents: number;
  outcome: string;
  paypalStatus: string | null;
  paypalItemId: string | null;
  feeCents: number | null;
  error: string | null;
  readAt: string | null;
}

export interface Money {
  fundCents: number;
  paidCents: number;
  unclaimedCents: number;
  inFlightCents: number;
  unverifiedCents: number;
  returnedCents: number;
  cyPresCents: number;
  feesCents: number;
  feesUnknown: number;
  plannedCents: number;
  heldCents: number;
  sentLast24hCents: number;
  rows: PayoutRow[];
}

export async function money(settlementId: string, fundCents: number): Promise<Money> {
  const db = pool();
  const { rows } = await db.query<{
    batch_id: string; sender_batch_id: string; paypal_batch_id: string | null; batch_status: string | null; round: number; claim_id: string | null; claimant_name: string | null;
    receiver: string; recipient_type: string; amount_cents: number; outcome: string; paypal_status: string | null; paypal_item_id: string | null; fee_cents: number | null; error: string | null; read_at: Date | null; kind: string;
  }>(
    `SELECT b.id AS batch_id, b.sender_batch_id, b.paypal_batch_id, b.batch_status, b.round, b.kind, i.claim_id, c.claimant_name, i.receiver, i.recipient_type,
            i.amount_cents, i.outcome, i.paypal_status, i.paypal_item_id, i.fee_cents, i.error, i.read_at
     FROM payout_items i JOIN payout_batches b ON b.id = i.batch_id LEFT JOIN claims c ON c.id = i.claim_id
     WHERE b.settlement_id = $1 ORDER BY b.id DESC, i.id`,
    [settlementId],
  );
  const sum = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).reduce((t, r) => t + r.amount_cents, 0);
  const claims = (r: (typeof rows)[number]) => r.kind === "CLAIMS";
  const { rows: recent } = await db.query<{ cents: string | null }>(
    "SELECT sum(amount_cents) AS cents FROM payout_batches WHERE settlement_id = $1 AND kind = 'CLAIMS' AND created_at > now() - interval '24 hours'",
    [settlementId],
  );
  const m = {
    fundCents,
    paidCents: sum((r) => claims(r) && r.outcome === "PAID"),
    unclaimedCents: sum((r) => claims(r) && r.outcome === "UNCLAIMED"),
    inFlightCents: sum((r) => claims(r) && (r.outcome === "IN_FLIGHT" || r.outcome === "PLANNED")),
    unverifiedCents: sum((r) => claims(r) && r.outcome === "UNVERIFIED"),
    returnedCents: sum((r) => claims(r) && (r.outcome === "RETURNED" || r.outcome === "FAILED")),
    cyPresCents: sum((r) => r.kind === "CY_PRES" && r.outcome === "PAID"),
    feesCents: rows.reduce((t, r) => t + (r.fee_cents ?? 0), 0),
    feesUnknown: rows.filter((r) => r.fee_cents === null && r.outcome !== "PLANNED").length,
    plannedCents: sum(() => true),
    sentLast24hCents: Number(recent[0]?.cents ?? 0),
    rows: rows.map((r) => ({
      batchId: Number(r.batch_id), senderBatchId: r.sender_batch_id, paypalBatchId: r.paypal_batch_id, batchStatus: r.batch_status, round: r.round, claimId: r.claim_id, name: r.claimant_name,
      receiver: r.receiver, recipientType: r.recipient_type, cents: r.amount_cents, outcome: r.outcome, paypalStatus: r.paypal_status, paypalItemId: r.paypal_item_id,
      feeCents: r.fee_cents, error: r.error, readAt: r.read_at?.toISOString() ?? null,
    })),
  };
  // Held: everything not yet out of the fund. Fees come out of the fund too.
  return { ...m, heldCents: fundCents - m.paidCents - m.unclaimedCents - m.inFlightCents - m.unverifiedCents - m.returnedCents - m.cyPresCents - m.feesCents };
}
