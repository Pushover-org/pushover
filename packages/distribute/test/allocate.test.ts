import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { allocate, type AllocationInput } from "../src/allocate.ts";

const e = (claimId: string, entitlementCents: number) => ({ claimId, entitlementCents });
const base = { fundCents: 100_000, adminReserveCents: 0, feePerItemCents: 0 };
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("allocate", () => {
  it("pays in full when the fund covers everyone; the rest is leftover", () => {
    const a = allocate({ fundCents: 500_000, adminReserveCents: 10_000, feePerItemCents: 25, entitlements: [e("a", 1500), e("b", 1000)] });
    expect(a).toMatchObject({ netFundCents: 489_950, reservedFeesCents: 50, scaled: false, leftoverCents: 487_450 });
    expect(a.payouts.map((p) => p.payoutCents)).toEqual([1500, 1000]);
  });
  it("scales down when it does not", () => {
    const a = allocate({ ...base, fundCents: 1000, entitlements: [e("a", 1500), e("b", 500)] });
    expect(a.payouts.map((p) => p.payoutCents)).toEqual([750, 250]);
    expect(a).toMatchObject({ scaled: true, leftoverCents: 0 });
  });
  it("hands out spare cents by largest remainder", () => {
    // 100 × 1/3 each: 33 each and 1 spare; equal remainders, so the first claim ID gets it.
    const a = allocate({ ...base, fundCents: 100, entitlements: [e("c", 500), e("a", 500), e("b", 500)] });
    expect(a.payouts).toEqual([
      { claimId: "a", entitlementCents: 500, payoutCents: 34 },
      { claimId: "b", entitlementCents: 500, payoutCents: 33 },
      { claimId: "c", entitlementCents: 500, payoutCents: 33 },
    ]);
  });
  it("the biggest remainder wins over the claim ID", () => {
    const a = allocate({ ...base, fundCents: 5, entitlements: [e("a", 2), e("b", 7)] });
    expect(a.payouts.map((p) => p.payoutCents)).toEqual([1, 4]); // 1.11 and 3.88: b has the bigger remainder
  });
  it("a share too small to pay rounds to zero and stays listed", () => {
    const a = allocate({ ...base, fundCents: 1, entitlements: [e("a", 1), e("b", 1000)] });
    expect(a.payouts.map((p) => p.payoutCents)).toEqual([0, 1]);
  });
  it("no claims: everything is leftover", () => expect(allocate({ ...base, entitlements: [] })).toMatchObject({ leftoverCents: 100_000, payouts: [] }));
  it("stays exact where plain numbers would lose cents", () => {
    const a = allocate({ ...base, fundCents: 9_000_000_000_000, entitlements: [e("a", 8_000_000_000_001), e("b", 8_000_000_000_002), e("c", 3)] });
    expect(sum(a.payouts.map((p) => p.payoutCents))).toBe(9_000_000_000_000);
  });
  it.each<[string, Partial<AllocationInput>]>([
    ["a fractional entitlement", { entitlements: [e("a", 1.5)] }],
    ["a zero entitlement", { entitlements: [e("a", 0)] }],
    ["a negative entitlement", { entitlements: [e("a", -5)] }],
    ["a repeated claim", { entitlements: [e("a", 5), e("a", 5)] }],
    ["a fractional fund", { fundCents: 10.5, entitlements: [] }],
    ["a fund smaller than reserve and fees", { fundCents: 100, adminReserveCents: 90, feePerItemCents: 25, entitlements: [e("a", 5)] }],
  ])("rejects %s", (_n, over) => expect(() => allocate({ ...base, entitlements: [], ...over })).toThrow());
});

describe("allocate: properties", () => {
  const input = fc.record({
    fundCents: fc.integer({ min: 1, max: 2_000_000_000_00 }),
    adminReserveCents: fc.integer({ min: 0, max: 1_000_00 }),
    feePerItemCents: fc.constantFrom(0, 25, 100),
    entitlements: fc.uniqueArray(fc.record({ claimId: fc.string({ minLength: 1, maxLength: 8 }), entitlementCents: fc.integer({ min: 1, max: 1_000_000_00 }) }), { selector: (x) => x.claimId, maxLength: 200 }),
  }).filter((a) => a.fundCents - a.adminReserveCents - a.feePerItemCents * a.entitlements.length >= 0);

  it("Σ payouts + leftover = net fund, exactly; none negative or above entitlement; whole cents", () => {
    fc.assert(fc.property(input, (i) => {
      const a = allocate(i);
      expect(sum(a.payouts.map((p) => p.payoutCents)) + a.leftoverCents).toBe(a.netFundCents);
      expect(a.netFundCents).toBe(i.fundCents - i.adminReserveCents - i.feePerItemCents * i.entitlements.length);
      expect(a.leftoverCents).toBeGreaterThanOrEqual(0);
      for (const p of a.payouts) {
        expect(Number.isSafeInteger(p.payoutCents)).toBe(true);
        expect(p.payoutCents).toBeGreaterThanOrEqual(0);
        expect(p.payoutCents).toBeLessThanOrEqual(p.entitlementCents);
      }
    }), { numRuns: 3000 });
  });
  it("the order of the claims never changes anyone's amount", () => {
    fc.assert(fc.property(input, (i) => {
      expect(allocate({ ...i, entitlements: [...i.entitlements].reverse() })).toEqual(allocate(i));
    }), { numRuns: 1000 });
  });
  it("a bigger entitlement never gets less", () => {
    fc.assert(fc.property(input, (i) => {
      const a = allocate(i);
      const byE = [...a.payouts].sort((x, y) => x.entitlementCents - y.entitlementCents);
      for (let k = 1; k < byE.length; k++) {
        const [lo, hi] = [byE[k - 1], byE[k]];
        if (lo && hi && hi.entitlementCents > lo.entitlementCents) expect(hi.payoutCents).toBeGreaterThanOrEqual(lo.payoutCents);
      }
    }), { numRuns: 1000 });
  });
  it("everyone is paid in full exactly when the fund covers them", () => {
    fc.assert(fc.property(input, (i) => {
      const a = allocate(i);
      const total = i.entitlements.reduce((s, e2) => s + e2.entitlementCents, 0);
      expect(a.scaled).toBe(total > a.netFundCents);
      if (!a.scaled) for (const p of a.payouts) expect(p.payoutCents).toBe(p.entitlementCents);
    }), { numRuns: 1000 });
  });
});
