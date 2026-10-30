import type { PayPalClient } from "./client.ts";
import type { Order } from "./types.ts";

/** The ledger's source of truth for captures and refund history (spec §3.5.3). */
export function getOrder(pp: PayPalClient, paypalOrderId: string, opt: { mockCode?: string } = {}): Promise<Order> {
  return pp.request<Order>("GET", `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`, opt);
}
