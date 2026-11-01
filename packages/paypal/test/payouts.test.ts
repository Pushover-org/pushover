import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PayPalUnknownOutcomeError } from "../src/errors.ts";
import { valueToCents } from "../src/money.ts";
import {
  buildPayoutRequest,
  cancelPayoutItem,
  createPayoutBatch,
  getPayoutBatch,
  PayoutBatchMismatchError,
  payoutItemOutcome,
  type PayoutItemStatus,
} from "../src/payouts.ts";
import { fakePayPal, json, makeClient } from "./fake.ts";

/** Recorded from the sandbox: batch 7ZRZDZZLRGEAY, 3 × $1.00 (2 SUCCESS, 1 UNCLAIMED). */
const recorded = JSON.parse(readFileSync(new URL("./fixtures/payout-batch-7ZRZDZZLRGEAY.json", import.meta.url), "utf8"));

const args = {
  senderBatchId: "rs-demo-2026-11-01-a",
  emailSubject: "Your settlement payment",
  emailMessage: "Your claim was approved.",
  items: [
    { senderItemId: "claim-1", receiverEmail: "po-buyer2-3h8w@personal.example.com", cents: 2310 },
    { senderItemId: "claim-2", receiverEmail: "nobody@example.com", cents: 2310, note: "Claim RS-0002" },
  ],
};

describe("buildPayoutRequest", () => {
  it("uses Payouts money ({currency, value}) and email receivers", () => {
    expect(buildPayoutRequest(args)).toEqual({
      sender_batch_header: { sender_batch_id: "rs-demo-2026-11-01-a", email_subject: "Your settlement payment", email_message: "Your claim was approved." },
      items: [
        { recipient_type: "EMAIL", amount: { currency: "USD", value: "23.10" }, receiver: "po-buyer2-3h8w@personal.example.com", sender_item_id: "claim-1" },
        { recipient_type: "EMAIL", amount: { currency: "USD", value: "23.10" }, receiver: "nobody@example.com", sender_item_id: "claim-2", note: "Claim RS-0002" },
      ],
    });
  });

  it.each([
    ["no items", { ...args, items: [] }],
    ["a duplicate sender_item_id", { ...args, items: [args.items[0]!, args.items[0]!] }],
    ["zero cents", { ...args, items: [{ ...args.items[0]!, cents: 0 }] }],
    ["fractional cents", { ...args, items: [{ ...args.items[0]!, cents: 10.5 }] }],
    ["a sender_item_id over 63 characters", { ...args, items: [{ ...args.items[0]!, senderItemId: "x".repeat(64) }] }],
    ["a sender_batch_id with spaces", { ...args, senderBatchId: "rs demo" }],
    ["a receiver that is not an email", { ...args, items: [{ ...args.items[0]!, receiverEmail: "buyer2" }] }],
  ])("refuses %s before calling PayPal", (_label, bad) => {
    expect(() => buildPayoutRequest(bad)).toThrow();
  });
});

describe("createPayoutBatch", () => {
  it("POSTs with PayPal-Request-Id = sender_batch_id", async () => {
    const pp = fakePayPal([json(201, { batch_header: { payout_batch_id: "B1", batch_status: "PENDING", sender_batch_header: { sender_batch_id: args.senderBatchId } } })]);
    const { client } = makeClient(pp.fetch);
    const { header, duplicate } = await createPayoutBatch(client, args);
    expect(header).toMatchObject({ payout_batch_id: "B1", batch_status: "PENDING" });
    expect(duplicate).toBe(false);
    const call = pp.calls[0]!;
    expect(call.method).toBe("POST");
    expect(call.url).toBe("https://api-m.sandbox.paypal.com/v1/payments/payouts");
    expect(call.headers["PayPal-Request-Id"]).toBe(args.senderBatchId);
    expect(JSON.parse(call.body!)).toEqual(buildPayoutRequest(args));
  });

  it("throws when PayPal returns a different batch for this key (reused key, D1-4)", async () => {
    const pp = fakePayPal([json(201, { batch_header: { payout_batch_id: "OLD", batch_status: "SUCCESS", sender_batch_header: { sender_batch_id: "rs-old" } } })]);
    const { client } = makeClient(pp.fetch);
    await expect(createPayoutBatch(client, args)).rejects.toBeInstanceOf(PayoutBatchMismatchError);
  });

  it("treats PayPal's 'sender_batch_id already exists' 400 as the original batch, not a failure", async () => {
    const dupBody = JSON.parse(readFileSync(new URL("./fixtures/payout-duplicate-sender-batch-id.json", import.meta.url), "utf8"));
    const original = { batch_header: { payout_batch_id: "FPXZYK4U4ZA9Y", batch_status: "SUCCESS", sender_batch_header: { sender_batch_id: args.senderBatchId } } };
    const pp = fakePayPal([json(400, dupBody), json(200, original)]);
    const { client } = makeClient(pp.fetch);
    const res = await createPayoutBatch(client, args);
    expect(res).toEqual({ header: original.batch_header, duplicate: true });
    expect(pp.calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual(["POST /v1/payments/payouts", "GET /v1/payments/payouts/FPXZYK4U4ZA9Y"]);
  });

  it("does not mistake other 400s for a duplicate", async () => {
    const pp = fakePayPal([json(400, { name: "VALIDATION_ERROR", details: [{ field: "items[0].receiver", issue: "bad" }] })]);
    const { client } = makeClient(pp.fetch);
    await expect(createPayoutBatch(client, args)).rejects.toMatchObject({ status: 400 });
  });

  it("still checks the linked batch really carries our sender_batch_id", async () => {
    const dupBody = JSON.parse(readFileSync(new URL("./fixtures/payout-duplicate-sender-batch-id.json", import.meta.url), "utf8"));
    const other = { batch_header: { payout_batch_id: "FPXZYK4U4ZA9Y", batch_status: "SUCCESS", sender_batch_header: { sender_batch_id: "rs-someone-else" } } };
    const { client } = makeClient(fakePayPal([json(400, dupBody), json(200, other)]).fetch);
    await expect(createPayoutBatch(client, args)).rejects.toBeInstanceOf(PayoutBatchMismatchError);
  });

  it("reports a 5xx as an unknown outcome, never as 'not paid'", async () => {
    const err = () => json(500, { name: "INTERNAL_SERVICE_ERROR" });
    const pp = fakePayPal([err(), err(), err(), err()]);
    const { client } = makeClient(pp.fetch);
    await expect(createPayoutBatch(client, args)).rejects.toBeInstanceOf(PayPalUnknownOutcomeError);
    expect(new Set(pp.calls.map((c) => c.headers["PayPal-Request-Id"]))).toEqual(new Set([args.senderBatchId]));
  });
});

describe("getPayoutBatch", () => {
  it("reads the recorded sandbox batch: two SUCCESS, one UNCLAIMED, fees per item add up", async () => {
    const pp = fakePayPal([json(200, recorded)]);
    const { client } = makeClient(pp.fetch);
    const batch = await getPayoutBatch(client, "7ZRZDZZLRGEAY");
    expect(pp.calls[0]!.url).toBe("https://api-m.sandbox.paypal.com/v1/payments/payouts/7ZRZDZZLRGEAY?page=1&page_size=1000&total_required=true");
    expect(batch.batch_header).toMatchObject({ payout_batch_id: "7ZRZDZZLRGEAY", batch_status: "SUCCESS" });
    expect(batch.items.map((i) => [i.payout_item.sender_item_id ?? null, i.transaction_status])).toHaveLength(3);
    expect(batch.items.map((i) => payoutItemOutcome(i.transaction_status))).toEqual(["PAID", "PAID", "UNCLAIMED"]);
    expect(batch.items[2]!.errors?.name).toBe("RECEIVER_UNREGISTERED");
    const feeCents = batch.items.reduce((s, i) => s + valueToCents(i.payout_item_fee!.value), 0);
    expect(feeCents).toBe(valueToCents(batch.batch_header.fees!.value));
    expect(feeCents).toBe(75);
  });

  it("follows every page", async () => {
    const page = (n: number, total: number, id: string) =>
      json(200, { total_pages: total, batch_header: recorded.batch_header, items: [{ ...recorded.items[0], payout_item_id: id }] });
    const pp = fakePayPal([page(1, 3, "I1"), page(2, 3, "I2"), page(3, 3, "I3")]);
    const { client } = makeClient(pp.fetch);
    const batch = await getPayoutBatch(client, "B", { pageSize: 1 });
    expect(batch.items.map((i) => i.payout_item_id)).toEqual(["I1", "I2", "I3"]);
    expect(pp.calls.map((c) => new URL(c.url).searchParams.get("page"))).toEqual(["1", "2", "3"]);
  });

  it("refuses to guess when PayPal omits total_pages", async () => {
    const noTotals = { ...recorded };
    delete noTotals.total_pages;
    const { client } = makeClient(fakePayPal([json(200, noTotals)]).fetch);
    await expect(getPayoutBatch(client, "7ZRZDZZLRGEAY")).rejects.toThrow(/total_pages missing/);
  });
});

describe("cancelPayoutItem", () => {
  it("keys the cancel on the item and treats the sandbox's 500 as an unknown outcome", async () => {
    const err = () => json(500, { name: "INTERNAL_SERVICE_ERROR", debug_id: "f9401880fbffb" });
    const pp = fakePayPal([err(), err(), err(), err()]);
    const { client } = makeClient(pp.fetch);
    await expect(cancelPayoutItem(client, "MQR5FQGFWBUCU")).rejects.toBeInstanceOf(PayPalUnknownOutcomeError);
    expect(pp.calls[0]!.url).toBe("https://api-m.sandbox.paypal.com/v1/payments/payouts-item/MQR5FQGFWBUCU/cancel");
    expect(pp.calls[0]!.headers["PayPal-Request-Id"]).toBe("cancel-MQR5FQGFWBUCU");
  });
});

describe("payoutItemOutcome", () => {
  it("maps all nine spec statuses; undocumented ones stay unverified", () => {
    const all: [PayoutItemStatus | undefined, string][] = [
      ["SUCCESS", "PAID"], ["UNCLAIMED", "UNCLAIMED"], ["RETURNED", "RETURNED"], ["FAILED", "FAILED"],
      ["PENDING", "IN_FLIGHT"], ["ONHOLD", "IN_FLIGHT"], ["BLOCKED", "IN_FLIGHT"],
      ["REFUNDED", "UNVERIFIED"], ["REVERSED", "UNVERIFIED"], [undefined, "UNVERIFIED"],
    ];
    for (const [status, outcome] of all) expect(payoutItemOutcome(status)).toBe(outcome);
  });

  it("covers exactly the spec's transaction_enum", () => {
    const spec = JSON.parse(readFileSync(new URL("../../../docs/paypal-specs/payments_payouts_batch_v1.json", import.meta.url), "utf8"));
    expect(spec.components.schemas.transaction_enum.enum.sort()).toEqual(
      ["SUCCESS", "FAILED", "PENDING", "UNCLAIMED", "RETURNED", "ONHOLD", "BLOCKED", "REFUNDED", "REVERSED"].sort(),
    );
  });
});
