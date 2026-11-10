// Plain-language labels for outcomes, reasons and checks (docs/design-direction.md → Copy).
import type { Outcome } from "./pilot-shared.ts";

export const OUTCOME_LABEL: Record<Outcome, string> = { APPROVE: "Approved", DENY: "Denied", NEED_MORE: "Need more", REVIEW: "Review" };

/** What a reason code means, in a few words. The full sentence is REASONS in @proofofclaim/claims. */
export const REASON_SHORT: Record<string, string> = {
  APPROVED_PROOF: "Receipt checks out",
  APPROVED_NO_PROOF: "Flat no-receipt payment",
  OUT_OF_PERIOD: "Bought outside the class period",
  NO_QUALIFYING_PRODUCT: "No qualifying product",
  ARITHMETIC_MISMATCH: "The numbers don't add up",
  TAX_IMPLAUSIBLE: "Impossible tax for that state",
  OUT_OF_GEOGRAPHY: "Outside the class states",
  DUPLICATE_IMAGE: "Same photo filed again",
  DUPLICATE_IDENTITY: "Same person, claiming again",
  TEMPLATE_CLUSTER: "Matches a bot template",
  VELOCITY_CLUSTER: "Burst from one network",
  REPEAT_RECEIPT_DETAILS: "Same receipt details as another claim",
  VISUAL_ANOMALY: "Signs of editing",
  LOW_CONFIDENCE: "Hard to read",
  EXAMINER_INVALID: "Reading failed",
  EXAMINER_REFUSED: "Reader declined",
  EXAMINER_NOT_RUN: "Not read yet",
  TAX_UNCONFIRMED: "Tax couldn't be confirmed",
  CHECK_UNVERIFIED: "A check couldn't finish",
  NEED_DOCUMENT: "Needs one more document",
  ANALYST_APPROVED: "Approved by an analyst",
  ANALYST_DENIED: "Denied by an analyst",
};

export const GROUP_LABEL: Record<string, string> = {
  H1: "Honest · real receipt", H2: "Honest · several drinks", H3: "Honest · no receipt", X1: "Doesn't qualify · wrong product", X2: "Doesn't qualify · wrong state",
  F1: "Fraud · too early", F2: "Fraud · impossible tax", F3: "Fraud · doctored total", F4: "Fraud · reused receipt", F5: "Fraud · bot farm", F6: "Fraud · five identities", F7: "Fraud · planted note",
};

export const dollars = (cents: number | null | undefined, dp = 2) => (cents == null ? "—" : `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`);

/** Personal data is masked on public pages: "Dana Reyes" → "D. R." */
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).map((p) => `${p[0]?.toUpperCase() ?? ""}.`).join(" ");
