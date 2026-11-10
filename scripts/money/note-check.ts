// node --env-file-if-exists=.env.local scripts/money/note-check.ts
// Plan item P36's check: does PayPal keep an item's note, so its own record names the approved
// plan? Sends one $1.00 play-money item to sandbox buyer 2 with a plan-digest note, reads the
// batch back, and prints what PayPal returns for the note and the email message.
import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { createPayoutBatch, getPayoutBatch, limiterFromEnv, paypalClientFromEnv } from "@proofofclaim/paypal";

const pp = paypalClientFromEnv("guarded", limiterFromEnv());
const hash = createHash("sha256").update(`note-check ${Date.now()}`).digest("hex");
const note = `Proof of Claim note-check claims round 1, plan sha256:${hash}`;
const id = `poc-note-check-${Date.now()}`;
const made = await createPayoutBatch(pp, {
  senderBatchId: id, emailSubject: "Note check (sandbox)", emailMessage: `Sandbox play money. Plan sha256:${hash.slice(0, 16)}.`,
  items: [{ senderItemId: "note-check", receiverEmail: "po-buyer2-3h8w@personal.example.com", cents: 100, note }],
});
console.log("created", made.header.payout_batch_id, made.header.batch_status);
for (let i = 0; i < 12; i++) {
  await sleep(10_000);
  const b = await getPayoutBatch(pp, made.header.payout_batch_id);
  const it = b.items[0];
  if (it?.transaction_status && it.transaction_status !== "PENDING") {
    console.log("item", it.transaction_status, "fee", it.payout_item_fee?.value);
    console.log("note kept:", it.payout_item.note === note, JSON.stringify(it.payout_item.note));
    console.log("email message:", JSON.stringify(b.batch_header.sender_batch_header.email_message));
    process.exit(it.payout_item.note === note ? 0 : 1);
  }
}
console.log("not settled after 2 minutes");
process.exit(1);
