// Pro-rata allocation (spec §4.5). Integer cents only. Entitlement × fund can pass what a
// JavaScript number holds exactly, so the sums run in BigInt.

export interface Entitlement {
  claimId: string;
  entitlementCents: number;
}

export interface AllocationInput {
  fundCents: number;
  adminReserveCents: number;
  /** Fee reserved per claim. Sandbox: $0.25 flat at $1, $15, $75 and $250. Actual fees come from PayPal. */
  feePerItemCents: number;
  entitlements: Entitlement[];
}

export interface Allocation {
  netFundCents: number;
  reservedFeesCents: number;
  /** One entry per claim, in claim ID order. A payout of 0 means the share rounded to nothing. */
  payouts: { claimId: string; entitlementCents: number; payoutCents: number }[];
  /** Money left after payouts: a cy-près candidate. Zero when the fund is scaled down. */
  leftoverCents: number;
  scaled: boolean;
}

const assertCents = (name: string, n: number, min = 0) => {
  if (!Number.isSafeInteger(n) || n < min) throw new Error(`${name} must be a whole number of cents >= ${min}, got ${n}`);
};

/**
 * Invariant: Σ payouts + leftover = net fund, exactly. No payout is negative or above its
 * entitlement. The result does not depend on the order of the input.
 */
export function allocate(a: AllocationInput): Allocation {
  assertCents("fundCents", a.fundCents, 1);
  assertCents("adminReserveCents", a.adminReserveCents);
  assertCents("feePerItemCents", a.feePerItemCents);
  const seen = new Set<string>();
  for (const e of a.entitlements) {
    assertCents(`entitlement of ${e.claimId}`, e.entitlementCents, 1);
    if (seen.has(e.claimId)) throw new Error(`claim ${e.claimId} appears twice`);
    seen.add(e.claimId);
  }
  const sorted = [...a.entitlements].sort((x, y) => (x.claimId < y.claimId ? -1 : x.claimId > y.claimId ? 1 : 0));
  const reservedFeesCents = a.feePerItemCents * sorted.length;
  const netFundCents = a.fundCents - a.adminReserveCents - reservedFeesCents;
  if (netFundCents < 0) throw new Error(`fund cannot cover the reserve and fees: ${netFundCents} cents short of zero`);

  const total = sorted.reduce((s, e) => s + BigInt(e.entitlementCents), 0n);
  const net = BigInt(netFundCents);
  if (total <= net) {
    return {
      netFundCents, reservedFeesCents, scaled: false,
      payouts: sorted.map((e) => ({ claimId: e.claimId, entitlementCents: e.entitlementCents, payoutCents: e.entitlementCents })),
      leftoverCents: netFundCents - Number(total),
    };
  }

  // Scale down, round down, then hand out the leftover cents by largest remainder.
  const shares = sorted.map((e, i) => {
    const product = BigInt(e.entitlementCents) * net;
    return { i, floor: product / total, remainder: product % total };
  });
  let spare = net - shares.reduce((s, x) => s + x.floor, 0n);
  const byRemainder = [...shares].sort((x, y) => (x.remainder > y.remainder ? -1 : x.remainder < y.remainder ? 1 : x.i - y.i));
  const payout = shares.map((s) => s.floor);
  for (const s of byRemainder) {
    if (spare === 0n) break;
    payout[s.i] = (payout[s.i] as bigint) + 1n;
    spare -= 1n;
  }
  return {
    netFundCents, reservedFeesCents, scaled: true, leftoverCents: 0,
    payouts: sorted.map((e, i) => ({ claimId: e.claimId, entitlementCents: e.entitlementCents, payoutCents: Number(payout[i]) })),
  };
}
