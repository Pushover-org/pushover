// Fixture checkout and PayPal read-back (spec §5.6.1, §5.6.2). Every item gets fresh
// customers and pool captures that no other item touches.
import { setTimeout as sleep } from "node:timers/promises";
import { assignOrder, upsertCustomer, withTransaction, type Merchant, type Pool, type Queryable } from "@pushover/db";
import { getOrder, refundCapture, valueToCents, type PayPalClient } from "@pushover/paypal";
import type { CorpusItem, OrderSlot } from "./corpus.ts";
import { slotsOf, type Fixture, type FixtureItem, type FixtureOrder, type SeenRefund } from "./fixtures.ts";

const DAY_MS = 86_400_000;
const BIG_SKU = "JACKET-01";

/** Pool orders that fit a slot kind. Multi orders need a qty-1 line for ITEM_1. */
const KIND_SQL: Record<OrderSlot["kind"], string> = {
  big: `EXISTS (SELECT 1 FROM order_items i WHERE i.merchant = o.merchant AND i.order_id = o.id AND i.sku = '${BIG_SKU}')`,
  normal: `o.total_cents <= 25000 AND NOT EXISTS (SELECT 1 FROM order_items i WHERE i.merchant = o.merchant AND i.order_id = o.id AND i.sku = '${BIG_SKU}')`,
  multi: `o.total_cents <= 25000
    AND (SELECT count(*) FROM order_items i WHERE i.merchant = o.merchant AND i.order_id = o.id) >= 2
    AND EXISTS (SELECT 1 FROM order_items i WHERE i.merchant = o.merchant AND i.order_id = o.id AND i.qty = 1)`,
};

interface PickedRow {
  id: string;
  paypal_order_id: string;
  total_cents: number;
  capture_id: string;
  items: { sku: string; name: string; qty: number; unit_cents: number; tax_cents: number }[];
}

/** How many unassigned pool orders of each kind a merchant has (multi orders are also normal). */
export async function poolCounts(db: Queryable, merchant: Merchant): Promise<Record<OrderSlot["kind"], number>> {
  const count = async (kind: OrderSlot["kind"]) => {
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM orders o JOIN captures c ON c.merchant = o.merchant AND c.order_id = o.id
       WHERE o.merchant = $1 AND c.state = 'POOL' AND o.customer_id IS NULL AND ${KIND_SQL[kind]}`,
      [merchant],
    );
    return rows[0]?.n ?? 0;
  };
  return { big: await count("big"), normal: await count("normal"), multi: await count("multi") };
}

export interface CheckoutArgs {
  merchant: Merchant;
  runId: string;
  item: CorpusItem;
  now: Date;
}

/**
 * Creates the item's customers, assigns pool orders to its slots (scarcest kinds first),
 * and runs any setup refund at PayPal. The setup refund's key derives from run and item,
 * so a retried setup can never refund twice.
 */
export async function checkout(db: Pool, pp: PayPalClient, a: CheckoutArgs): Promise<Fixture> {
  const tag = `${a.runId}/${a.item.id}`;
  const selfId = `E-${a.runId}-${a.item.id}`;
  const foreignId = `${selfId}-F`;
  const slots = slotsOf(a.item.scenario).sort(([, x], [, y]) => rank(x) - rank(y));

  const orders = await withTransaction(db, async (c) => {
    for (const id of [selfId, foreignId]) {
      await upsertCustomer(c, { merchant: a.merchant, id, displayName: "Eval customer", email: `${id.toLowerCase()}@eval.invalid` });
    }
    const out: FixtureOrder[] = [];
    for (const [slot, spec] of slots) {
      const { rows } = await c.query<PickedRow>(
        `SELECT o.id, o.paypal_order_id, o.total_cents, c.id AS capture_id,
           (SELECT json_agg(json_build_object('sku', i.sku, 'name', i.name, 'qty', i.qty, 'unit_cents', i.unit_cents, 'tax_cents', i.tax_cents) ORDER BY i.sku)
              FROM order_items i WHERE i.merchant = o.merchant AND i.order_id = o.id) AS items
         FROM orders o JOIN captures c ON c.merchant = o.merchant AND c.order_id = o.id
         WHERE o.merchant = $1 AND c.state = 'POOL' AND o.customer_id IS NULL AND ${KIND_SQL[spec.kind]}
         ORDER BY ${spec.kind === "normal" ? `(${KIND_SQL.multi}), ` : ""}o.id LIMIT 1 FOR UPDATE OF o SKIP LOCKED`,
        [a.merchant],
      );
      const r = rows[0];
      if (!r) throw new Error(`${tag}: no ${spec.kind} pool order left for ${slot}; run pnpm seed --merchant ${a.merchant.toLowerCase()} and pnpm db:seed`);
      const ownerId = spec.owner === "self" ? selfId : foreignId;
      const deliveredAt = new Date(a.now.getTime() - spec.deliveredDaysAgo * DAY_MS);
      await assignOrder(c, { merchant: a.merchant, ref: r.id, customerId: ownerId, deliveredAt, scenarioId: tag });
      const items: FixtureItem[] = r.items.map((i) => ({ sku: i.sku, name: i.name, qty: i.qty, unitCents: i.unit_cents, taxCents: i.tax_cents }));
      out.push({
        slot, ref: r.id, customerId: ownerId, deliveredAt, paypalOrderId: r.paypal_order_id, captureId: r.capture_id,
        totalCents: r.total_cents, items, item1Sku: spec.kind === "multi" ? (items.find((i) => i.qty === 1)?.sku ?? null) : null,
        setupRefundedByItemCents: {},
      });
    }
    return out;
  });

  for (const [slot, spec] of slots) {
    if (!("itemRefundedInSetup" in spec && spec.itemRefundedInSetup)) continue;
    const o = orders.find((x) => x.slot === slot);
    const it = o?.items.find((i) => i.sku === o.item1Sku);
    if (!o || !it) throw new Error(`${tag}: ${slot} has no ITEM_1 to refund in setup`);
    const cents = it.qty * (it.unitCents + it.taxCents);
    const key = `eval-setup-${a.runId}-${a.item.id}`;
    await refundCapture(pp, { captureId: o.captureId, amountCents: cents, requestId: key, customId: key, note: `Refund for ${it.name}, order ${o.ref}` });
    o.setupRefundedByItemCents = { [it.sku]: cents };
  }
  // Re-order to the scenario's own slot order, for stable output.
  const order = slotsOf(a.item.scenario).map(([s]) => s);
  orders.sort((x, y) => order.indexOf(x.slot) - order.indexOf(y.slot));
  return { scenario: a.item.scenario, selfCustomerId: selfId, foreignCustomerId: foreignId, now: a.now, orders };
}

function rank(s: OrderSlot): number {
  return s.kind === "big" ? 0 : s.kind === "multi" ? 1 : 2;
}

/** Every refund PayPal shows on the fixture's orders. null if any read fails: unknown, never empty. */
export async function readRefunds(pp: PayPalClient, fx: Fixture): Promise<SeenRefund[] | null> {
  const out: SeenRefund[] = [];
  try {
    for (const o of fx.orders) {
      const order = await getOrder(pp, o.paypalOrderId);
      for (const u of order.purchase_units ?? []) {
        for (const r of u.payments?.refunds ?? []) {
          if (!r.amount) return null; // an amount we cannot read is unknown, not zero
          out.push({ id: r.id, captureId: o.captureId, cents: valueToCents(r.amount.value), status: r.status, createTime: r.create_time ?? null });
        }
      }
    }
  } catch {
    return null;
  }
  return out;
}

/** Waits, then reads; re-reads up to 3 times while a new refund is PENDING (spec §5.6.2). */
export async function readRefundsSettled(pp: PayPalClient, fx: Fixture, before: SeenRefund[], waitMs = 5000): Promise<SeenRefund[] | null> {
  const known = new Set(before.map((r) => r.id));
  let after: SeenRefund[] | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    await sleep(waitMs);
    after = await readRefunds(pp, fx);
    if (after === null || !after.some((r) => !known.has(r.id) && r.status === "PENDING")) return after;
  }
  return after;
}

/**
 * Mirrors PayPal's refunds into the store's refunds table, so lookup_my_orders shows the
 * customer what was already refunded on the next turn, as a real store would.
 */
export async function mirrorRefunds(db: Queryable, refunds: SeenRefund[], source: "BASELINE_AGENT" | "EXTERNAL", now: Date): Promise<void> {
  for (const r of refunds) {
    await db.query(
      `INSERT INTO refunds (id, capture_id, amount_cents, paypal_status, source, created_at) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET paypal_status = EXCLUDED.paypal_status, synced_at = now()`,
      [r.id, r.captureId, r.cents, r.status, source, r.createTime ?? now.toISOString()],
    );
  }
}
