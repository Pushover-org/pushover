// What a perfect reader would report for a receipt: its truth, in the examiner's findings shape.
// Used to test the pipeline against the oracle with reading errors taken out, and as the
// reference that real readings are scored against.
import { FindingsSchema, US_STATES, type Findings, type UsState } from "@proofofclaim/claims";
import type { ReceiptTruth } from "./schema.ts";

const PRODUCT_ID = "restaurant-drink";

export function perfectFindings(r: ReceiptTruth): Findings {
  const state = r.state_printed !== null && (US_STATES as readonly string[]).includes(r.state_printed) ? (r.state_printed as UsState) : null;
  return FindingsSchema.parse({
    document_type: "receipt",
    merchant_name: r.merchant,
    merchant_address: r.address,
    merchant_state: state,
    purchase_date: r.date,
    line_items: r.lines.map((l) => ({
      description: l.desc, qty: l.qty, unit_cents: null, line_total_cents: l.line_total_cents,
      matches_product_id: l.kind === "nonalcoholic_drink" ? PRODUCT_ID : null,
    })),
    adjustments: r.adjustments.map((a) => ({
      kind: /tip|gratuity/i.test(a.desc) ? "tip" : a.cents < 0 ? "discount" : "fee", description: a.desc, cents: a.cents, applies: a.position,
    })),
    subtotal_cents: r.subtotal_cents,
    tax_cents: r.tax_cents,
    total_cents: r.total_cents,
    visual_anomalies: r.edited ? [{ kind: "pasted_region", where: "the total", box: null, confidence: "high" }] : [],
    declaration_consistent_with_evidence: "yes",
    declaration_issues: r.injected_text ? [`printed text tries to instruct the reader: ${r.injected_text.replace(/\n/g, " ")}`] : [],
    confidence: r.legible ? "high" : "low",
    model_recommendation: "deny",
  });
}
