// Where every cent of the fund is. Each cent sits in exactly one bucket, so money that returns and
// then goes to cy-près is not counted twice (spec §1.3's equation did). `heldCents` is worked out
// from the plan, not as "whatever is left", so a batch that differs from the plan shows up as a
// difference instead of disappearing.
import { payoutItemOutcome, valueToCents, type PayoutItem } from "@proofofclaim/paypal";
import type { Allocation } from "./allocate.ts";

export interface CyPresTransfer {
  cents: number;
  /** As PayPal reports it. Null until read back. */
  feeCents: number | null;
}

export interface ReconcileInput {
  fundCents: number;
  adminReserveCents: number;
  allocation: Allocation;
  /** Read back from PayPal. A batch that could not be read is passed as `unreadCents`. */
  items: PayoutItem[];
  /** Planned money whose batch or item could not be read: unknown, never zero. */
  unreadCents?: number;
  cyPres?: CyPresTransfer[];
}

export interface Reconciliation {
  fundCents: number;
  paidCents: number;
  /** With PayPal, waiting for the receiver; PayPal returns it after 30 days if unclaimed. */
  unclaimedCents: number;
  inFlightCents: number;
  /** Unknown is never zero: counted as neither paid nor returned until a read confirms it. */
  unverifiedCents: number;
  /** Returned, failed or never allocated, and not yet sent on. */
  awaitingCyPresCents: number;
  cyPresSentCents: number;
  feesCents: number;
  /** Items or transfers whose fee PayPal has not reported. Fees are never assumed. */
  feesUnknown: number;
  /** Admin reserve plus fee reserve not yet spent. */
  heldCents: number;
  /** fund − Σ buckets. Zero when PayPal's items match the plan. */
  differenceCents: number;
  /** A problem someone must look at. Empty means the books balance and nothing is unknown. */
  warnings: string[];
}

export function reconcile(r: ReconcileInput): Reconciliation {
  let paid = 0, unclaimed = 0, inFlight = 0, returned = 0, failed = 0, fees = 0, feesUnknown = 0;
  let unverified = r.unreadCents ?? 0;
  for (const it of r.items) {
    const cents = valueToCents(it.payout_item.amount.value);
    switch (payoutItemOutcome(it.transaction_status)) {
      case "PAID": paid += cents; break;
      case "UNCLAIMED": unclaimed += cents; break;
      case "RETURNED": returned += cents; break;
      case "FAILED": failed += cents; break;
      case "IN_FLIGHT": inFlight += cents; break;
      case "UNVERIFIED": unverified += cents; break;
    }
    if (it.payout_item_fee) fees += valueToCents(it.payout_item_fee.value);
    else feesUnknown++;
  }
  let cyPresSent = 0;
  for (const c of r.cyPres ?? []) {
    cyPresSent += c.cents;
    if (c.feeCents === null) feesUnknown++;
    else fees += c.feeCents;
  }
  const awaiting = returned + failed + r.allocation.leftoverCents - cyPresSent;
  const held = r.adminReserveCents + r.allocation.reservedFeesCents - fees;
  const sum = paid + unclaimed + inFlight + unverified + awaiting + cyPresSent + fees + held;
  const difference = r.fundCents - sum;

  const warnings: string[] = [];
  if (difference !== 0) warnings.push(`the items do not match the plan: ${difference} cents unexplained`);
  if (awaiting < 0) warnings.push(`cy-près sent ${-awaiting} cents more than was available`);
  if (unverified > 0) warnings.push(`${unverified} cents unverified`);
  if (feesUnknown > 0) warnings.push(`${feesUnknown} fee(s) not reported yet`);
  if (fees > r.allocation.reservedFeesCents) warnings.push(`fees are ${fees - r.allocation.reservedFeesCents} cents above the reserve`);

  return {
    fundCents: r.fundCents, paidCents: paid, unclaimedCents: unclaimed, inFlightCents: inFlight, unverifiedCents: unverified,
    awaitingCyPresCents: awaiting, cyPresSentCents: cyPresSent, feesCents: fees, feesUnknown, heldCents: held, differenceCents: difference, warnings,
  };
}
