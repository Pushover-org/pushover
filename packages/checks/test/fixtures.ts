import { parseSettlement, type Findings, type LineItem } from "@proofofclaim/claims";

export const SETTLEMENT = parseSettlement({
  id: "acme-restaurant-beverage",
  name: "Acme Restaurant Beverage Settlement (fictional demo)",
  demo: true,
  currency: "USD",
  fundCents: 500_000,
  adminReserveCents: 10_000,
  classPeriod: { start: "2015-01-01", end: "2019-12-31" },
  products: [{ id: "restaurant-drink", name: "Non-alcoholic drink", description: "Any non-alcoholic drink bought at a restaurant" }],
  geography: { states: ["CA", "CT", "FL", "MI", "NJ", "NY", "SC", "TX", "WA"] },
  tiers: { proof: { unitCents: 1500, maxUnits: 5 }, noProof: { flatCents: 1000 } },
  cyPres: { name: "Clean Water Access Fund (demo)", payoutEmail: "po-merchant-baseline-3h8w@business.example.com" },
});

export const line = (description: string, line_total_cents: number | null, over: Partial<LineItem> = {}): LineItem => ({
  description, qty: null, unit_cents: null, line_total_cents, matches_product_id: null, ...over,
});
export const drink = (description: string, line_total_cents: number | null, over: Partial<LineItem> = {}): LineItem =>
  line(description, line_total_cents, { matches_product_id: "restaurant-drink", ...over });

/** Receipt 1000 as printed: "1 Coffee 3.00 / 2 Lunch 45.90 / 1 Coke 3.00", Long Beach, 2016. */
export const findings = (over: Partial<Findings> = {}): Findings => ({
  document_type: "receipt",
  merchant_name: "Green Field",
  merchant_address: "5305 E Pacific Coast Hwy, Long Beach, CA 90804",
  merchant_state: "CA",
  purchase_date: "2016-05-26",
  line_items: [drink("Coffee", 300, { qty: 1 }), line("Lunch", 4590, { qty: 2 }), drink("Coke", 300, { qty: 1 })],
  adjustments: [],
  subtotal_cents: 5190,
  tax_cents: 468,
  total_cents: 5658,
  visual_anomalies: [],
  declaration_consistent_with_evidence: "yes",
  declaration_issues: [],
  confidence: "high",
  model_recommendation: "approve",
  ...over,
});
