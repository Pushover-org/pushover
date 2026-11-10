import { readFileSync } from "node:fs";
import fc from "fast-check";
import { buildPayoutRequest, type PayoutBatch, type PayoutItem, type PayoutItemStatus } from "@proofofclaim/paypal";
import { describe, expect, it } from "vitest";
import { allocate } from "../src/allocate.ts";
import { buildClaimBatches, buildCyPresBatch } from "../src/batch.ts";
import { reconcile } from "../src/reconcile.ts";

const alloc = allocate({ fundCents: 10_000, adminReserveCents: 1_000, feePerItemCents: 25, entitlements: [{ claimId: "c1", entitlementCents: 1500 }, { claimId: "c2", entitlementCents: 1000 }] });
const payees = [{ claimId: "c1", email: "a@example.com" }, { claimId: "c2", email: "b@example.com", wallet: "VENMO" as const }];
const args = { settlementId: "acme-restaurant-beverage", round: 1, allocation: alloc, payees, emailSubject: "s", emailMessage: "m" };

describe("batch builder", () => {
  it("makes a batch PayPal's request builder accepts, with an ID from settlement and round", () => {
    const [b] = buildClaimBatches(args);
    expect(b?.senderBatchId).toBe("poc-acme-restaurant-beverage-r1-p1");
    expect(buildPayoutRequest(b as never)).toMatchObject({
      items: [
        { receiver: "a@example.com", amount: { currency: "USD", value: "15.00" }, sender_item_id: "c1" },
        { receiver: "b@example.com", amount: { currency: "USD", value: "10.00" }, sender_item_id: "c2", recipient_wallet: "VENMO" },
      ],
    });
  });
  it("pays a claimant who logged in with PayPal by payer ID, not email", () => {
    const [b] = buildClaimBatches({ ...args, payees: [{ claimId: "c1", payerId: "QYR5Z8XDVJNXQ" }, payees[1]!] });
    expect(buildPayoutRequest(b as never)).toMatchObject({
      items: [{ recipient_type: "PAYPAL_ID", receiver: "QYR5Z8XDVJNXQ", sender_item_id: "c1" }, { recipient_type: "EMAIL", receiver: "b@example.com" }],
    });
  });
  it("the same input gives the same batch ID, so a retry cannot pay twice; a new round differs", () => {
    expect(buildClaimBatches(args)).toEqual(buildClaimBatches(args));
    expect(buildClaimBatches({ ...args, round: 2 })[0]?.senderBatchId).not.toBe(buildClaimBatches(args)[0]?.senderBatchId);
  });
  it("splits at the item limit, and loses nobody", () => {
    const bs = buildClaimBatches({ ...args, maxItems: 1 });
    expect(bs.map((b) => b.senderBatchId)).toEqual(["poc-acme-restaurant-beverage-r1-p1", "poc-acme-restaurant-beverage-r1-p2"]);
    expect(bs.flatMap((b) => b.items.map((i) => i.senderItemId))).toEqual(["c1", "c2"]);
  });
  it("leaves out a payout of zero: PayPal cannot send $0.00", () => {
    const a = allocate({ fundCents: 1, adminReserveCents: 0, feePerItemCents: 0, entitlements: [{ claimId: "c1", entitlementCents: 1 }, { claimId: "c2", entitlementCents: 1000 }] });
    expect(buildClaimBatches({ ...args, allocation: a })[0]?.items.map((i) => i.senderItemId)).toEqual(["c2"]);
  });
  it("refuses a claim with no payee, an empty batch and a bad round", () => {
    expect(() => buildClaimBatches({ ...args, payees: [] })).toThrow("no payee");
    const none = allocate({ fundCents: 1, adminReserveCents: 0, feePerItemCents: 0, entitlements: [] });
    expect(() => buildClaimBatches({ ...args, allocation: none })).toThrow("nothing to pay");
    expect(() => buildClaimBatches({ ...args, round: 0 })).toThrow("round");
  });
  it("cy-près is one payment, with its own ID", () => {
    const b = buildCyPresBatch({ settlementId: "s", round: 1, recipientEmail: "n@example.com", cents: 500, emailSubject: "s", emailMessage: "m" });
    expect(b).toMatchObject({ senderBatchId: "poc-s-cypres-r1", items: [{ receiverEmail: "n@example.com", cents: 500 }] });
  });
});

const item = (id: string, status: PayoutItemStatus | undefined, value: string, fee: string | null = "0.25"): PayoutItem => ({
  payout_item_id: id, payout_batch_id: "B", ...(status ? { transaction_status: status } : {}), ...(fee ? { payout_item_fee: { currency: "USD", value: fee } } : {}),
  payout_item: { amount: { currency: "USD", value }, receiver: "x@example.com" },
});
const fund = { fundCents: 10_000, adminReserveCents: 1_000, allocation: alloc };

describe("reconcile", () => {
  it("balances, and each cent is in one bucket", () => {
    const r = reconcile({ ...fund, items: [item("1", "SUCCESS", "15.00"), item("2", "UNCLAIMED", "10.00")] });
    expect(r).toMatchObject({ paidCents: 1500, unclaimedCents: 1000, feesCents: 50, heldCents: 1000, awaitingCyPresCents: 6450, differenceCents: 0, warnings: [] });
  });
  it("money that returns and goes to cy-près is counted once", () => {
    const before = reconcile({ ...fund, items: [item("1", "SUCCESS", "15.00"), item("2", "RETURNED", "10.00")] });
    const after = reconcile({ ...fund, items: [item("1", "SUCCESS", "15.00"), item("2", "RETURNED", "10.00")], cyPres: [{ cents: 7450, feeCents: 0 }] });
    expect(before).toMatchObject({ awaitingCyPresCents: 7450, cyPresSentCents: 0, differenceCents: 0 });
    expect(after).toMatchObject({ awaitingCyPresCents: 0, cyPresSentCents: 7450, differenceCents: 0, warnings: [] });
  });
  it("an unknown status is unverified: neither paid nor returned, and it warns", () => {
    const r = reconcile({ ...fund, items: [item("1", "REVERSED", "15.00"), item("2", undefined, "10.00")] });
    expect(r).toMatchObject({ paidCents: 0, unverifiedCents: 2500, differenceCents: 0 });
    expect(r.warnings.join()).toContain("2500 cents unverified");
  });
  it("a batch that could not be read stays visible as unverified", () => {
    const r = reconcile({ ...fund, items: [], unreadCents: 2500 });
    expect(r).toMatchObject({ unverifiedCents: 2500, differenceCents: 0 });
  });
  it("a paid amount that differs from the plan shows as a difference, not as a balanced book", () => {
    const r = reconcile({ ...fund, items: [item("1", "SUCCESS", "15.01"), item("2", "SUCCESS", "10.00")] });
    expect(r.differenceCents).toBe(-1);
    expect(r.warnings.join()).toContain("do not match the plan");
  });
  it("a fee PayPal has not reported is never assumed", () => {
    const r = reconcile({ ...fund, items: [item("1", "SUCCESS", "15.00", null), item("2", "SUCCESS", "10.00")] });
    expect(r).toMatchObject({ feesCents: 25, feesUnknown: 1 });
    expect(r.warnings.join()).toContain("not reported");
  });
  it("warns when fees pass the reserve, or cy-près sends more than exists", () => {
    expect(reconcile({ ...fund, items: [item("1", "SUCCESS", "15.00", "0.50"), item("2", "SUCCESS", "10.00")] }).warnings.join()).toContain("above the reserve");
    expect(reconcile({ ...fund, items: [item("1", "SUCCESS", "15.00"), item("2", "SUCCESS", "10.00")], cyPres: [{ cents: 999_999, feeCents: 0 }] }).warnings.join()).toContain("more than was available");
  });
  it("reads a real sandbox batch: 2 paid, 1 unclaimed, $0.25 fee each", () => {
    const batch = JSON.parse(readFileSync(new URL("../../paypal/test/fixtures/payout-batch-7ZRZDZZLRGEAY.json", import.meta.url), "utf8")) as PayoutBatch;
    const a = allocate({ fundCents: 1000, adminReserveCents: 0, feePerItemCents: 25, entitlements: batch.items.map((i, n) => ({ claimId: `c${n}`, entitlementCents: 100 })) });
    expect(reconcile({ fundCents: 1000, adminReserveCents: 0, allocation: a, items: batch.items })).toMatchObject({ paidCents: 200, unclaimedCents: 100, feesCents: 75, differenceCents: 0, warnings: [] });
  });
  it("property: when items match the plan, the books balance whatever their statuses", () => {
    const statuses: (PayoutItemStatus | undefined)[] = ["SUCCESS", "FAILED", "PENDING", "UNCLAIMED", "RETURNED", "ONHOLD", "BLOCKED", "REFUNDED", "REVERSED", undefined];
    const input = fc.record({
      amounts: fc.array(fc.integer({ min: 1, max: 100_000 }), { minLength: 1, maxLength: 60 }),
      fund: fc.integer({ min: 200_000, max: 10_000_000 }),
      reserve: fc.integer({ min: 0, max: 50_000 }),
      picks: fc.array(fc.nat(9), { minLength: 60, maxLength: 60 }),
      sent: fc.nat(1000),
    });
    fc.assert(fc.property(input, (i) => {
      const a = allocate({ fundCents: i.fund, adminReserveCents: i.reserve, feePerItemCents: 25, entitlements: i.amounts.map((c, n) => ({ claimId: `c${n}`, entitlementCents: c })) });
      const items = a.payouts.filter((p) => p.payoutCents > 0).map((p, n) => item(p.claimId, statuses[i.picks[n] ?? 0], (p.payoutCents / 100).toFixed(2)));
      const zeroFees = a.reservedFeesCents - 25 * items.length;
      const r = reconcile({ fundCents: i.fund, adminReserveCents: i.reserve, allocation: a, items, cyPres: [{ cents: i.sent, feeCents: 25 }] });
      expect(r.differenceCents).toBe(0);
      const total = r.paidCents + r.unclaimedCents + r.inFlightCents + r.unverifiedCents + r.awaitingCyPresCents + r.cyPresSentCents + r.feesCents + r.heldCents;
      expect(total).toBe(i.fund);
      expect(r.heldCents).toBe(i.reserve + zeroFees - 25);
    }), { numRuns: 1000 });
  });
});
