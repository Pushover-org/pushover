// What a claimant reads about their claim, for every state it can be in (plan items P7, P8).
// Plain words; held and unconfirmed are never presented as done.
import type { ClaimState } from "@proofofclaim/db";

/** A claim's state as its claimant sees it: the stored state, plus approval that waits for PayPal verification. */
export type ClaimantState = ClaimState | "WAITING_VERIFICATION";

export const CLAIMANT_STATE: Record<ClaimantState, { title: string; detail: string }> = {
  SUBMITTED: { title: "Filed", detail: "We have your claim. The checks run within seconds." },
  EXAMINED: { title: "Receipt read", detail: "Your receipt has been read. The checks and the published rules decide next." },
  APPROVE: { title: "Approved", detail: "Your claim passed the checks. You're paid when the court approves the distribution." },
  WAITING_VERIFICATION: {
    title: "Approved, waiting for PayPal verification",
    detail: "Your claim is approved, but your PayPal account isn't verified yet, so nothing is sent. Verify it with PayPal, then log in with PayPal on the claim page again. We pay once it's verified.",
  },
  DENY: { title: "Denied", detail: "A published rule ruled this claim out. The reason below is the whole reason, and it's on the court's record." },
  NEED_MORE: { title: "One more document needed", detail: "Nothing is decided against you. The rules need one more document before they can decide." },
  REVIEW: { title: "Held for a person", detail: "A claims analyst will look at your evidence and decide. Held is not denied." },
  SCHEDULED: { title: "Sent to PayPal", detail: "Your payment is in a PayPal payout batch. PayPal hasn't confirmed delivery yet." },
  PAID: { title: "Paid", detail: "PayPal confirmed the payment to your PayPal account." },
  UNCLAIMED: {
    title: "Waiting for you in PayPal",
    detail: "PayPal is holding your payment until it's accepted. If it isn't accepted within 30 days, PayPal returns it to the fund.",
  },
  RETURNED: { title: "Returned to the fund", detail: "PayPal couldn't deliver the payment and returned it to the settlement fund. It is not lost." },
  FAILED: { title: "PayPal couldn't deliver it", detail: "PayPal reported the payment as failed. The money stays in the settlement fund." },
  CY_PRES_ELIGIBLE: {
    title: "Undelivered: the money went back to the program",
    detail: "Your payment couldn't be delivered. Money that can't be delivered goes to the nonprofit the court chose (cy-près), never anywhere else.",
  },
  UNVERIFIED: {
    title: "Payment unconfirmed",
    detail: "PayPal reported a status we can't confirm yet. Until it's checked, it's shown as unconfirmed, never as paid.",
  },
};

export function claimantState(status: ClaimState, paypalVerified: boolean | null): ClaimantState {
  return status === "APPROVE" && paypalVerified === false ? "WAITING_VERIFICATION" : status;
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** What the claim can pay, in the settlement's own terms (P8). Approved claims show their amount. */
export function expectedAmount(
  t: { tier: "proof" | "no_proof"; entitlementCents: number | null; units: number | null; approved: boolean },
  tiers: { proof: { unitCents: number; maxUnits: number }; noProof: { flatCents: number } },
): { amount: string; basis: string } {
  const share = "Your payment is your share of the fund: the full amount if the fund covers every valid claim, or otherwise every approved claim reduced by the same proportion.";
  if (t.approved && t.entitlementCents !== null) {
    const basis = t.tier === "proof" && t.units ? `${t.units} qualifying ${t.units === 1 ? "drink" : "drinks"} at ${usd(tiers.proof.unitCents)} each.` : "The flat amount for a claim without a receipt.";
    return { amount: usd(t.entitlementCents), basis: `${basis} ${share}` };
  }
  if (t.tier === "proof") {
    return {
      amount: `up to ${usd(tiers.proof.unitCents * tiers.proof.maxUnits)}`,
      basis: `If approved: ${usd(tiers.proof.unitCents)} for each qualifying drink your receipt shows, up to ${tiers.proof.maxUnits}. ${share}`,
    };
  }
  return { amount: usd(tiers.noProof.flatCents), basis: `If approved: a flat ${usd(tiers.noProof.flatCents)} for a claim without a receipt. ${share}` };
}
