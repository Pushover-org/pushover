import { describe, expect, it } from "vitest";
import { CLAIMANT_STATE, claimantState, expectedAmount } from "./claim-status.ts";

// Every state the claims table allows (migration 0004's claim_state, and 0012's UNBOUND and LAPSED), plus the derived ones.
const STORED = ["UNBOUND", "LAPSED", "SUBMITTED", "EXAMINED", "APPROVE", "DENY", "NEED_MORE", "REVIEW", "SCHEDULED", "PAID", "UNCLAIMED", "RETURNED", "FAILED", "CY_PRES_ELIGIBLE", "UNVERIFIED"] as const;
const tiers = { proof: { unitCents: 1500, maxUnits: 5 }, noProof: { flatCents: 1000 } };

describe("what a claimant reads", () => {
  it.each(STORED)("%s has a title and a plain explanation", (state) => {
    expect(CLAIMANT_STATE[state].title.length).toBeGreaterThan(2);
    expect(CLAIMANT_STATE[state].detail.length).toBeGreaterThan(30);
  });

  it("covers every state and nothing else", () => {
    expect(Object.keys(CLAIMANT_STATE).sort()).toEqual([...STORED, "WAITING_VERIFICATION", "GROUP_HELD"].sort());
  });

  it("a claim in a held group is shown as held, never as simply approved", () => {
    expect(claimantState("APPROVE", true, true)).toBe("GROUP_HELD");
    expect(claimantState("REVIEW", true, true)).toBe("GROUP_HELD");
    expect(claimantState("DENY", true, true)).toBe("DENY");
    expect(CLAIMANT_STATE.GROUP_HELD.detail).toMatch(/Held is not denied/);
  });

  it("an approved claim from an unverified PayPal account waits, and says so", () => {
    expect(claimantState("APPROVE", false)).toBe("WAITING_VERIFICATION");
    expect(claimantState("APPROVE", true)).toBe("APPROVE");
    expect(claimantState("APPROVE", null)).toBe("APPROVE");
    expect(claimantState("REVIEW", false)).toBe("REVIEW");
    expect(CLAIMANT_STATE.WAITING_VERIFICATION.detail).toMatch(/nothing is sent/);
  });

  it("held, in-flight and unconfirmed are never titled as done", () => {
    for (const s of ["UNBOUND", "REVIEW", "UNVERIFIED", "SCHEDULED", "UNCLAIMED", "WAITING_VERIFICATION", "GROUP_HELD"] as const) expect(CLAIMANT_STATE[s].title).not.toMatch(/\b(paid|safe|done|complete)\b/i);
    expect(CLAIMANT_STATE.UNVERIFIED.detail).toMatch(/never as paid/);
  });

  it("an assistant's filing reads as waiting for its person, and says nothing is paid before they confirm", () => {
    expect(CLAIMANT_STATE.UNBOUND.title).toMatch(/waiting/i);
    expect(CLAIMANT_STATE.UNBOUND.detail).toMatch(/log in with PayPal/);
    expect(CLAIMANT_STATE.UNBOUND.detail).toMatch(/nothing is read, decided or paid/);
    expect(CLAIMANT_STATE.LAPSED.detail).toMatch(/never read, decided or paid/);
  });
});

describe("the expected amount", () => {
  it("states an approved claim's amount and why", () => {
    expect(expectedAmount({ tier: "proof", entitlementCents: 3000, units: 2, approved: true }, tiers)).toMatchObject({ amount: "$30.00", basis: expect.stringMatching(/^2 qualifying drinks at \$15\.00 each\./) });
    expect(expectedAmount({ tier: "no_proof", entitlementCents: 1000, units: 1, approved: true }, tiers).amount).toBe("$10.00");
  });
  it("states what an undecided claim could pay, from the settlement's tiers", () => {
    expect(expectedAmount({ tier: "proof", entitlementCents: null, units: null, approved: false }, tiers)).toMatchObject({ amount: "up to $75.00", basis: expect.stringMatching(/up to 5\./) });
    expect(expectedAmount({ tier: "no_proof", entitlementCents: null, units: null, approved: false }, tiers).amount).toBe("$10.00");
  });
  it("always says the share can be reduced pro rata", () => {
    expect(expectedAmount({ tier: "no_proof", entitlementCents: null, units: null, approved: false }, tiers).basis).toMatch(/same proportion/);
  });
});
