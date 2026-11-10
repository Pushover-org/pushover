import {
  createOrder,
  getOrder,
  limiterFromEnv,
  PayPalClient,
  paypalClientFromEnv,
  type CardSource,
  type PayPalApp,
  type Refund,
} from "@proofofclaim/paypal";

/** A client for one sandbox app whose fetch counts OAuth token requests. */
export function countingClient(app: PayPalApp): { client: PayPalClient; tokenRequests: () => number } {
  let tokens = 0;
  const fetchCounting: typeof fetch = (input, init) => {
    if (String(input).endsWith("/v1/oauth2/token")) tokens++;
    return fetch(input, init);
  };
  const client = paypalClientFromEnv(app, limiterFromEnv(), { fetch: fetchCounting, maxAttempts: 1 });
  return { client, tokenRequests: () => tokens };
}

/** Error fields that are safe to publish: no headers, no tokens. */
export function describeError(err: unknown) {
  if (err instanceof Error && "status" in err) {
    const e = err as Error & { status: number; issue?: string; debugId?: string; body?: { name?: string; message?: string } };
    return { type: e.name, status: e.status, name: e.body?.name, issue: e.issue, message: e.body?.message, debug_id: e.debugId };
  }
  return { type: err instanceof Error ? err.name : typeof err, message: err instanceof Error ? err.message : String(err) };
}

export function sandboxCard(): CardSource {
  const number = (process.env["SANDBOX_CARD_NUMBER"] ?? "").replace(/\D/g, "");
  const expiry = process.env["SANDBOX_CARD_EXPIRY"] ?? "";
  const security_code = process.env["SANDBOX_CARD_CVV"] ?? "";
  if (!number || !expiry || !security_code) throw new Error("set SANDBOX_CARD_NUMBER / _EXPIRY / _CVV in .env.local");
  return { name: "Dana Reyes", number, expiry, security_code };
}

/** A fresh $1.00 captured order paid by the sandbox card (D1-3 path). */
export async function freshCapture(client: PayPalClient, label: string): Promise<{ orderId: string; captureId: string }> {
  const order = await createOrder(client, {
    requestId: PayPalClient.newRequestId(`${label}-create`),
    card: sandboxCard(),
    purchaseUnits: [{ reference_id: `${label}-${Date.now()}`, description: `Pushover ${label} test`, amount: { currency_code: "USD", value: "1.00" } }],
  });
  const captureId = order.purchase_units?.[0]?.payments?.captures?.[0]?.id;
  if (order.status !== "COMPLETED" || !captureId) throw new Error(`fresh capture failed: order ${order.id} ${order.status}`);
  return { orderId: order.id, captureId };
}

/** Refunds PayPal reports on the order: the ledger's source of truth. */
export async function refundsOnOrder(client: PayPalClient, orderId: string): Promise<Pick<Refund, "id" | "status" | "amount">[]> {
  const order = await getOrder(client, orderId);
  return (order.purchase_units?.[0]?.payments?.refunds ?? []).map((r) => ({ id: r.id, status: r.status, ...(r.amount ? { amount: r.amount } : {}) }));
}
