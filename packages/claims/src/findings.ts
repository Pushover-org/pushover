// What the examiner reports about a claim's evidence (spec §4.2, with the corrections in
// docs/architecture.md → Corrections to spec §4.2–§4.5). Findings are facts read from the
// image, never a decision. packages/examiner produces them; packages/checks reads them.
import { z } from "zod";
import { US_STATES } from "./settlement.ts";

const cents = z.int();
const nonNegCents = z.int().nonnegative();
const confidence = z.enum(["high", "medium", "low"]);

export const AnomalySchema = z.strictObject({
  kind: z.enum(["font_mismatch", "pasted_region", "misaligned_columns", "impossible_layout", "other"]),
  where: z.string(),
  box: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
  /** Per anomaly: C10 fails only on an anomaly the examiner is sure of. */
  confidence,
});

const LineItemSchema = z.strictObject({
  description: z.string(),
  /** Null when no quantity is printed. Receipts usually print one only above 1. */
  qty: z.number().positive().nullable(),
  /** Null when not printed: "2 Lunch 45.90" prints a line total, not a unit price. */
  unit_cents: cents.nullable(),
  /** As printed. Null when the line shows no price, like a modifier. */
  line_total_cents: cents.nullable(),
  /** A product ID from the settlement, or null. */
  matches_product_id: z.string().nullable(),
});
export type LineItem = z.infer<typeof LineItemSchema>;

/** A printed discount, fee or tip. Discounts are negative. */
const AdjustmentSchema = z.strictObject({
  kind: z.enum(["discount", "fee", "tip", "other"]),
  description: z.string(),
  cents,
  /** Whether it is printed above the subtotal line (in the subtotal) or below it (added after). */
  applies: z.enum(["before_subtotal", "after_subtotal"]),
});

export const FindingsSchema = z.strictObject({
  document_type: z.enum(["receipt", "order_confirmation", "product_photo", "other", "unreadable"]),
  merchant_name: z.string().nullable(),
  merchant_address: z.string().nullable(),
  merchant_state: z.enum(US_STATES).nullable(),
  purchase_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  line_items: z.array(LineItemSchema),
  adjustments: z.array(AdjustmentSchema),
  subtotal_cents: nonNegCents.nullable(),
  tax_cents: nonNegCents.nullable(),
  total_cents: nonNegCents.nullable(),
  visual_anomalies: z.array(AnomalySchema),
  declaration_consistent_with_evidence: z.enum(["yes", "no", "unclear"]),
  declaration_issues: z.array(z.string()),
  confidence,
  /** Logged only. No check or decision reads it; eval arm B and the worst case do (spec §4.2). */
  model_recommendation: z.enum(["approve", "deny"]),
});
export type Findings = z.infer<typeof FindingsSchema>;
