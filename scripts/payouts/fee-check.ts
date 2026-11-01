// node --env-file-if-exists=.env.local scripts/payouts/fee-check.ts
// Is the Payouts fee flat, or does it grow with the amount? So far it has only been seen on $1.00
// items. Sends three play-money items at different sizes and prints the fee PayPal reports.
import { createPayoutBatch, getPayoutBatch, limiterFromEnv, paypalClientFromEnv } from "@pushover/paypal";
import { setTimeout as sleep } from "node:timers/promises";

const pp = paypalClientFromEnv("guarded", limiterFromEnv());
const id = `rs-fee-check-${Date.now()}`;
const amounts = [1500, 7500, 25000];
const made = await createPayoutBatch(pp, {
  senderBatchId: id,
  emailSubject: "Fee check (sandbox)",
  emailMessage: "Sandbox play money.",
  items: amounts.map((cents, i) => ({ senderItemId: `fee-${cents}`, receiverEmail: `po-buyer${i + 2}-3h8w@personal.example.com`, cents })),
});
console.log("created", made.header.payout_batch_id, made.header.batch_status);
for (let i = 0; i < 12; i++) {
  await sleep(10_000);
  const b = await getPayoutBatch(pp, made.header.payout_batch_id);
  if (b.items.every((x) => x.transaction_status && x.transaction_status !== "PENDING")) {
    console.log("batch", b.batch_header.batch_status, "amount", b.batch_header.amount?.value, "fees", b.batch_header.fees?.value);
    for (const x of b.items) console.log(" ", x.payout_item.amount.value, x.transaction_status, "fee", x.payout_item_fee?.value);
    process.exit(0);
  }
}
console.log("not settled after 2 minutes");
process.exit(1);
