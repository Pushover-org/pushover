import { withTransaction, type Pool, type Queryable } from "../pool.ts";
import type { Merchant, Order, OrderItem } from "../types.ts";

export interface PoolOrderInput {
  merchant: Merchant;
  ref: string;
  paypalOrderId: string;
  items: OrderItem[];
  captureId: string;
  captureStatus: string;
  amountCents: number;
}

/** Stores a captured but unassigned order. Returns false if that capture is already stored. */
export async function insertPoolOrder(pool: Pool, o: PoolOrderInput): Promise<boolean> {
  const total = o.items.reduce((s, i) => s + i.qty * (i.unitCents + i.taxCents), 0);
  if (total !== o.amountCents) throw new Error(`${o.ref}: items total ${total} != captured ${o.amountCents}`);
  return withTransaction(pool, async (c) => {
    const exists = await c.query("SELECT 1 FROM captures WHERE id = $1", [o.captureId]);
    if (exists.rowCount) return false;
    await c.query("INSERT INTO orders (merchant, id, paypal_order_id, total_cents) VALUES ($1, $2, $3, $4)", [
      o.merchant, o.ref, o.paypalOrderId, o.amountCents,
    ]);
    for (const i of o.items) {
      await c.query(
        "INSERT INTO order_items (merchant, order_id, sku, name, qty, unit_cents, tax_cents) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [o.merchant, o.ref, i.sku, i.name, i.qty, i.unitCents, i.taxCents],
      );
    }
    await c.query(
      "INSERT INTO captures (id, merchant, order_id, amount_cents, paypal_status, state, last_synced_at) VALUES ($1, $2, $3, $4, $5, 'POOL', now())",
      [o.captureId, o.merchant, o.ref, o.amountCents, o.captureStatus],
    );
    return true;
  });
}

/** Gives a pool order an owner and a delivery date (fixture checkout, spec §5.6.1). */
export async function assignOrder(
  db: Queryable,
  a: { merchant: Merchant; ref: string; customerId: string; deliveredAt: Date; scenarioId: string; notes?: string },
): Promise<void> {
  const res = await db.query(
    `UPDATE orders SET customer_id = $3, delivered_at = $4, scenario_id = $5, notes = $6
     WHERE merchant = $1 AND id = $2 AND customer_id IS NULL`,
    [a.merchant, a.ref, a.customerId, a.deliveredAt, a.scenarioId, a.notes ?? null],
  );
  if (res.rowCount !== 1) throw new Error(`${a.merchant} ${a.ref} is not an unassigned order`);
  await db.query("UPDATE captures SET state = 'ASSIGNED' WHERE merchant = $1 AND order_id = $2", [a.merchant, a.ref]);
}

interface OrderRow {
  merchant: Merchant;
  id: string;
  customer_id: string | null;
  paypal_order_id: string;
  total_cents: number;
  delivered_at: Date | null;
  notes: string | null;
  scenario_id: string | null;
  items: { sku: string; name: string; qty: number; unit_cents: number; tax_cents: number }[];
  capture: { id: string; amount_cents: number; paypal_status: string; state: "POOL" | "ASSIGNED" | "RETIRED" } | null;
}

const SELECT_ORDER = `
  SELECT o.merchant, o.id, o.customer_id, o.paypal_order_id, o.total_cents, o.delivered_at, o.notes, o.scenario_id,
    coalesce((SELECT json_agg(json_build_object('sku', i.sku, 'name', i.name, 'qty', i.qty,
                'unit_cents', i.unit_cents, 'tax_cents', i.tax_cents) ORDER BY i.sku)
              FROM order_items i WHERE i.merchant = o.merchant AND i.order_id = o.id), '[]') AS items,
    (SELECT json_build_object('id', c.id, 'amount_cents', c.amount_cents, 'paypal_status', c.paypal_status, 'state', c.state)
       FROM captures c WHERE c.merchant = o.merchant AND c.order_id = o.id) AS capture
  FROM orders o`;

function toOrder(r: OrderRow): Order {
  return {
    merchant: r.merchant,
    id: r.id,
    customerId: r.customer_id,
    paypalOrderId: r.paypal_order_id,
    totalCents: r.total_cents,
    deliveredAt: r.delivered_at,
    notes: r.notes,
    scenarioId: r.scenario_id,
    items: r.items.map((i) => ({ sku: i.sku, name: i.name, qty: i.qty, unitCents: i.unit_cents, taxCents: i.tax_cents })),
    capture: r.capture
      ? { id: r.capture.id, amountCents: r.capture.amount_cents, paypalStatus: r.capture.paypal_status, state: r.capture.state }
      : null,
  };
}

/** One order by store ref, whoever owns it. The ledger compares the owner with the session. */
export async function getOrder(db: Queryable, merchant: Merchant, ref: string): Promise<Order | null> {
  const { rows } = await db.query<OrderRow>(`${SELECT_ORDER} WHERE o.merchant = $1 AND o.id = $2`, [merchant, ref]);
  return rows[0] ? toOrder(rows[0]) : null;
}

/**
 * Orders owned by one customer in one store, newest delivery first. Parameterized by the
 * SESSION customer, so it cannot return anyone else's orders (spec §7.1, lookup_my_orders).
 */
export async function listOrdersForCustomer(db: Queryable, merchant: Merchant, customerId: string): Promise<Order[]> {
  const { rows } = await db.query<OrderRow>(
    `${SELECT_ORDER} WHERE o.merchant = $1 AND o.customer_id = $2 ORDER BY o.delivered_at DESC, o.id`,
    [merchant, customerId],
  );
  return rows.map(toOrder);
}

export async function countPoolCaptures(db: Queryable, merchant: Merchant): Promise<number> {
  const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM captures WHERE merchant = $1 AND state = 'POOL'", [merchant]);
  return rows[0]?.n ?? 0;
}
