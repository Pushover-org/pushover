// What a claimant reads about their claim, for every state it can be in (plan items P7, P8).
// Plain words; held and unconfirmed are never presented as done.
import type { ClaimState } from "@proofofclaim/db";
import { translator, type Translate } from "./i18n.ts";

/**
 * A claim's state as its claimant sees it: the stored state, plus approval that waits for PayPal
 * verification, and a claim held with a linked group (plan item P9).
 */
export type ClaimantState = ClaimState | "WAITING_VERIFICATION" | "GROUP_HELD";

export const CLAIMANT_STATE: Record<ClaimantState, { title: string; detail: string }> = {
  SUBMITTED: { title: "Filed", detail: "We have your claim. The checks run within seconds." },
  UNBOUND: {
    title: "Waiting for you to confirm",
    detail: "An assistant filed this for you. It isn't a claim yet: nothing is read, decided or paid until you open the confirm link, log in with PayPal and confirm it's yours.",
  },
  LAPSED: {
    title: "Closed: never confirmed",
    detail: "An assistant filed this for someone, and nobody confirmed it in time, or the person said it wasn't theirs. It was never read, decided or paid. While filing is open, you can still file your own claim.",
  },
  EXAMINED: { title: "Receipt read", detail: "Your receipt has been read. The checks and the published rules decide next." },
  APPROVE: { title: "Approved", detail: "Your claim passed the checks. You're paid when the court approves the distribution." },
  WAITING_VERIFICATION: {
    title: "Approved, waiting for PayPal verification",
    detail: "Your claim is approved, but your PayPal account isn't verified yet, so nothing is sent. Verify it with PayPal, then log in with PayPal on the claim page again. We pay once it's verified.",
  },
  GROUP_HELD: {
    title: "Held for a person, with linked claims",
    detail: "Your claim shares something, such as a device, an inbox or its wording, with other claims, so a person checks them together. Held is not denied.",
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

export function claimantState(status: ClaimState, paypalVerified: boolean | null, heldInGroup = false): ClaimantState {
  // A held group stops its money (P23), so an approved claim in one is not shown as simply approved.
  if (heldInGroup && (status === "APPROVE" || status === "REVIEW")) return "GROUP_HELD";
  return status === "APPROVE" && paypalVerified === false ? "WAITING_VERIFICATION" : status;
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** What the claim can pay, in the settlement's own terms (P8), in the claimant's language. Approved claims show their amount. */
export function expectedAmount(
  t: { tier: "proof" | "no_proof"; entitlementCents: number | null; units: number | null; approved: boolean },
  tiers: { proof: { unitCents: number; maxUnits: number }; noProof: { flatCents: number } },
  tr: Translate = translator("en"),
): { amount: string; basis: string } {
  const share = tr("money.share");
  if (t.approved && t.entitlementCents !== null) {
    const basis =
      t.tier === "proof" && t.units
        ? t.units === 1
          ? tr("money.approvedProofOne", { unit: usd(tiers.proof.unitCents) })
          : tr("money.approvedProof", { units: t.units, unit: usd(tiers.proof.unitCents) })
        : tr("money.approvedFlat");
    return { amount: usd(t.entitlementCents), basis: `${basis} ${share}` };
  }
  if (t.tier === "proof") {
    return {
      amount: tr("money.upTo", { amount: usd(tiers.proof.unitCents * tiers.proof.maxUnits) }),
      basis: `${tr("money.ifProof", { unit: usd(tiers.proof.unitCents), max: tiers.proof.maxUnits })} ${share}`,
    };
  }
  return { amount: usd(tiers.noProof.flatCents), basis: `${tr("money.ifFlat", { amount: usd(tiers.noProof.flatCents) })} ${share}` };
}
