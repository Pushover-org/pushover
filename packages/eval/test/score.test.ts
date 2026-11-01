import { describe, expect, it } from "vitest";
import type { Claim, ReceiptTruth } from "../src/corpus/schema.ts";
import { analystCents, armBCents, armCCents, claimedCents, score, wilson, type Scored, type SettlementTerms } from "../src/score.ts";

const T: SettlementTerms = { fundCents: 200_000, adminReserveCents: 10_000, proof: { unitCents: 1500, maxUnits: 5 }, noProofCents: 1000 };

const receipt = (drinks: number): ReceiptTruth => ({
  id: "r-001", source: "render", merchant: "M", address: "A, Austin, TX 78701", state_printed: "TX", date: "2018-01-01",
  lines: [{ desc: "Soda", qty: drinks, line_total_cents: 200 * drinks, kind: "nonalcoholic_drink" }], adjustments: [],
  subtotal_cents: 200 * drinks, tax_cents: 0, total_cents: 200 * drinks, injected_text: null, edited: false, legible: true, notes: "",
});

let n = 0;
function row(truth: Claim["truth"], tier: Claim["tier"], units: number, c: Scored["armC"], b: Scored["armB"] = { decision: "approve", units }, rec: Scored["modelRecommendation"] = null, drinks = 1): Scored {
  n++;
  const claim = {
    id: `c-${String(n).padStart(3, "0")}`, seq: n, group: "H1", truth, split: "pilot", tier, units_claimed: units,
    claimant: { name: "x", email: "x@example.com", address_line: "1 A St", zip: "78701", state: "TX" }, declaration: "d",
    network: { ip: "2001:db8:1::1", at: "2026-01-05T00:00:00.000Z" }, evidence: tier === "proof" ? { receipt: "r-001", variant: null } : null,
    duplicate_of: null, cluster: null, seen_before_design: false, expected: { outcome: c.outcome, reason: c.reason, entitlement_cents: c.entitlementCents }, why: "",
  } as Claim;
  return { claim, truth: tier === "proof" ? receipt(drinks) : null, armC: c, armB: b, modelRecommendation: rec };
}
const approve = (cents: number) => ({ outcome: "APPROVE" as const, reason: "APPROVED_PROOF", entitlementCents: cents });
const deny = { outcome: "DENY" as const, reason: "OUT_OF_PERIOD", entitlementCents: 0 };
const review = { outcome: "REVIEW" as const, reason: "TEMPLATE_CLUSTER", entitlementCents: 0 };
const needMore = { outcome: "NEED_MORE" as const, reason: "NEED_DOCUMENT", entitlementCents: 0 };

describe("wilson", () => {
  it("matches known 95% intervals", () => {
    const w0 = wilson(0, 15);
    expect(w0.rate).toBe(0);
    expect(w0.high).toBeCloseTo(0.2039, 4);
    const w1 = wilson(1, 10);
    expect(w1.low).toBeCloseTo(0.0179, 3);
    expect(w1.high).toBeCloseTo(0.4042, 3);
  });
});

describe("what each arm pays", () => {
  it("arm A pays the claim as filed, capped at the tier maximum", () => {
    expect(claimedCents(row("fraud", "proof", 7, deny).claim, T)).toBe(7500);
    expect(claimedCents(row("fraud", "no_proof", 1, deny).claim, T)).toBe(1000);
  });

  it("a perfect analyst pays honest claims what the evidence supports, and nothing else", () => {
    expect(analystCents(row("honest", "proof", 5, review, undefined, null, 2), T)).toBe(3000);
    expect(analystCents(row("fraud", "proof", 5, review), T)).toBe(0);
    expect(analystCents(row("ineligible", "proof", 1, review), T)).toBe(0);
  });

  it("arm B pays only an approval, for the fewest of its units, the claim's and the maximum", () => {
    expect(armBCents(row("fraud", "proof", 5, deny, { decision: "approve", units: 9 }), T)).toBe(7500);
    expect(armBCents(row("fraud", "proof", 2, deny, { decision: "approve", units: 9 }), T)).toBe(3000);
    expect(armBCents(row("fraud", "proof", 5, deny, { decision: null, units: 0 }), T)).toBe(0);
  });

  it("arm C's worst case lets the model's own view decide every REVIEW", () => {
    const r = row("fraud", "proof", 5, review, { decision: "deny", units: 0 }, "approve");
    expect(armCCents(r, T, "label")).toBe(0);
    expect(armCCents(r, T, "model")).toBe(7500);
    const bot = row("fraud", "no_proof", 1, review, { decision: "approve", units: 1 });
    expect(armCCents(bot, T, "model")).toBe(1000);
  });
});

describe("the gate", () => {
  const base = () => [
    row("honest", "proof", 1, approve(1500)),
    row("honest", "no_proof", 1, approve(1000)),
    row("honest", "proof", 1, approve(1500)),
    row("honest", "proof", 1, approve(1500)),
    row("fraud", "proof", 5, deny),
    row("fraud", "no_proof", 1, review),
  ];

  it("GO when fraud is cut, few honest are denied and few need a person", () => {
    const s = score([...base(), ...Array.from({ length: 6 }, () => row("honest", "proof", 1, approve(1500)))], T, 0.2);
    expect(s.armA.fraudCents).toBe(8500);
    expect(s.armC.fraudCents).toBe(0);
    expect(s.gate).toMatchObject({ fraudRatio: 0, deniedOk: true, workloadOk: true, go: true });
  });

  it("NO-GO when more than 10% of honest claims are denied", () => {
    const rows = [...base(), ...Array.from({ length: 4 }, () => row("honest", "proof", 1, approve(1500))), row("honest", "proof", 1, deny), row("honest", "proof", 1, deny)];
    const s = score(rows, T, 0.2);
    expect(s.armC.honestWronglyDenied.k).toBe(2);
    expect(s.armC.honestWronglyDenied.n).toBe(10);
    expect(s.gate.deniedOk).toBe(false);
    expect(s.gate.go).toBe(false);
  });

  it("NO-GO when more than 30% of honest claims need a person or a document", () => {
    const rows = [...base(), row("honest", "proof", 1, review), row("honest", "proof", 1, needMore)];
    const s = score(rows, T, 0.2);
    expect(s.armC.honestWorkload.k).toBe(2);
    expect(s.armC.honestWorkload.rate).toBeCloseTo(2 / 6);
    expect(s.gate.workloadOk).toBe(false);
  });

  it("NO-GO when arm C pays more than a quarter of arm A's fraud", () => {
    const rows = [...base(), row("fraud", "proof", 5, approve(7500))];
    const s = score(rows, T, 0.2);
    expect(s.gate.fraudRatio).toBeCloseTo(7500 / 16000);
    expect(s.gate.fraudOk).toBe(false);
  });

  it("ineligible money is counted on its own line, never as fraud", () => {
    const s = score([...base(), row("ineligible", "proof", 1, approve(1500))], T, 0.2);
    expect(s.armC.ineligibleCents).toBe(1500);
    expect(s.armC.fraudCents).toBe(0);
  });

  it("dilution: paying everyone shrinks the honest claimant's check", () => {
    const rows = [...base(), ...Array.from({ length: 40 }, () => row("fraud", "proof", 5, deny))];
    const s = score(rows, T, 0.05); // fund $100, reserve $5
    expect(s.armA.honestAverageCheckCents).toBeLessThan(s.armC.honestAverageCheckCents);
  });
});
