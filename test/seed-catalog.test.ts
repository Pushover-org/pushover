import { describe, expect, it } from "vitest";
import { valueToCents } from "@proofofclaim/paypal";
import { JACKET, NORMAL_MAX_CENTS, NORMAL_MIN_CENTS, orderFor, taxFor, toPurchaseUnit } from "../scripts/seed/catalog.ts";

const refs = Array.from({ length: 500 }, (_, i) => `PO-${10001 + i}`);

describe("seed catalog", () => {
  it("is deterministic per ref, so a re-sent create is identical", () => {
    for (const ref of refs.slice(0, 50)) expect(orderFor(ref)).toEqual(orderFor(ref));
    expect(JSON.stringify(toPurchaseUnit(orderFor("PO-10001")))).toBe(JSON.stringify(toPurchaseUnit(orderFor("PO-10001"))));
  });

  it("keeps normal orders within $30–$120 and varies them", () => {
    const totals = refs.map((r) => orderFor(r).totalCents);
    expect(Math.min(...totals)).toBeGreaterThanOrEqual(NORMAL_MIN_CENTS);
    expect(Math.max(...totals)).toBeLessThanOrEqual(NORMAL_MAX_CENTS);
    expect(new Set(totals).size).toBeGreaterThan(20);
  });

  it("makes the big order $309.96, above the $250 human threshold", () => {
    const o = orderFor("PO-10010", { big: true });
    expect(o.items).toEqual([{ sku: JACKET.sku, name: JACKET.name, qty: 1, unitCents: 28700, taxCents: 2296 }]);
    expect(o.totalCents).toBe(30996);
  });

  it("produces PayPal amounts that add up the way Orders v2 requires", () => {
    for (const ref of refs) {
      const pu = toPurchaseUnit(orderFor(ref));
      const items = pu.items ?? [];
      const itemTotal = items.reduce((s, i) => s + Number(i.quantity) * valueToCents(i.unit_amount.value), 0);
      const taxTotal = items.reduce((s, i) => s + Number(i.quantity) * valueToCents(i.tax?.value ?? "0"), 0);
      expect(valueToCents(pu.amount.breakdown!.item_total.value)).toBe(itemTotal);
      expect(valueToCents(pu.amount.breakdown!.tax_total!.value)).toBe(taxTotal);
      expect(valueToCents(pu.amount.value)).toBe(itemTotal + taxTotal);
      expect(new Set(items.map((i) => i.sku)).size).toBe(items.length); // order_items PK (order_id, sku)
    }
  });

  it("taxes per unit at 8%, rounded to the cent", () => {
    expect(taxFor(8000)).toBe(640);
    expect(taxFor(1800)).toBe(144);
  });
});
