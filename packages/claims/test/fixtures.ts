import { CHECKS_FOR_TIER, type CheckId, type CheckOutcome, type CheckResult, type Tier } from "../src/checks.ts";
import { parseSettlement } from "../src/settlement.ts";

export const demoSettlement = () =>
  parseSettlement({
    id: "acme-restaurant-coffee",
    name: "Acme Restaurant Coffee Settlement (fictional demo)",
    demo: true,
    currency: "USD",
    fundCents: 500_000,
    adminReserveCents: 10_000,
    classPeriod: { start: "2015-01-01", end: "2019-12-31" },
    products: [{ id: "restaurant-coffee", name: "Coffee or espresso drink", description: "Any coffee or espresso drink bought at a restaurant" }],
    geography: { states: ["CA", "CT", "MI", "NJ", "NY", "SC", "TX"] },
    tiers: { proof: { unitCents: 1500, maxUnits: 5 }, noProof: { flatCents: 1000 } },
    cyPres: { name: "Clean Water Access Fund (demo)", payoutEmail: "po-merchant-baseline-3h8w@business.example.com" },
  });

/** Every applicable check PASS, with optional overrides; `null` drops a check entirely. */
export function checks(tier: Tier, overrides: Partial<Record<CheckId, CheckOutcome | null>> = {}): CheckResult[] {
  return CHECKS_FOR_TIER[tier].flatMap((id) => {
    const o = overrides[id];
    if (o === null) return [];
    return [{ id, result: o ?? "PASS", detail: "" }];
  });
}
