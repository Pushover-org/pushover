// The money path after Distribute (migration 0008): PayPal's history, webhooks, money that came
// back, re-offers and cy-près.
import type { Queryable } from "../pool.ts";
import { appendAudit } from "./claims.ts";

export type HistoryStatus = "NOT_CHECKED" | "WAITING" | "CONFIRMED" | "NEVER_CAUGHT_UP";

/** Payout items PayPal has read back with a transaction, not yet found in PayPal's history. */
export async function itemsAwaitingHistory(db: Queryable, settlementId: string, limit: number): Promise<{ batchId: number; senderItemId: string; transactionId: string; sentAt: Date }[]> {
  const { rows } = await db.query<{ batch_id: string; sender_item_id: string; paypal_transaction_id: string; created_at: Date }>(
    `SELECT i.batch_id, i.sender_item_id, i.paypal_transaction_id, b.created_at FROM payout_items i JOIN payout_batches b ON b.id = i.batch_id
     WHERE b.settlement_id = $1 AND i.paypal_transaction_id IS NOT NULL AND i.history_status IN ('NOT_CHECKED', 'WAITING')
     ORDER BY i.history_checked_at NULLS FIRST, i.id LIMIT $2`,
    [settlementId, limit],
  );
  return rows.map((r) => ({ batchId: Number(r.batch_id), senderItemId: r.sender_item_id, transactionId: r.paypal_transaction_id, sentAt: r.created_at }));
}

export async function recordHistory(db: Queryable, a: { batchId: number; senderItemId: string; status: HistoryStatus; code: string | null }): Promise<void> {
  await db.query("UPDATE payout_items SET history_status = $3, history_code = $4, history_checked_at = now() WHERE batch_id = $1 AND sender_item_id = $2", [a.batchId, a.senderItemId, a.status, a.code]);
}

/** Stores a verified webhook event once. False if this event ID was already stored (a replay). */
export async function recordWebhookEvent(db: Queryable, a: { id: string; type: string; payload: unknown }): Promise<boolean> {
  const res = await db.query("INSERT INTO webhook_events (id, event_type, verified, payload) VALUES ($1, $2, true, $3) ON CONFLICT (id) DO NOTHING", [a.id, a.type, JSON.stringify(a.payload)]);
  if (res.rowCount === 1) await appendAudit(db, { actor: "paypal", action: "webhook_verified", subject: a.id, detail: { type: a.type } });
  return res.rowCount === 1;
}

export async function unprocessedWebhookEvents(db: Queryable, limit: number): Promise<{ id: string; type: string; payload: { resource?: { payout_batch_id?: string; batch_header?: { payout_batch_id?: string } } } }[]> {
  const { rows } = await db.query<{ id: string; event_type: string; payload: never }>("SELECT id, event_type, payload FROM webhook_events WHERE verified AND processed_at IS NULL ORDER BY received_at LIMIT $1", [limit]);
  return rows.map((r) => ({ id: r.id, type: r.event_type, payload: r.payload }));
}

export async function markWebhookProcessed(db: Queryable, id: string): Promise<void> {
  await db.query("UPDATE webhook_events SET processed_at = now() WHERE id = $1", [id]);
}

export async function webhookCounts(db: Queryable): Promise<{ verified: number; processed: number }> {
  const { rows } = await db.query<{ verified: number; processed: number }>("SELECT count(*)::int AS verified, count(processed_at)::int AS processed FROM webhook_events WHERE verified");
  return rows[0] ?? { verified: 0, processed: 0 };
}

/** Batches with items whose fate PayPal hasn't settled yet, least recently read first. */
export async function batchesToReadBack(db: Queryable, settlementId: string, olderThanMinutes: number): Promise<number[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT b.id FROM payout_batches b
     WHERE b.settlement_id = $1 AND b.paypal_batch_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM payout_items i WHERE i.batch_id = b.id AND i.outcome IN ('PLANNED', 'IN_FLIGHT', 'UNCLAIMED', 'UNVERIFIED')
                   AND (i.read_at IS NULL OR i.read_at < now() - make_interval(mins => $2)))
     ORDER BY b.id`,
    [settlementId, olderThanMinutes],
  );
  return rows.map((r) => Number(r.id));
}

/** The latest payout item of a claim whose money came back, and how much came back. */
export async function moneyBack(db: Queryable, claimId: string): Promise<{ cents: number; at: Date | null; reoffers: number } | null> {
  const { rows } = await db.query<{ amount_cents: string; money_back_at: Date | null; reoffers: number }>(
    `SELECT i.amount_cents, c.money_back_at, c.reoffers FROM claims c
     JOIN LATERAL (SELECT amount_cents FROM payout_items x WHERE x.claim_id = c.id AND x.outcome IN ('RETURNED', 'FAILED') ORDER BY x.id DESC LIMIT 1) i ON true
     WHERE c.id = $1`,
    [claimId],
  );
  const r = rows[0];
  return r ? { cents: Number(r.amount_cents), at: r.money_back_at, reoffers: r.reoffers } : null;
}

/** This database's own name, part of every PayPal batch ID it sends (migration 0014). */
export async function deploymentInstance(db: Queryable): Promise<string> {
  const { rows } = await db.query<{ id: string }>("SELECT id FROM deployment_instance");
  const id = rows[0]?.id;
  if (!id) throw new Error("deployment_instance is empty: run the migrations");
  return id;
}
