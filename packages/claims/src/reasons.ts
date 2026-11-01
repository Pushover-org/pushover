import type { CheckId } from "./checks.ts";

/**
 * Reason codes. Every decision carries one, with a sentence a court or class member can read
 * (spec §1.2: the court and class counsel read the output).
 */
export const REASONS = {
  APPROVED_PROOF: "Approved at the proof tier: the evidence passed every check.",
  APPROVED_NO_PROOF: "Approved at the no-proof tier: the claim passed the identity, geography and cluster checks.",
  OUT_OF_PERIOD: "Denied: the purchase date is outside the class period.",
  NO_QUALIFYING_PRODUCT: "Denied: no qualifying product appears on the evidence.",
  ARITHMETIC_MISMATCH: "Denied: the receipt's line items, subtotal, tax and total do not add up.",
  TAX_IMPLAUSIBLE: "Denied: the sales tax on the receipt is not possible for the store's state.",
  OUT_OF_GEOGRAPHY: "Denied: the claimant or the store is outside the class geography.",
  DUPLICATE_IMAGE: "Denied: the same evidence image was already filed with another claim.",
  DUPLICATE_IDENTITY: "Denied: this person, address or payout email already has an approved claim.",
  TEMPLATE_CLUSTER: "Held for review: the declaration closely matches a cluster of other claims.",
  VELOCITY_CLUSTER: "Held for review: many claims came from the same network in a short time.",
  REPEAT_RECEIPT_DETAILS: "Held for review: another claim shows the same merchant, date and total.",
  VISUAL_ANOMALY: "Held for review: the evidence image shows signs of editing.",
  LOW_CONFIDENCE: "Held for review: the evidence could not be read with confidence.",
  EXAMINER_INVALID: "Held for review: the automated reading of the evidence failed validation.",
  EXAMINER_REFUSED: "Held for review: the automated reader declined to process the evidence.",
  EXAMINER_NOT_RUN: "Held for review: the evidence has not been read yet.",
  TAX_UNCONFIRMED: "Held for review: the sales tax on the receipt could not be confirmed for the store's state.",
  CHECK_UNVERIFIED: "Held for review: a required check could not be completed.",
  NEED_DOCUMENT: "More information needed before a decision can be made.",
  ANALYST_APPROVED: "Approved by a claims analyst after review.",
  ANALYST_DENIED: "Denied by a claims analyst after review.",
} as const;

export type ReasonCode = keyof typeof REASONS;

/** Checks whose FAIL denies a claim. */
export type DenyCheckId = "C1" | "C2" | "C3" | "C4" | "C5" | "C6" | "C8";

/** A failed check that denies a claim, and its reason. */
export const DENY_REASON: Record<DenyCheckId, ReasonCode> = {
  C1: "OUT_OF_PERIOD",
  C2: "NO_QUALIFYING_PRODUCT",
  C3: "ARITHMETIC_MISMATCH",
  C4: "TAX_IMPLAUSIBLE",
  C5: "OUT_OF_GEOGRAPHY",
  C6: "DUPLICATE_IMAGE",
  C8: "DUPLICATE_IDENTITY",
};

/** Unknown results the claimant can fix by sending something, and what to ask for. */
export const DOCUMENT_REQUEST: Partial<Record<CheckId, string>> = {
  C1: "A receipt or order confirmation that shows the purchase date.",
  C2: "A receipt or photo that shows the qualifying product.",
  C3: "A receipt that shows the item prices, subtotal, tax and total.",
  C5: "A valid US mailing address, and a receipt that shows the store's location.",
};
