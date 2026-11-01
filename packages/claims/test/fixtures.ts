import { CHECKS_FOR_TIER, type CheckId, type CheckOutcome, type CheckResult, type Tier } from "../src/checks.ts";
import { parseSettlement } from "../src/settlement.ts";

export const demoSettlement = () =>
  parseSettlement({
    id: "acme-hydrobottle",
    name: "Acme HydroBottle Settlement (fictional demo)",
    demo: true,
    currency: "USD",
    fundCents: 500_000,
    adminReserveCents: 10_000,
    classPeriod: { start: "2026-01-01", end: "2026-09-30" },
    products: [{ id: "insulated-bottle-24oz", name: "24-oz insulated bottle", description: "Any 24-oz insulated water bottle" }],
    geography: { states: ["CA", "NY", "TX", "WA"] },
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
