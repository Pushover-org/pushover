// D1-9 (spec §3.9): PayPal-Mock-Response on a refund POST returns the mocked error.
// The capture ID is bogus, so no money can move whatever happens.
// Run: node --env-file-if-exists=.env.local scripts/day1/d1-9-mock-response.ts
import { PayPalApiError, PayPalClient, refundCapture } from "@pushover/paypal";
import { countingClient, describeError } from "./common.ts";

const { client } = countingClient("guarded");
let pass = true;
console.log(`D1-9 run at ${new Date().toISOString()} against ${process.env["PAYPAL_API_BASE"]}`);
for (const mockCode of [undefined, "REFUND_AMOUNT_EXCEEDED", "TRANSACTION_DISPUTED"]) {
  try {
    const r = await refundCapture(client, {
      captureId: "PUSHOVERD19BOGUS",
      amountCents: 100,
      requestId: PayPalClient.newRequestId("d1-9"),
      customId: "D1-9",
      note: "D1-9 negative test",
      ...(mockCode === undefined ? {} : { mockCode }),
    });
    console.log(`mock=${mockCode ?? "none"}`, "UNEXPECTED success", JSON.stringify({ id: r.id, status: r.status }));
    pass = false;
  } catch (err) {
    const d = describeError(err);
    const ok = mockCode === undefined ? true : err instanceof PayPalApiError && err.issue === mockCode;
    if (mockCode !== undefined) pass &&= ok;
    console.log(`mock=${mockCode ?? "none (control)"}`, JSON.stringify(d), mockCode === undefined ? "(control)" : ok ? "OK" : "UNEXPECTED");
  }
}
console.log(pass ? "D1-9 PASS" : "D1-9 FAIL");
process.exitCode = pass ? 0 : 1;
