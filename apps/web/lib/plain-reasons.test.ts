import type { CheckId, Findings } from "@proofofclaim/claims";
import { describe, expect, it } from "vitest";
import { translator } from "./i18n.ts";
import { plainReasons } from "./plain-reasons.ts";

const S = { classPeriod: { start: "2015-01-01", end: "2019-12-31" }, geography: { states: ["CA", "NY"] }, products: [{ name: "Non-alcoholic drink" }] };
const f = { purchase_date: "2021-03-02", merchant_state: "OH", tax_cents: 950 } as Findings;
const checks = (over: Partial<Record<CheckId, "PASS" | "FAIL" | "UNKNOWN">>) =>
  (["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10", "C11", "C12"] as CheckId[]).map((id) => ({ id, result: over[id] ?? ("PASS" as const) }));
const base = { tier: "proof" as const, unitsClaimed: 2, claimantState: "CA", findings: f, settlement: S, canAppeal: true, canSendDocument: false };
const t = translator("en");
const one = <T,>(xs: T[]): T => {
  const x = xs[0];
  if (x === undefined) throw new Error("no reason given");
  return x;
};

describe("a claimant's reasons in plain words (C3)", () => {
  it("names what was on their own receipt, and the fix", () => {
    const r = one(plainReasons({ ...base, outcome: "DENY", checks: checks({ C1: "FAIL" }) }));
    expect(t(r.why, r.params)).toBe("The receipt is dated 2021-03-02. This settlement covers purchases from 2015-01-01 to 2019-12-31.");
    expect(r.fix).toBe("fix.misread");
  });

  it("says whether it was the claimant's address or the store that was outside the class states", () => {
    const store = one(plainReasons({ ...base, outcome: "DENY", checks: checks({ C5: "FAIL" }) }));
    expect(t(store.why, store.params)).toBe("This settlement covers California, New York. The store is in Ohio.");
    const home = one(plainReasons({ ...base, claimantState: "TX", outcome: "DENY", checks: checks({ C5: "FAIL" }) }));
    expect(t(home.why, home.params)).toBe("This settlement covers California, New York. Your address is in Texas.");
  });

  it("gives the tax and the state for an impossible tax, in Spanish too", () => {
    const r = one(plainReasons({ ...base, outcome: "DENY", checks: checks({ C4: "FAIL" }) }));
    expect(translator("es")(r.why, r.params)).toBe("El impuesto de este recibo ($9.50) no es posible para una tienda en Ohio el 2021-03-02.");
  });

  it("explains 'couldn't tell' only while it holds the claim up, and points at the document form", () => {
    expect(plainReasons({ ...base, outcome: "APPROVE", checks: checks({ C6: "UNKNOWN" }) })).toEqual([]);
    const [r] = plainReasons({ ...base, outcome: "NEED_MORE", canAppeal: false, canSendDocument: true, checks: checks({ C1: "UNKNOWN" }) });
    expect(r).toMatchObject({ why: "why.C1.UNKNOWN", fix: "fix.document" });
  });

  it("points at an appeal only when one can be made", () => {
    const [r] = plainReasons({ ...base, outcome: "REVIEW", canAppeal: false, checks: checks({ C9: "FAIL" }) });
    expect(r).toMatchObject({ why: "why.C9.FAIL", fix: null });
  });

  it("never carries anything from another claim: only the claimant's own values fill the sentences", () => {
    const all = plainReasons({ ...base, outcome: "REVIEW", checks: checks({ C6: "FAIL", C7: "FAIL", C8: "FAIL", C9: "FAIL", C12: "FAIL" }) });
    expect(all.map((r) => r.id)).toEqual(["C6", "C7", "C8", "C9", "C12"]);
    expect(all.every((r) => Object.keys(r.params).length === 0)).toBe(true);
  });
});
