/** Deterministic checks (spec §4.3). packages/checks computes them; the decision table reads them. */
export const CHECK_IDS = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10", "C11"] as const;
export type CheckId = (typeof CHECK_IDS)[number];

/** UNKNOWN is never PASS. */
export type CheckOutcome = "PASS" | "FAIL" | "UNKNOWN";

export interface CheckResult {
  id: CheckId;
  result: CheckOutcome;
  detail: string;
}

export const CHECK_NAMES: Record<CheckId, string> = {
  C1: "Class period",
  C2: "Qualifying product",
  C3: "Arithmetic",
  C4: "Tax plausibility",
  C5: "Geography",
  C6: "Duplicate image",
  C7: "Template declaration",
  C8: "Identity dedupe",
  C9: "Velocity",
  C10: "Visual anomaly",
  C11: "Units cap",
};

export type Tier = "proof" | "no_proof";

/** Which checks apply to a claim. A no-proof claim has no evidence to read. */
export const CHECKS_FOR_TIER: Record<Tier, readonly CheckId[]> = {
  proof: CHECK_IDS,
  no_proof: ["C5", "C7", "C8", "C9", "C11"],
};
