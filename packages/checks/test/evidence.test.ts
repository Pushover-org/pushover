import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { checkArithmetic, checkClassPeriod, checkGeography, checkQualifyingProduct, checkRepeatDetails, checkUnitsCap, checkVisualAnomaly, stateIsPrinted, unitsEvidenced } from "../src/evidence.ts";
import { drink, findings, line, SETTLEMENT as S } from "./fixtures.ts";

describe("C1 class period", () => {
  it.each([["2015-01-01", "PASS"], ["2019-12-31", "PASS"], ["2014-12-31", "FAIL"], ["2020-01-01", "FAIL"]])("%s → %s", (purchase_date, result) => {
    expect(checkClassPeriod(findings({ purchase_date }), S).result).toBe(result);
  });
  it.each([[null], ["2018-02-30"], ["2018-13-01"]])("%s is UNKNOWN, never PASS", (purchase_date) => {
    expect(checkClassPeriod(findings({ purchase_date }), S).result).toBe("UNKNOWN");
  });
});

describe("C2 qualifying product", () => {
  it("passes when a line matches a settlement product", () => expect(checkQualifyingProduct(findings(), S).result).toBe("PASS"));
  it("fails when lines were read and none match", () =>
    expect(checkQualifyingProduct(findings({ line_items: [line("Lunch", 4590)] }), S).result).toBe("FAIL"));
  it("ignores a product ID the model made up", () =>
    expect(checkQualifyingProduct(findings({ line_items: [line("Lunch", 4590, { matches_product_id: "free-money" })] }), S).result).toBe("FAIL"));
  it("is UNKNOWN when nothing could be read", () => {
    expect(checkQualifyingProduct(findings({ line_items: [] }), S).result).toBe("UNKNOWN");
    expect(checkQualifyingProduct(findings({ document_type: "unreadable" }), S).result).toBe("UNKNOWN");
  });
});

describe("C3 arithmetic on what real receipts print", () => {
  it("receipt 1000: printed line totals add up, including '2 Lunch 45.90'", () => expect(checkArithmetic(findings()).result).toBe("PASS"));
  it("receipt 1099: a second total with an 18% gratuity below the subtotal still adds up", () => {
    const f = findings({ line_items: [drink("Coffee", 325), line("Food", 4680)], subtotal_cents: 5005, tax_cents: 546, total_cents: 6452,
      adjustments: [{ kind: "tip", description: "Gratuity 18.00%", cents: 901, applies: "after_subtotal" }] });
    expect(checkArithmetic(f).result).toBe("PASS");
    expect(checkArithmetic({ ...f, total_cents: 5551 }).result).toBe("PASS"); // the total before the tip
  });
  it("a printed discount above the subtotal counts", () => {
    const f = findings({ line_items: [drink("Coffee", 300), line("Food", 1000)], adjustments: [{ kind: "discount", description: "Coupon", cents: -200, applies: "before_subtotal" }], subtotal_cents: 1100, tax_cents: 99, total_cents: 1199 });
    expect(checkArithmetic(f).result).toBe("PASS");
  });
  it("no printed subtotal: lines + tax = total", () => expect(checkArithmetic(findings({ subtotal_cents: null })).result).toBe("PASS"));
  it("qty × unit is used when no line total is printed", () => {
    const f = findings({ line_items: [drink("Coffee", null, { qty: 2, unit_cents: 295 })], subtotal_cents: 590, tax_cents: 53, total_cents: 643 });
    expect(checkArithmetic(f).result).toBe("PASS");
  });
  it("an edited total fails", () => expect(checkArithmetic(findings({ total_cents: 6658 })).result).toBe("FAIL"));
  it("an edited line fails", () => expect(checkArithmetic(findings({ line_items: [drink("Coffee", 1300), line("Lunch", 4590), drink("Coke", 300)] })).result).toBe("FAIL"));
  it("an unpriced modifier is fine when the sum still matches", () => {
    const f = findings({ line_items: [drink("Coffee", 300), line("pollo", null), line("Lunch", 4590), drink("Coke", 300)] });
    expect(checkArithmetic(f).result).toBe("PASS");
  });
  it("an unpriced line that could explain a gap is UNKNOWN, not FAIL", () => {
    const f = findings({ line_items: [drink("Coffee", 300), line("smudged", null), drink("Coke", 300)] });
    expect(checkArithmetic(f).result).toBe("UNKNOWN");
  });
  it.each([
    ["no total", { total_cents: null }],
    ["no subtotal and an unpriced line", { subtotal_cents: null, line_items: [line("smudged", null)] }],
    ["no tax read and a gap to the total", { tax_cents: null }],
    ["totals but no lines", { line_items: [] }],
  ])("%s is UNKNOWN", (_n, over) => expect(checkArithmetic(findings(over)).result).toBe("UNKNOWN"));
});

describe("C3 properties", () => {
  const receipt = fc.record({
    lines: fc.array(fc.integer({ min: 1, max: 50_000 }), { minLength: 1, maxLength: 12 }),
    tax: fc.integer({ min: 0, max: 20_000 }),
    tip: fc.integer({ min: 0, max: 10_000 }),
    discount: fc.integer({ min: 0, max: 1_000 }),
    seed: fc.nat(),
  });
  const build = (r: { lines: number[]; tax: number; tip: number; discount: number }) => {
    const subtotal = r.lines.reduce((a, b) => a + b, 0) - r.discount;
    return findings({
      line_items: r.lines.map((c) => drink("x", c)), subtotal_cents: subtotal, tax_cents: r.tax, total_cents: subtotal + r.tax + r.tip,
      adjustments: [
        ...(r.discount ? [{ kind: "discount" as const, description: "d", cents: -r.discount, applies: "before_subtotal" as const }] : []),
        ...(r.tip ? [{ kind: "tip" as const, description: "t", cents: r.tip, applies: "after_subtotal" as const }] : []),
      ],
    });
  };
  const valid = receipt.filter((r) => r.lines.reduce((a, b) => a + b, 0) >= r.discount);

  it("every receipt that really adds up passes", () => {
    fc.assert(fc.property(valid, (r) => { expect(checkArithmetic(build(r)).result).toBe("PASS"); }), { numRuns: 2000 });
  });
  it("the order of the lines never changes the answer", () => {
    fc.assert(fc.property(valid, (r) => {
      const f = build(r);
      const shuffled = [...f.line_items].sort((a, b) => ((a.line_total_cents ?? 0) * (r.seed + 7)) % 97 - ((b.line_total_cents ?? 0) * (r.seed + 7)) % 97);
      expect(checkArithmetic({ ...f, line_items: shuffled }).result).toBe(checkArithmetic(f).result);
    }), { numRuns: 500 });
  });
  it("a total moved by 2 cents or more, past the tip, always fails", () => {
    fc.assert(fc.property(valid, fc.integer({ min: 2, max: 100_000 }), fc.boolean(), (r, delta, up) => {
      const f = build(r);
      const total = (f.total_cents as number) + (up ? delta : -delta);
      fc.pre(total >= 0);
      const before = (f.subtotal_cents as number) + r.tax;
      fc.pre(Math.abs(total - before) > 1); // the pre-tip total is a real total, not an edit
      expect(checkArithmetic({ ...f, total_cents: total }).result).toBe("FAIL");
    }), { numRuns: 2000 });
  });
  it("a total moved by 1 cent is within the rounding allowance", () => {
    fc.assert(fc.property(valid, fc.constantFrom(-1, 1), (r, d) => {
      const f = build(r);
      fc.pre((f.total_cents as number) + d >= 0);
      expect(checkArithmetic({ ...f, total_cents: (f.total_cents as number) + d }).result).toBe("PASS");
    }), { numRuns: 500 });
  });
  it("a missing amount is never a PASS", () => {
    fc.assert(fc.property(valid, (r) => { expect(checkArithmetic({ ...build(r), total_cents: null }).result).toBe("UNKNOWN"); }), { numRuns: 300 });
  });
});

describe("C5 geography", () => {
  it("passes when claimant and printed store state are in the class", () => expect(checkGeography("CA", findings(), S, "proof").result).toBe("PASS"));
  it("fails on a claimant or store outside the class", () => {
    expect(checkGeography("OH", findings(), S, "proof").result).toBe("FAIL");
    expect(checkGeography("CA", findings({ merchant_state: "OH", merchant_address: "1 Main St, Akron, OH 44308" }), S, "proof").result).toBe("FAIL");
  });
  it("no printed state is UNKNOWN", () => expect(checkGeography("CA", findings({ merchant_state: null }), S, "proof").result).toBe("UNKNOWN"));
  it("a state the model inferred, not printed in the address, is UNKNOWN (owner decision)", () => {
    expect(checkGeography("CA", findings({ merchant_address: "5305 E Pacific Coast Hwy (562) 597-0906" }), S, "proof").result).toBe("UNKNOWN");
  });
  it("a no-proof claim needs only the claimant's state", () => {
    expect(checkGeography("CA", null, S, "no_proof").result).toBe("PASS");
    expect(checkGeography("OH", null, S, "no_proof").result).toBe("FAIL");
    expect(checkGeography(null, null, S, "no_proof").result).toBe("UNKNOWN");
  });
  it("reads a state printed by code or by name, not letters inside a word", () => {
    expect(stateIsPrinted("CA", "Long Beach, CA 90804")).toBe(true);
    expect(stateIsPrinted("NY", "Bayside, New York 11360")).toBe(true);
    expect(stateIsPrinted("CA", "CALIFORNIA PIZZA, 1 Main")).toBe(true);
    expect(stateIsPrinted("CA", "Cape Cod Cafe")).toBe(false);
    expect(stateIsPrinted("CA", null)).toBe(false);
  });

  it("reads title-case codes and traditional abbreviations, as real receipts print them", () => {
    // Receipts 1166 and 1028 in the ExpressExpense set, found while labelling claims-v1.
    expect(stateIsPrinted("TX", "7800 Airport Blvd (HOU), Houston, Tx 77061")).toBe(true);
    expect(stateIsPrinted("CA", "11325 Washington Blvd, Whitter, Calif 90606")).toBe(true);
    expect(stateIsPrinted("TX", "Austin, Tex. 78701")).toBe(true);
    expect(stateIsPrinted("NJ", "Hoboken, N.J. 07030")).toBe(true);
    // An all-lowercase code is an ordinary word, and an abbreviation must stand alone.
    expect(stateIsPrinted("IN", "open in the morning")).toBe(false);
    expect(stateIsPrinted("OR", "Pickup or delivery")).toBe(false);
    expect(stateIsPrinted("TX", "Textile Plaza, Springfield")).toBe(false);
    expect(stateIsPrinted("CA", "Calico Rd, Barstow")).toBe(false);
  });
});

describe("C10 visual anomaly", () => {
  const a = (confidence: "high" | "medium" | "low") => ({ kind: "pasted_region" as const, where: "total", box: null, confidence });
  it("fails only on a high-confidence anomaly", () => {
    expect(checkVisualAnomaly(findings({ visual_anomalies: [a("high")] })).result).toBe("FAIL");
    expect(checkVisualAnomaly(findings({ visual_anomalies: [a("medium"), a("low")] })).result).toBe("PASS");
    expect(checkVisualAnomaly(findings()).result).toBe("PASS");
  });
});

describe("C11 units cap", () => {
  it("counts qualifying units only; a line with no printed quantity is one", () => {
    expect(unitsEvidenced(findings(), S)).toBe(2);
    expect(unitsEvidenced(findings({ line_items: [drink("Coffee", 590, { qty: 2 }), drink("Tea", 300)] }), S)).toBe(3);
  });
  it("a receipt for 2 cannot claim 5: FAIL means capped", () => expect(checkUnitsCap(5, findings(), S, "proof")).toMatchObject({ result: "FAIL", detail: expect.stringContaining("capped at 2") }));
  it("passes within the evidence", () => expect(checkUnitsCap(2, findings(), S, "proof").result).toBe("PASS"));
  it("the tier maximum still caps", () => {
    const f = findings({ line_items: [drink("Coffee", 900, { qty: 9 })] });
    expect(checkUnitsCap(9, f, S, "proof").detail).toContain("capped at 5");
  });
  it("nothing read is UNKNOWN", () => {
    expect(checkUnitsCap(1, null, S, "proof").result).toBe("UNKNOWN");
    expect(checkUnitsCap(1, findings({ line_items: [line("Lunch", 100)] }), S, "proof").result).toBe("UNKNOWN");
  });
  it("the no-proof tier pays one", () => {
    expect(checkUnitsCap(1, null, S, "no_proof").result).toBe("PASS");
    expect(checkUnitsCap(3, null, S, "no_proof").result).toBe("FAIL");
  });
});

describe("C12 repeat receipt details", () => {
  const same = { claimId: "c2", merchant: "GREEN FIELD!", date: "2016-05-26", totalCents: 5658 };
  it("flags the same merchant, date and total, ignoring case and punctuation", () => {
    expect(checkRepeatDetails("c1", findings(), [same]).result).toBe("FAIL");
  });
  it.each([[{ merchant: "Other" }], [{ date: "2016-05-27" }], [{ totalCents: 5659 }]])("a different %j passes", (o) => {
    expect(checkRepeatDetails("c1", findings(), [{ ...same, ...o }]).result).toBe("PASS");
  });
  it("does not match a claim against itself", () => expect(checkRepeatDetails("c2", findings(), [same]).result).toBe("PASS"));
  it("missing details or a failed lookup is UNKNOWN", () => {
    expect(checkRepeatDetails("c1", findings({ merchant_name: null }), [same]).result).toBe("UNKNOWN");
    expect(checkRepeatDetails("c1", findings({ merchant_name: "***" }), [same]).result).toBe("UNKNOWN");
    expect(checkRepeatDetails("c1", findings(), null).result).toBe("UNKNOWN");
  });
});
