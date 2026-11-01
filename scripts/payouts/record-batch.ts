// Saves one page of GET /v1/payments/payouts/{id} as a test fixture (read-only; moves nothing).
//   node --env-file-if-exists=.env.local scripts/payouts/record-batch.ts <payout_batch_id> <out.json>
import { writeFileSync } from "node:fs";
import { limiterFromEnv, paypalClientFromEnv } from "@pushover/paypal";

const [batchId, out] = process.argv.slice(2);
if (!batchId || !out) throw new Error("usage: record-batch.ts <payout_batch_id> <out.json>");
const pp = paypalClientFromEnv("guarded", limiterFromEnv());
const raw = await pp.request<unknown>("GET", `/v1/payments/payouts/${encodeURIComponent(batchId)}?page=1&page_size=1000&total_required=true`);
writeFileSync(out, JSON.stringify(raw, null, 2) + "\n");
console.log(`saved ${out}`);
