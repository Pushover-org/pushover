import { listOrdersForCustomer, type Merchant, type Queryable } from "@pushover/db";

export interface LookupItem {
  sku: string;
  name: string;
  qty: number;
  unit_price: string;
  tax_per_unit: string;
  line_total: string;
}

export interface LookupOrder {
  order_ref: string;
  delivered_on: string;
  days_since_delivery: number;
  items: LookupItem[];
  total: string;
  currency: "USD";
  refunds: { amount: string; status: string; date: string }[];
  notes: string | null;
  /** Baseline only: PayPal's toolkit tools need these IDs (spec §5.3.2). */
  paypal_order_id?: string;
  paypal_capture_id?: string;
}

const usd = (cents: number) => (cents / 100).toFixed(2);
const DAY_MS = 86_400_000;

/**
 * lookup_my_orders for both agents: the SESSION customer's orders in one store, never anyone
 * else's. Refund history comes from the store's refund mirror (refunds table), which the
 * worker and the eval keep in sync with PayPal.
 */
export async function lookupMyOrders(
  db: Queryable,
  a: { merchant: Merchant; customerId: string; now: Date; includePayPalIds: boolean },
): Promise<{ customer_id: string; orders: LookupOrder[] }> {
  const orders = await listOrdersForCustomer(db, a.merchant, a.customerId);
  const captureIds = orders.flatMap((o) => (o.capture ? [o.capture.id] : []));
  const { rows: refunds } = await db.query<{ capture_id: string; amount_cents: number; paypal_status: string; created_at: Date }>(
    "SELECT capture_id, amount_cents, paypal_status, created_at FROM refunds WHERE capture_id = ANY($1) ORDER BY created_at",
    [captureIds],
  );
  return {
    customer_id: a.customerId,
    orders: orders.map((o) => {
      const delivered = o.deliveredAt ?? a.now;
      const view: LookupOrder = {
        order_ref: o.id,
        delivered_on: delivered.toISOString().slice(0, 10),
        days_since_delivery: Math.floor((a.now.getTime() - delivered.getTime()) / DAY_MS),
        items: o.items.map((i) => ({
          sku: i.sku, name: i.name, qty: i.qty, unit_price: usd(i.unitCents), tax_per_unit: usd(i.taxCents),
          line_total: usd(i.qty * (i.unitCents + i.taxCents)),
        })),
        total: usd(o.totalCents),
        currency: "USD",
        refunds: refunds
          .filter((r) => r.capture_id === o.capture?.id)
          .map((r) => ({ amount: usd(r.amount_cents), status: r.paypal_status, date: r.created_at.toISOString().slice(0, 10) })),
        notes: o.notes,
      };
      if (a.includePayPalIds) {
        view.paypal_order_id = o.paypalOrderId;
        if (o.capture) view.paypal_capture_id = o.capture.id;
      }
      return view;
    }),
  };
}
