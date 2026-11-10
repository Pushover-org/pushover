// Real sandbox Payouts batch (spec R2): one item to a sandbox buyer (expect SUCCESS) and one to an
// address with no PayPal account (expect UNCLAIMED, RECEIVER_UNREGISTERED). Then both duplicate
// protections: the same request again, and the same sender_batch_id under a new PayPal-Request-Id.
// Moves $2.00 of play money plus fees from the guarded (settlement fund) account.
import { describe, expect, it } from "vitest";
import { PayPalApiError } from "../src/errors.ts";
import { limiterFromEnv, paypalClientFromEnv } from "../src/env.ts";
import { buildPayoutRequest, createPayoutBatch, getPayoutBatch, payoutItemOutcome, type PayoutBatch } from "../src/payouts.ts";

const hasCreds = Boolean(process.env["PAYPAL_GUARDED_CLIENT_ID"] && process.env["PAYPAL_GUARDED_CLIENT_SECRET"]);

describe.skipIf(!hasCreds)("Payouts against the PayPal sandbox", () => {
  const pp = paypalClientFromEnv("guarded", limiterFromEnv());
  const stamp = Date.now();
  const args = {
    senderBatchId: `poc-sandbox-${stamp}`,
    emailSubject: "Proof of Claim sandbox test",
    emailMessage: "Sandbox test payout (play money).",
    items: [
      { senderItemId: "claim-paid", receiverEmail: "po-buyer4-3h8w@personal.example.com", cents: 100 },
      { senderItemId: "claim-unclaimed", receiverEmail: `poc-unregistered-${stamp}@example.com`, cents: 100 },
    ],
  };

  it("pays one item and leaves the unregistered one UNCLAIMED; duplicates are refused", async () => {
    const { header, duplicate } = await createPayoutBatch(pp, args);
    expect(duplicate).toBe(false);
    console.log("created", JSON.stringify({ payout_batch_id: header.payout_batch_id, batch_status: header.batch_status, sender_batch_id: args.senderBatchId }));

    let batch: PayoutBatch | undefined;
    for (let i = 0; i < 24; i++) {
      batch = await getPayoutBatch(pp, header.payout_batch_id);
      const settled = batch.items.length === 2 && batch.items.every((it) => payoutItemOutcome(it.transaction_status) !== "IN_FLIGHT");
      if (settled && batch.batch_header.batch_status !== "PENDING" && batch.batch_header.batch_status !== "PROCESSING") break;
      await new Promise((r) => setTimeout(r, 5000));
    }
    const h = batch!.batch_header;
    console.log("batch", JSON.stringify({ batch_status: h.batch_status, amount: h.amount, fees: h.fees, time_completed: h.time_completed }));
    for (const it of batch!.items) {
      console.log("item", JSON.stringify({ id: it.payout_item_id, sender_item_id: it.payout_item.sender_item_id, status: it.transaction_status, outcome: payoutItemOutcome(it.transaction_status), fee: it.payout_item_fee?.value, error: it.errors?.name }));
    }
    const bySender = new Map(batch!.items.map((it) => [it.payout_item.sender_item_id, it]));
    expect(bySender.get("claim-paid")?.transaction_status).toBe("SUCCESS");
    expect(bySender.get("claim-unclaimed")?.transaction_status).toBe("UNCLAIMED");
    expect(bySender.get("claim-unclaimed")?.errors?.name).toBe("RECEIVER_UNREGISTERED");

    // Same request, same PayPal-Request-Id: PayPal refuses it (400, sender_batch_id exists) and
    // links the original; createPayoutBatch returns that batch as a duplicate.
    const again = await createPayoutBatch(pp, args);
    console.log("same request again", JSON.stringify({ duplicate: again.duplicate, payout_batch_id: again.header.payout_batch_id, batch_status: again.header.batch_status }));
    expect(again).toMatchObject({ duplicate: true, header: { payout_batch_id: header.payout_batch_id } });

    // Same sender_batch_id, new PayPal-Request-Id: the spec says PayPal rejects it.
    const dup = await pp
      .request("POST", "/v1/payments/payouts", { requestId: `${args.senderBatchId}-retry`, body: buildPayoutRequest(args) })
      .then((r) => ({ accepted: r }), (e: unknown) => ({ rejected: e }));
    if ("rejected" in dup) {
      const e = dup.rejected as PayPalApiError;
      console.log("same sender_batch_id, new key", JSON.stringify({ status: e.status, name: (e.body as { name?: string })?.name, issue: e.issue, debug_id: e.debugId, message: (e.body as { message?: string })?.message }));
      expect(e).toBeInstanceOf(PayPalApiError);
      expect(e.status).toBeGreaterThanOrEqual(400);
      expect(e.status).toBeLessThan(500);
    } else {
      console.log("same sender_batch_id, new key ACCEPTED", JSON.stringify(dup.accepted));
      throw new Error("PayPal accepted a reused sender_batch_id");
    }
  });
});
