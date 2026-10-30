import type { PayPalClient } from "./client.ts";
import type { Money, Order } from "./types.ts";

/** The ledger's source of truth for captures and refund history (spec §3.5.3). */
export function getOrder(pp: PayPalClient, paypalOrderId: string, opt: { mockCode?: string } = {}): Promise<Order> {
  return pp.request<Order>("GET", `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`, opt);
}

export interface OrderItem {
  name: string;
  sku: string;
  quantity: string;
  unit_amount: Money;
  tax?: Money;
}

export interface CreatePurchaseUnit {
  reference_id: string;
  custom_id?: string;
  description?: string;
  amount: Money & { breakdown?: { item_total: Money; tax_total?: Money } };
  items?: OrderItem[];
}

/** `card` fields from checkout_orders_v2.json (`card_request` → `card`). Never logged. */
export interface CardSource {
  name: string;
  /** ^[0-9]{13,19}$ */
  number: string;
  /** YYYY-MM */
  expiry: string;
  security_code: string;
}

export interface CreateOrderArgs {
  purchaseUnits: CreatePurchaseUnit[];
  /** Required by PayPal for single-step create calls that carry a payment source. */
  requestId: string;
  card?: CardSource;
}

/** Seeding and replenishing only (spec §3.5.1). Pushover's agents never create orders. */
export function createOrder(pp: PayPalClient, a: CreateOrderArgs): Promise<Order> {
  return pp.request<Order>("POST", "/v2/checkout/orders", {
    requestId: a.requestId,
    prefer: "return=representation",
    body: {
      intent: "CAPTURE",
      purchase_units: a.purchaseUnits,
      ...(a.card === undefined ? {} : { payment_source: { card: a.card } }),
    },
  });
}

/** Key is derived from the order, so a retried capture can never capture twice (spec §3.5.2). */
export function captureOrder(pp: PayPalClient, paypalOrderId: string): Promise<Order> {
  return pp.request<Order>("POST", `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
    requestId: `capture-${paypalOrderId}`,
    prefer: "return=representation",
    body: {},
  });
}
