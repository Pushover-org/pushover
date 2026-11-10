// Can Payouts pay the exact account that logged in? Sends $1.00 of play money with
// recipient_type PAYPAL_ID to the payer_id saved by try-login.ts, then, in a second batch, to a
// made-up ID, to see how a bad one fails. Run from the repo root, after try-login.ts code:
//   node --env-file-if-exists=.env.local scripts/identity/pay-payer-id.ts
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { getPayoutBatch, limiterFromEnv, paypalClientFromEnv, type PayoutBatch } from "@proofofclaim/paypal";

const payerId = readFileSync(".data/identity/payer-id.txt", "utf8").trim();
const pp = paypalClientFromEnv("guarded", limiterFromEnv(), { maxAttempts: 1 });
const mask = (s: string) => `${s.slice(0, 3)}…${s.slice(-2)}`;

async function payOne(label: string, receiver: string): Promise<void> {
  const id = `poc-payer-id-${label}-${Date.now()}`;
  const body = {
    sender_batch_header: { sender_batch_id: id, email_subject: "PAYPAL_ID test (sandbox)", email_message: "Sandbox play money." },
    items: [{ recipient_type: "PAYPAL_ID", amount: { currency: "USD", value: "1.00" }, receiver, sender_item_id: `${label}-1` }],
  };
  console.log(`\n${label}: receiver ${mask(receiver)} (${receiver.length} chars), sender_batch_id ${id}`);
  let made: { batch_header: { payout_batch_id: string; batch_status: string } };
  try {
    made = await pp.request("POST", "/v1/payments/payouts", { body, requestId: id });
  } catch (err) {
    const e = err as { name?: string; lastError?: { status?: number; issue?: string; debugId?: string } };
    console.log("  create failed", JSON.stringify({ type: e.name, status: e.lastError?.status, issue: e.lastError?.issue, debug_id: e.lastError?.debugId }));
    return;
  }
  console.log("  created", made.batch_header.payout_batch_id, made.batch_header.batch_status);
  for (let i = 0; i < 12; i++) {
    await sleep(10_000);
    const b: PayoutBatch = await getPayoutBatch(pp, made.batch_header.payout_batch_id);
    const it = b.items[0];
    if (it?.transaction_status && it.transaction_status !== "PENDING") {
      console.log("  batch", b.batch_header.batch_status, "fees", b.batch_header.fees?.value);
      console.log("  item", it.payout_item_id, it.transaction_status, "type", it.payout_item.recipient_type, "receiver", mask(it.payout_item.receiver), "error", it.errors?.name ?? "-");
      return;
    }
  }
  console.log("  not settled after 2 minutes");
}

await payOne("real", payerId);
await payOne("madeup", "ZZZZZZZZZZZZZ");
