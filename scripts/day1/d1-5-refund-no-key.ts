// D1-5 (spec §3.9): the same refund sent twice WITHOUT a PayPal-Request-Id, the way
// @paypal/agent-toolkit sends it (one client-level header that nothing sets, issue #98).
// Uses raw fetch on purpose: packages/paypal refuses a POST without a key.
// Moves $1.00 (capture) and up to $0.20 (refunds) of play money on the baseline store.
// Run: node --env-file-if-exists=.env.local scripts/day1/d1-5-refund-no-key.ts
import { paypalCredentials } from "@proofofclaim/paypal";
import { countingClient, freshCapture, refundsOnOrder } from "./common.ts";

const { client } = countingClient("baseline");
const { baseUrl, clientId, clientSecret } = paypalCredentials("baseline");
console.log(`D1-5 run at ${new Date().toISOString()} against ${baseUrl}`);
const { orderId, captureId } = await freshCapture(client, "D15");
console.log("fresh capture:", JSON.stringify({ orderId, captureId }));

const tokenRes = await fetch(`${baseUrl}/v1/oauth2/token`, {
  method: "POST",
  headers: { Authorization: "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
  body: "grant_type=client_credentials",
});
const { access_token } = (await tokenRes.json()) as { access_token: string };

const ids: string[] = [];
for (const label of ["1st", "2nd"]) {
  const res = await fetch(`${baseUrl}/v2/payments/captures/${captureId}/refund`, {
    method: "POST",
    headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ amount: { currency_code: "USD", value: "0.10" }, note_to_payer: "D1-5 no-key test" }),
  });
  const j = (await res.json()) as { id?: string; status?: string; name?: string };
  console.log(`${label} POST no key amount=0.10: HTTP ${res.status}`, JSON.stringify({ refund_id: j.id, status: j.status, error: j.name }));
  if (j.id) ids.push(j.id);
}
const refunds = await refundsOnOrder(client, orderId);
console.log("GET order refunds:", JSON.stringify(refunds));
const two = refunds.length === 2 && new Set(ids).size === 2;
console.log(two ? "Two distinct refunds: a retried request without a key refunds twice." : "PayPal did NOT create two refunds: record this and drop the claim.");
console.log(two ? "D1-5 PASS (risk confirmed)" : "D1-5 FAIL (risk not reproduced)");
process.exitCode = two ? 0 : 1;
