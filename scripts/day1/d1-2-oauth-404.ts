// D1-2 (spec §3.9): OAuth works, the token is cached, and a 404 on a bogus order is parsed.
// Run: node --env-file-if-exists=.env.local scripts/day1/d1-2-oauth-404.ts
import { getOrder, PayPalApiError } from "@pushover/paypal";
import { countingClient, describeError } from "./common.ts";

let pass = true;
console.log(`D1-2 run at ${new Date().toISOString()} against ${process.env["PAYPAL_API_BASE"]}`);
for (const app of ["guarded", "baseline"] as const) {
  const { client, tokenRequests } = countingClient(app);
  for (const id of ["PUSHOVERD12BOGUS1", "PUSHOVERD12BOGUS2"]) {
    try {
      await getOrder(client, id);
      console.log(app, id, "UNEXPECTED: order exists");
      pass = false;
    } catch (err) {
      const d = describeError(err);
      const ok = err instanceof PayPalApiError && err.status === 404;
      pass &&= ok;
      console.log(app, `GET /v2/checkout/orders/${id}`, JSON.stringify(d), ok ? "OK" : "UNEXPECTED");
    }
  }
  const t = tokenRequests();
  pass &&= t === 1;
  console.log(app, `token requests for 2 API calls: ${t}`, t === 1 ? "OK (cached)" : "UNEXPECTED");
}
console.log(pass ? "D1-2 PASS" : "D1-2 FAIL");
process.exitCode = pass ? 0 : 1;
