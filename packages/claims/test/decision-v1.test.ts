import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CHECKS_FOR_TIER, type CheckOutcome } from "../src/checks.ts";
import { decide, type DecisionInput } from "../src/decision-v1.ts";
import { checks, demoSettlement } from "./fixtures.ts";

const S = demoSettlement();
const ok = { status: "OK" as const, confidence: "high" as const };
const proof = (over: Parameters<typeof checks>[1] = {}, extra: Partial<DecisionInput> = {}): DecisionInput => ({ tier: "proof", unitsClaimed: 2, unitsEvidenced: 9, examiner: ok, checks: checks("proof", over), ...extra });
const noProof = (over: Parameters<typeof checks>[1] = {}, extra: Partial<DecisionInput> = {}): DecisionInput => ({ tier: "no_proof", unitsClaimed: 1, examiner: { status: "NOT_RUN" }, checks: checks("no_proof", over), ...extra });

describe("decision table v1: one test per rule", () => {
  it.each([
    ["INVALID", "EXAMINER_INVALID"],
    ["REFUSED", "EXAMINER_REFUSED"],
    ["NOT_RUN", "EXAMINER_NOT_RUN"],
  ] as const)("rule 0: examiner %s on a proof claim → REVIEW %s", (status, reason) => {
    expect(decide(S, proof({}, { examiner: { status } }))).toMatchObject({ outcome: "REVIEW", rule: 0, reason });
  });

  it.each([
    ["C1", "OUT_OF_PERIOD"],
    ["C2", "NO_QUALIFYING_PRODUCT"],
    ["C3", "ARITHMETIC_MISMATCH"],
    ["C4", "TAX_IMPLAUSIBLE"],
    ["C5", "OUT_OF_GEOGRAPHY"],
  ] as const)("rule 1: %s FAIL → DENY %s", (id, reason) => {
    expect(decide(S, proof({ [id]: "FAIL" }))).toMatchObject({ outcome: "DENY", rule: 1, reason, check: id });
  });

  it.each([
    ["C6", "DUPLICATE_IMAGE"],
    ["C8", "DUPLICATE_IDENTITY"],
  ] as const)("rule 2: %s FAIL → DENY %s", (id, reason) => {
    expect(decide(S, proof({ [id]: "FAIL" }))).toMatchObject({ outcome: "DENY", rule: 2, reason, check: id });
  });

  it.each([
    ["C7", "TEMPLATE_CLUSTER"],
    ["C9", "VELOCITY_CLUSTER"],
  ] as const)("rule 3: %s FAIL → REVIEW %s", (id, reason) => {
    expect(decide(S, proof({ [id]: "FAIL" }))).toMatchObject({ outcome: "REVIEW", rule: 3, reason, check: id });
  });

  it("rule 4: C10 FAIL (anomaly) → REVIEW, never DENY", () => {
    expect(decide(S, proof({ C10: "FAIL" }))).toMatchObject({ outcome: "REVIEW", rule: 4, reason: "VISUAL_ANOMALY" });
  });

  it("rule 0: low examiner confidence → REVIEW; medium is fine", () => {
    expect(decide(S, proof({}, { examiner: { status: "OK", confidence: "low" } }))).toMatchObject({ outcome: "REVIEW", rule: 0, reason: "LOW_CONFIDENCE" });
    expect(decide(S, proof({}, { examiner: { status: "OK", confidence: "medium" } }))).toMatchObject({ outcome: "APPROVE" });
  });

  it("rule 3: C12 FAIL (same merchant, date, total) → REVIEW, never DENY", () => {
    expect(decide(S, proof({ C12: "FAIL" }))).toMatchObject({ outcome: "REVIEW", rule: 3, reason: "REPEAT_RECEIPT_DETAILS", check: "C12" });
  });

  it.each(["C1", "C2", "C3", "C5"] as const)("rule 5: %s UNKNOWN → NEED_MORE naming the document", (id) => {
    const d = decide(S, proof({ [id]: "UNKNOWN" }));
    expect(d).toMatchObject({ outcome: "NEED_MORE", rule: 5, reason: "NEED_DOCUMENT", check: id });
    expect(d.outcome === "NEED_MORE" && d.documentRequest.length).toBeGreaterThan(10);
  });

  it.each(["C6", "C7", "C8", "C9", "C10", "C11", "C12"] as const)("rule 6: %s UNKNOWN (our side) → REVIEW, not NEED_MORE", (id) => {
    expect(decide(S, proof({ [id]: "UNKNOWN" }))).toMatchObject({ outcome: "REVIEW", rule: 6, reason: "CHECK_UNVERIFIED", check: id });
  });

  it("rule 6: C4 UNKNOWN → REVIEW with a reason a court can read", () => {
    expect(decide(S, proof({ C4: "UNKNOWN" }))).toMatchObject({ outcome: "REVIEW", rule: 6, reason: "TAX_UNCONFIRMED", check: "C4" });
  });

  it("rule 7: a clean no-proof claim gets the flat amount, one unit", () => {
    expect(decide(S, noProof())).toMatchObject({ outcome: "APPROVE", rule: 7, reason: "APPROVED_NO_PROOF", tier: "no_proof", units: 1, entitlementCents: 1000 });
  });

  it("rule 8: a clean proof claim gets units × unit value", () => {
    expect(decide(S, proof())).toMatchObject({ outcome: "APPROVE", rule: 8, reason: "APPROVED_PROOF", tier: "proof", units: 2, entitlementCents: 3000 });
  });

  it("rule 8: units above the tier maximum are capped, not denied (C11)", () => {
    expect(decide(S, proof({ C11: "FAIL" }, { unitsClaimed: 9 }))).toMatchObject({ outcome: "APPROVE", units: 5, unitsClaimed: 9, entitlementCents: 7500 });
  });

  it("rule 8: a receipt for 1 unit pays for 1, whatever was claimed (C11)", () => {
    expect(decide(S, proof({ C11: "FAIL" }, { unitsClaimed: 5, unitsEvidenced: 1 }))).toMatchObject({ outcome: "APPROVE", units: 1, unitsClaimed: 5, entitlementCents: 1500 });
  });

  it.each([[undefined], [0], [1.5]])("rule 8: evidenced units of %s pay nothing; a person looks", (unitsEvidenced) => {
    expect(decide(S, proof({}, { unitsEvidenced }))).toMatchObject({ outcome: "REVIEW", check: "C11", reason: "CHECK_UNVERIFIED" });
  });
});

describe("decision table v1: rule order", () => {
  it("a failed examiner run beats a failed check", () => {
    expect(decide(S, proof({ C1: "FAIL" }, { examiner: { status: "INVALID" } }))).toMatchObject({ rule: 0 });
  });
  it.each(["C1", "C2", "C3", "C4", "C5", "C6", "C8"] as const)("low confidence beats a %s denial: a misread never denies", (id) => {
    expect(decide(S, proof({ [id]: "FAIL" }, { examiner: { status: "OK", confidence: "low" } }))).toMatchObject({ outcome: "REVIEW", rule: 0, reason: "LOW_CONFIDENCE" });
  });
  it("a no-proof claim has no reading to doubt, so confidence does not apply", () => {
    expect(decide(S, noProof({ C8: "FAIL" }, { examiner: { status: "OK", confidence: "low" } }))).toMatchObject({ outcome: "DENY", reason: "DUPLICATE_IDENTITY" });
  });
  it("the first failed check names the reason (C1 before C3)", () => {
    expect(decide(S, proof({ C3: "FAIL", C1: "FAIL" }))).toMatchObject({ reason: "OUT_OF_PERIOD" });
  });
  it("a FAIL beats an UNKNOWN earlier in the list", () => {
    expect(decide(S, proof({ C1: "UNKNOWN", C2: "FAIL" }))).toMatchObject({ outcome: "DENY", check: "C2" });
  });
  it("an evidence denial beats a duplicate", () => {
    expect(decide(S, proof({ C6: "FAIL", C4: "FAIL" }))).toMatchObject({ outcome: "DENY", reason: "TAX_IMPLAUSIBLE" });
  });
  it("a duplicate denial beats a cluster review", () => {
    expect(decide(S, proof({ C7: "FAIL", C8: "FAIL" }))).toMatchObject({ outcome: "DENY", reason: "DUPLICATE_IDENTITY" });
  });
  it("a hash match denies even when the merchant, date and total also match", () => {
    expect(decide(S, proof({ C6: "FAIL", C12: "FAIL" }))).toMatchObject({ outcome: "DENY", reason: "DUPLICATE_IMAGE" });
  });
  it("a cluster review beats an anomaly review", () => {
    expect(decide(S, proof({ C10: "FAIL", C7: "FAIL" }))).toMatchObject({ reason: "TEMPLATE_CLUSTER" });
  });
  it("an anomaly review beats asking for a document", () => {
    expect(decide(S, proof({ C10: "FAIL", C1: "UNKNOWN" }))).toMatchObject({ outcome: "REVIEW", reason: "VISUAL_ANOMALY" });
  });
  it("asking for a fixable document comes before an unverified check on our side", () => {
    expect(decide(S, proof({ C4: "UNKNOWN", C1: "UNKNOWN" }))).toMatchObject({ outcome: "NEED_MORE", check: "C1" });
  });
  it("a missing check counts as UNKNOWN, never as PASS", () => {
    expect(decide(S, proof({ C6: null }))).toMatchObject({ outcome: "REVIEW", check: "C6" });
    expect(decide(S, proof({ C1: null }))).toMatchObject({ outcome: "NEED_MORE", check: "C1" });
  });
});

describe("decision table v1: no-proof claims", () => {
  it("evidence checks do not apply, and do not block", () => {
    const d = decide(S, { ...noProof(), checks: [...checks("no_proof"), { id: "C1", result: "FAIL", detail: "" }] });
    expect(d).toMatchObject({ outcome: "APPROVE", tier: "no_proof" });
    expect(Object.keys(d.checks).sort()).toEqual([...CHECKS_FOR_TIER.no_proof].sort());
  });
  it("outside the class geography → DENY (gap in spec §4.4 rules 1 and 6, fixed)", () => {
    expect(decide(S, noProof({ C5: "FAIL" }))).toMatchObject({ outcome: "DENY", reason: "OUT_OF_GEOGRAPHY" });
  });
  it("a second claim by the same person → DENY", () => {
    expect(decide(S, noProof({ C8: "FAIL" }))).toMatchObject({ outcome: "DENY", reason: "DUPLICATE_IDENTITY" });
  });
  it("a templated declaration → REVIEW", () => {
    expect(decide(S, noProof({ C7: "FAIL" }))).toMatchObject({ outcome: "REVIEW", reason: "TEMPLATE_CLUSTER" });
  });
  it("an unknown identity lookup → REVIEW, not approve", () => {
    expect(decide(S, noProof({ C8: "UNKNOWN" }))).toMatchObject({ outcome: "REVIEW", check: "C8" });
  });
  it("no examiner run is needed", () => {
    expect(decide(S, noProof({}, { examiner: { status: "NOT_RUN" } }))).toMatchObject({ outcome: "APPROVE" });
  });
});

describe("decision table v1: input guards", () => {
  it("rejects a check given twice", () => {
    expect(() => decide(S, { ...proof(), checks: [...checks("proof"), { id: "C1", result: "PASS", detail: "" }] })).toThrow(/twice/);
  });
  it("rejects non-positive or fractional units", () => {
    for (const unitsClaimed of [0, -1, 1.5]) expect(() => decide(S, proof({}, { unitsClaimed }))).toThrow();
  });
  it("never reads the model's recommendation: the word is absent from the decision code", () => {
    const src = readFileSync(new URL("../src/decision-v1.ts", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/recommend/i);
  });
});

describe("decision table v1: properties", () => {
  const outcome = fc.constantFrom<CheckOutcome>("PASS", "PASS", "PASS", "FAIL", "UNKNOWN");
  const arbInput = fc.record({
    tier: fc.constantFrom("proof" as const, "no_proof" as const),
    unitsClaimed: fc.integer({ min: 1, max: 50 }),
    status: fc.constantFrom("OK" as const, "OK" as const, "INVALID" as const, "REFUSED" as const, "NOT_RUN" as const),
    confidence: fc.constantFrom("high" as const, "medium" as const, "low" as const),
    results: fc.record({ C1: outcome, C2: outcome, C3: outcome, C4: outcome, C5: outcome, C6: outcome, C7: outcome, C8: outcome, C9: outcome, C10: outcome, C11: outcome, C12: outcome }),
    unitsEvidenced: fc.integer({ min: 1, max: 50 }),
  });

  // C11 is the one check whose FAIL means "cap the units", not "reject" (spec §4.3).
  it("APPROVE only when every applicable check PASSED, C11 aside (and, with evidence, the examiner ran cleanly)", () => {
    fc.assert(
      fc.property(arbInput, (a) => {
        const d = decide(S, { tier: a.tier, unitsClaimed: a.unitsClaimed, unitsEvidenced: a.unitsEvidenced, examiner: { status: a.status, confidence: a.confidence }, checks: checks(a.tier, a.results) });
        const applicable = CHECKS_FOR_TIER[a.tier];
        const cleared = applicable.every((id) => (id === "C11" ? a.results[id] !== "UNKNOWN" : a.results[id] === "PASS"));
        if (d.outcome === "APPROVE") {
          expect(cleared).toBe(true);
          if (a.tier === "proof") expect(a.status === "OK" && a.confidence !== "low").toBe(true);
          const max = a.tier === "proof" ? S.tiers.proof.unitCents * S.tiers.proof.maxUnits : S.tiers.noProof.flatCents;
          expect(d.entitlementCents).toBeGreaterThan(0);
          expect(d.entitlementCents).toBeLessThanOrEqual(max);
        }
        if (d.outcome === "APPROVE" && a.tier === "proof") {
          expect(d.units).toBeLessThanOrEqual(Math.min(a.unitsClaimed, a.unitsEvidenced, S.tiers.proof.maxUnits));
        }
        // A reading the examiner doubts can never deny a claim with evidence.
        if (a.tier === "proof" && a.status === "OK" && a.confidence === "low") expect(d).toMatchObject({ outcome: "REVIEW", reason: "LOW_CONFIDENCE" });
        // C12 rests on what the model read: alone, it can never deny.
        if (d.outcome === "DENY") expect(d.check).not.toBe("C12");
        if (d.outcome === "DENY") expect(a.results[d.check]).toBe("FAIL");
        if (d.outcome === "NEED_MORE") expect(a.results[d.check]).toBe("UNKNOWN");
        if (cleared && (a.tier === "no_proof" || (a.status === "OK" && a.confidence !== "low"))) {
          expect(d.outcome).toBe("APPROVE");
        }
      }),
      { numRuns: 5000 },
    );
  });
});
