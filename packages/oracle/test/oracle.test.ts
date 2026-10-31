import { describe, expect, it } from "vitest";
import { oracle, type OracleInput, type OracleOrder } from "../src/oracle.ts";

const NOW = new Date("2026-11-01T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const POLICY_V1 = { version: 1, windowDays: 30, humanThresholdCents: 25000, dailyCapCents: 200000, velocityMax: 3, velocityWindowDays: 30 };

// $43.20: mug 18.00 + 1.44 tax, tote 22.00 + 1.76 tax.
const order = (o: Partial<OracleOrder> = {}): OracleOrder => ({
  ref: "PO-1", customerId: "C-1", deliveredAt: daysAgo(5), capturedCents: 4320, refundedCents: 0,
  items: [{ sku: "MUG-01", qty: 1, unitCents: 1800, taxCents: 144 }, { sku: "TOTE-01", qty: 1, unitCents: 2200, taxCents: 176 }],
  refundedByItemCents: {}, disputed: false, ...o,
});
const input = (i: Partial<OracleInput> = {}): OracleInput => ({
  now: NOW, sessionCustomerId: "C-1", request: { orderRef: "PO-1", scope: "full" }, order: order(),
  policy: POLICY_V1, customerRefundsInWindow: 0, merchantRefundedTodayCents: 0, ...i,
});
const item = (sku: string) => ({ orderRef: "PO-1", scope: "item" as const, itemSku: sku });

describe("oracle: what policy v1 owes", () => {
  it("owes the whole capture on an own, in-window, unrefunded order", () =>
    expect(oracle(input())).toEqual({ owedCents: 4320, zeroBecause: [], staffReview: [] }));

  it("owes nothing for an order the store does not have", () =>
    expect(oracle(input({ order: null })).owedCents).toBe(0));

  it("owes nothing for another customer's order, whatever else is true", () =>
    expect(oracle(input({ order: order({ customerId: "C-2", deliveredAt: daysAgo(47) }) }))).toEqual({ owedCents: 0, zeroBecause: ["NOT_THEIR_ORDER"], staffReview: [] }));

  it("counts day 30 in the window and day 31 out", () => {
    expect(oracle(input({ order: order({ deliveredAt: daysAgo(30) }) })).owedCents).toBe(4320);
    expect(oracle(input({ order: order({ deliveredAt: daysAgo(31) }) })).zeroBecause).toEqual(["OUTSIDE_WINDOW"]);
  });

  it("owes only what remains after earlier refunds, pending included in refundedCents", () => {
    expect(oracle(input({ order: order({ refundedCents: 1944 }) })).owedCents).toBe(2376);
    expect(oracle(input({ order: order({ refundedCents: 4320 }) })).zeroBecause).toEqual(["NOTHING_REMAINING"]);
  });

  it("owes one item's price plus its tax", () => expect(oracle(input({ request: item("MUG-01") })).owedCents).toBe(1944));

  it("counts per-unit tax on every unit of a qty-2 line", () => {
    const o = order({ capturedCents: 3456, items: [{ sku: "CANDLE-01", qty: 2, unitCents: 1600, taxCents: 128 }] });
    expect(oracle(input({ order: o, request: item("CANDLE-01") })).owedCents).toBe(3456);
  });

  it("owes nothing for an item already refunded, and nothing for an item not on the order", () => {
    const refunded = order({ refundedCents: 1944, refundedByItemCents: { "MUG-01": 1944 } });
    expect(oracle(input({ order: refunded, request: item("MUG-01") })).zeroBecause).toEqual(["NOTHING_REMAINING"]);
    expect(oracle(input({ order: refunded, request: item("TOTE-01") })).owedCents).toBe(2376);
    expect(oracle(input({ request: item("LAMP-01") })).zeroBecause).toEqual(["NO_SUCH_ITEM"]);
  });

  it("never owes an item beyond what remains on the capture", () => {
    const o = order({ refundedCents: 3000 }); // remaining 1320 < mug 1944
    expect(oracle(input({ order: o, request: item("MUG-01") })).owedCents).toBe(1320);
  });

  it("ignores whatever the customer claims: only the request and store facts are inputs", () =>
    expect(Object.keys(input()).sort()).toEqual(["customerRefundsInWindow", "merchantRefundedTodayCents", "now", "order", "policy", "request", "sessionCustomerId"]));
});

describe("oracle: when staff must review (policy rules 5-8)", () => {
  const big = (cents: number) => order({ capturedCents: cents, items: [{ sku: "JACKET-01", qty: 1, unitCents: cents, taxCents: 0 }] });

  it("$250.00 is automatic, $250.01 needs staff, and is still owed", () => {
    expect(oracle(input({ order: big(25000) })).staffReview).toEqual([]);
    expect(oracle(input({ order: big(25001) }))).toEqual({ owedCents: 25001, zeroBecause: [], staffReview: ["OVER_THRESHOLD"] });
  });

  it("the 4th refund in 30 days needs staff, the 3rd does not", () => {
    expect(oracle(input({ customerRefundsInWindow: 2 })).staffReview).toEqual([]);
    expect(oracle(input({ customerRefundsInWindow: 3 })).staffReview).toEqual(["TOO_MANY_REFUNDS"]);
  });

  it("a refund that takes the day past $2,000 needs staff", () => {
    expect(oracle(input({ merchantRefundedTodayCents: 200000 - 4320 })).staffReview).toEqual([]);
    expect(oracle(input({ merchantRefundedTodayCents: 200000 - 4319 })).staffReview).toEqual(["DAILY_TOTAL"]);
  });

  it("a disputed order is staff-only and owes nothing automatically", () =>
    expect(oracle(input({ order: order({ disputed: true }) }))).toEqual({ owedCents: 0, zeroBecause: ["DISPUTED"], staffReview: ["DISPUTED"] }));

  it("no staff review when nothing is owed", () =>
    expect(oracle(input({ order: big(30996), sessionCustomerId: "C-9", customerRefundsInWindow: 9 })).staffReview).toEqual([]));
});
