// D1-3 (spec §3.9, §3.6 Path A): create an order paid by a sandbox card, capture it,
// and get a capture ID back with no buyer clicking Approve. Moves $1.00 of play money per app.
// Run: node --env-file-if-exists=.env.local scripts/day1/d1-3-card-seed.ts
import { captureOrder, createOrder, PayPalClient, type Order } from "@proofofclaim/paypal";
import { countingClient, describeError, sandboxCard } from "./common.ts";

function summary(o: Order) {
  const pu = o.purchase_units?.[0];
  const cap = pu?.payments?.captures?.[0];
  return { order_id: o.id, order_status: o.status, capture_id: cap?.id, capture_status: cap?.status, amount: cap?.amount?.value };
}

const card = sandboxCard();
let pass = true;
console.log(`D1-3 run at ${new Date().toISOString()} against ${process.env["PAYPAL_API_BASE"]}`);
for (const app of ["guarded", "baseline"] as const) {
  const { client } = countingClient(app);
  const ref = `D13-${app}-${Date.now()}`;
  try {
    let order = await createOrder(client, {
      requestId: PayPalClient.newRequestId("d1-3-create"),
      card,
      purchaseUnits: [{ reference_id: ref, custom_id: "C-1042", description: "Pushover D1-3 seeding test", amount: { currency_code: "USD", value: "1.00" } }],
    });
    console.log(app, "create:", JSON.stringify(summary(order)));
    if (order.status !== "COMPLETED") {
      order = await captureOrder(client, order.id);
      console.log(app, "capture:", JSON.stringify(summary(order)));
    }
    const s = summary(order);
    const ok = s.order_status === "COMPLETED" && s.capture_status === "COMPLETED" && !!s.capture_id;
    pass &&= ok;
    console.log(app, ok ? "OK" : "UNEXPECTED");
  } catch (err) {
    pass = false;
    console.log(app, "error:", JSON.stringify(describeError(err)), JSON.stringify((err as { body?: { details?: unknown } }).body?.details ?? null));
  }
}
console.log(pass ? "D1-3 PASS" : "D1-3 FAIL");
process.exitCode = pass ? 0 : 1;
