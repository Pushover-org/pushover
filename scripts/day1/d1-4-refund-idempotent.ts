// D1-4 (spec §3.9): a refund repeated with the same PayPal-Request-Id must not refund twice.
// Also records what PayPal does when the same key is reused with a different amount.
// Moves $1.00 (capture) and $0.10–$0.30 (refunds) of play money on the guarded store.
// Run: node --env-file-if-exists=.env.local scripts/day1/d1-4-refund-idempotent.ts
import { PayPalClient, refundCapture } from "@pushover/paypal";
import { countingClient, describeError, freshCapture, refundsOnOrder } from "./common.ts";

const { client } = countingClient("guarded");
console.log(`D1-4 run at ${new Date().toISOString()} against ${process.env["PAYPAL_API_BASE"]}`);
const { orderId, captureId } = await freshCapture(client, "D14");
console.log("fresh capture:", JSON.stringify({ orderId, captureId }));

const key = PayPalClient.newRequestId("d1-4-refund");
const attempt = async (label: string, amountCents: number) => {
  try {
    const r = await refundCapture(client, { captureId, amountCents, requestId: key, customId: "D1-4", note: "D1-4 idempotency test" });
    console.log(label, JSON.stringify({ refund_id: r.id, status: r.status, amount: r.amount?.value }));
    return r.id;
  } catch (err) {
    console.log(label, "error:", JSON.stringify(describeError(err)));
    return undefined;
  }
};

const first = await attempt("1st  POST key=K amount=0.10:", 10);
const second = await attempt("2nd  POST key=K amount=0.10:", 10);
const third = await attempt("3rd  POST key=K amount=0.20 (same key, different body):", 20);
const refunds = await refundsOnOrder(client, orderId);
console.log("GET order refunds:", JSON.stringify(refunds));

const pass = first !== undefined && second === first && refunds.filter((r) => r.amount?.value === "0.10").length === 1;
console.log(`same key same body returned the same refund: ${second === first}`);
console.log(`same key different body: ${third === first ? "returned the ORIGINAL refund (body ignored)" : third ? "created a NEW refund" : "rejected"}`);
console.log(`refunds on order: ${refunds.length}`);
console.log(pass ? "D1-4 PASS" : "D1-4 FAIL");
process.exitCode = pass ? 0 : 1;
