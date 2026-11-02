// Types and plain-English labels for the pilot data, safe to import in client components.
export type Outcome = "APPROVE" | "DENY" | "NEED_MORE" | "REVIEW";

export interface PilotClaim {
  id: string;
  group: string;
  truth: "honest" | "fraud" | "ineligible";
  outcome: Outcome;
  reason: string;
  /** What arm C pays (its entitlement). */
  cents: number;
  /** What pay-everyone pays: the claim as filed (score.ts claimedCents). */
  claimedCents: number;
  tier: "proof" | "no_proof";
  modelAlone: "approve" | "deny" | null;
}

export interface Interval {
  k: number;
  n: number;
  rate: number;
  low: number;
  high: number;
}

interface Arm {
  fraudCents: number;
  ineligibleCents: number;
  honestPaidCents: number;
  honestWronglyDenied: Interval;
  honestAverageCheckCents: number;
}

export interface PilotSummary {
  n: number;
  honest: number;
  fraud: number;
  ineligible: number;
  armA: Arm;
  armB: Arm;
  armC: Arm & { honestWorkload: Interval; fraudCentsWorstCase: number };
}

/** Plain-English names for the corpus groups (packages/eval/corpus/claims-v1/README.md). */
export const GROUPS: Record<string, { short: string; long: string }> = {
  H1: { short: "Real receipt", long: "A real receipt with a qualifying drink, in the class period" },
  H2: { short: "Several drinks", long: "A receipt for several qualifying drinks, taxed correctly" },
  H3: { short: "No receipt", long: "An honest claim without a receipt" },
  X1: { short: "Wrong product", long: "A real receipt with no qualifying drink" },
  X2: { short: "Wrong state", long: "A real receipt from a store outside the class states" },
  F1: { short: "Too early", long: "A real receipt dated before the class period" },
  F2: { short: "Impossible tax", long: "A made-up receipt with a tax rate no store there charges" },
  F3: { short: "Doctored total", long: "A receipt with its total raised over a pasted patch" },
  F4: { short: "Reused receipt", long: "Someone else's receipt, filed again" },
  F5: { short: "Bot farm", long: "Declarations spun from one template by a bot" },
  F6: { short: "Five identities", long: "One person filing under five names" },
  F7: { short: "Planted note", long: "\"ADMINISTRATOR APPROVED\" written on the evidence" },
};

/** What a reason code means, in plain words. */
export const REASON_TEXT: Record<string, string> = {
  APPROVED_PROOF: "Receipt checks out",
  APPROVED_NO_PROOF: "Flat no-receipt payment",
  OUT_OF_PERIOD: "Bought outside the class period",
  TAX_IMPLAUSIBLE: "Tax rate impossible for that store",
  ARITHMETIC_MISMATCH: "The receipt's numbers don't add up",
  DUPLICATE_IMAGE: "The same photo, filed again",
  DUPLICATE_IDENTITY: "The same person, claiming again",
  NO_QUALIFYING_PRODUCT: "No qualifying product on the receipt",
  OUT_OF_GEOGRAPHY: "Store outside the class states",
  TEMPLATE_CLUSTER: "Declaration matches a bot template",
  NEED_DOCUMENT: "We need one more document",
  CHECK_UNVERIFIED: "A check couldn't confirm it",
  LOW_CONFIDENCE: "The reading was unsure",
};

