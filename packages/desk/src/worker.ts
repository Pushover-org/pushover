// What happens to money after Distribute (spec R11; plan items P38, P39, C4). apps/worker runs
// these on a loop; each is safe to run again. None of them sends money: they read PayPal and move
// claims along the states the read-backs justify.
import {
  appendAudit, batchesToReadBack, getClaim, itemsAwaitingHistory, markWebhookProcessed, moneyBack, moveClaim, recordHistory, unprocessedWebhookEvents,
  withSettlementLock, type Pool,
} from "@proofofclaim/db";
import { findInHistory, type PayPalClient } from "@proofofclaim/paypal";
import { ClaimRejectedError, type Desk } from "./desk.ts";
import { readBack } from "./payout.ts";
import { lapseUnconfirmed } from "./assistants.ts";

/** How long a claimant has to ask for returned money again, unless the settlement sets otherwise. */
export const REOFFER_DAYS = 30;
export const MAX_REOFFERS = 2;
/** After this long, a payout still missing from PayPal's history is flagged, not waited on forever. */
export const NEVER_CAUGHT_UP_DAYS = 3;

const DAY = 86_400_000;

/**
 * C4: a claimant whose payment came back (RETURNED or FAILED) asks for it again, having fixed
 * their PayPal account. The claim goes back to approved and is paid in the next round, which two
 * people approve as usual. Refused after the window or after MAX_REOFFERS tries.
 */
export async function requestReoffer(desk: Desk, claimId: string, now = new Date()): Promise<void> {
  const days = desk.reofferDays ?? REOFFER_DAYS;
  await withSettlementLock(desk.pool, desk.settlement.id, async (tx) => {
    const c = await getClaim(tx, claimId);
    if (!c || c.settlementId !== desk.settlement.id || (c.status !== "RETURNED" && c.status !== "FAILED")) throw new ClaimRejectedError("Only a payment that came back can be sent again.");
    const back = await moneyBack(tx, claimId);
    if (!back) throw new ClaimRejectedError("No payment came back for this claim.");
    if (back.reoffers >= MAX_REOFFERS) throw new ClaimRejectedError("This payment has already been sent again twice. It goes to the court's chosen nonprofit.");
    if (back.at && now.getTime() - back.at.getTime() > days * DAY) throw new ClaimRejectedError("The time to ask for it again has passed. It goes to the court's chosen nonprofit.");
    await moveClaim(tx, claimId, c.status, "APPROVE");
    await tx.query("UPDATE claims SET reoffers = reoffers + 1, money_back_at = NULL WHERE id = $1", [claimId]);
    await appendAudit(tx, { actor: "claimant", action: "reoffer_requested", subject: claimId, detail: { cents: back.cents, try: back.reoffers + 1 } });
  });
}

/** Money that came back and wasn't asked for again within the window becomes cy-près eligible. */
export async function expireReoffers(desk: Desk, now = new Date()): Promise<number> {
  const days = desk.reofferDays ?? REOFFER_DAYS;
  const { rows } = await desk.pool.query<{ id: string; status: "RETURNED" | "FAILED" }>(
    "SELECT id, status FROM claims WHERE settlement_id = $1 AND status IN ('RETURNED', 'FAILED') AND money_back_at IS NOT NULL AND money_back_at < $2",
    [desk.settlement.id, new Date(now.getTime() - days * DAY)],
  );
  for (const r of rows) {
    await withSettlementLock(desk.pool, desk.settlement.id, async (tx) => {
      const c = await getClaim(tx, r.id);
      if (c?.status !== r.status) return;
      await moveClaim(tx, r.id, r.status, "CY_PRES_ELIGIBLE");
      await appendAudit(tx, { actor: "worker", action: "reoffer_expired", subject: r.id, detail: { after_days: days } });
    });
  }
  return rows.length;
}

/**
 * P39: is each payout in PayPal's own history yet? The history lags, so not-yet-available is
 * WAITING, and only after NEVER_CAUGHT_UP_DAYS is a missing one flagged.
 */
export async function confirmInHistory(desk: Desk, pp: PayPalClient, opt: { limit?: number; now?: Date } = {}): Promise<Record<string, number>> {
  const now = opt.now ?? new Date();
  const out: Record<string, number> = {};
  for (const it of await itemsAwaitingHistory(desk.pool, desk.settlement.id, opt.limit ?? 10)) {
    const r = await findInHistory(pp, { transactionId: it.transactionId, around: it.sentAt });
    const status = r.found ? "CONFIRMED" : now.getTime() - it.sentAt.getTime() > NEVER_CAUGHT_UP_DAYS * DAY ? "NEVER_CAUGHT_UP" : "WAITING";
    await recordHistory(desk.pool, { batchId: it.batchId, senderItemId: it.senderItemId, status, code: r.found ? `${r.eventCode} ${r.status}` : null });
    out[status] = (out[status] ?? 0) + 1;
  }
  return out;
}

/**
 * P38: a verified webhook only ever triggers a read-back of our own batch: its contents never
 * move a claim. Events for batches we don't know are marked done without calling PayPal.
 */
export async function processWebhooks(pool: Pool, pp: PayPalClient, deskFor: (settlementId: string) => Promise<Desk | null>, limit = 20): Promise<{ readBacks: number; ignored: number }> {
  let readBacks = 0;
  let ignored = 0;
  for (const e of await unprocessedWebhookEvents(pool, limit)) {
    const paypalBatchId = e.payload.resource?.payout_batch_id ?? e.payload.resource?.batch_header?.payout_batch_id;
    const { rows } = paypalBatchId ? await pool.query<{ id: string; settlement_id: string }>("SELECT id, settlement_id FROM payout_batches WHERE paypal_batch_id = $1", [paypalBatchId]) : { rows: [] };
    const ours = rows[0];
    const desk = ours ? await deskFor(ours.settlement_id) : null;
    if (ours && desk) {
      await readBack(desk, pp, Number(ours.id));
      readBacks++;
    } else {
      ignored++;
    }
    await markWebhookProcessed(pool, e.id);
  }
  return { readBacks, ignored };
}

export interface TickResult {
  readBacks: number;
  history: Record<string, number>;
  expired: number;
  /** Assistant filings nobody confirmed in time, now closed (P13). */
  lapsed: number;
}

/** One pass of the worker for one settlement: read back what isn't settled, check history, expire re-offers. */
export async function workerTick(desk: Desk, pp: PayPalClient, opt: { now?: Date; readBackEveryMinutes?: number; historyLimit?: number } = {}): Promise<TickResult> {
  let readBacks = 0;
  for (const batchId of await batchesToReadBack(desk.pool, desk.settlement.id, opt.readBackEveryMinutes ?? 10)) {
    await readBack(desk, pp, batchId);
    readBacks++;
  }
  const history = await confirmInHistory(desk, pp, { limit: opt.historyLimit ?? 10, ...(opt.now ? { now: opt.now } : {}) });
  const expired = await expireReoffers(desk, opt.now);
  const lapsed = await lapseUnconfirmed(desk, opt.now);
  return { readBacks, history, expired, lapsed };
}
