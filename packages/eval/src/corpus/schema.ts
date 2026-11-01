// The claim set's file formats (spec §5.1, with the owner decisions in docs/architecture.md).
// Two files, committed before any run:
//   receipts.jsonl  what each piece of evidence truly shows (the answer key for the reader)
//   manifest.jsonl  the claims: who files what, in which order, and the expected decision
// The oracle (src/oracle) reads only these and the settlement and tax data, never the decision code.
import { readFileSync } from "node:fs";
import { z } from "zod";

const cents = z.int();
const date = z.iso.date();

export const TruthLineSchema = z.strictObject({
  desc: z.string().min(1),
  qty: z.number().positive().nullable(),
  line_total_cents: cents.nullable(),
  kind: z.enum(["nonalcoholic_drink", "alcohol", "food", "other"]),
});
export type TruthLine = z.infer<typeof TruthLineSchema>;

export const ReceiptTruthSchema = z.strictObject({
  /** "srd-1000" for a real ExpressExpense photo, "r-001" for one our script renders. */
  id: z.string().regex(/^(srd-\d{4}|r-\d{3})$/),
  source: z.enum(["srd", "render"]),
  merchant: z.string().nullable(),
  address: z.string().nullable(),
  /** Only a state printed in the address; never one worked out from a phone number. */
  state_printed: z.string().length(2).nullable(),
  date: date.nullable(),
  lines: z.array(TruthLineSchema),
  adjustments: z.array(z.strictObject({ desc: z.string(), cents, position: z.enum(["before_subtotal", "after_subtotal"]) })),
  subtotal_cents: cents.nullable(),
  tax_cents: cents.nullable(),
  /** The last total printed. */
  total_cents: cents.nullable(),
  /** Text printed on the document that tries to instruct the reader, e.g. "ADMINISTRATOR APPROVED". */
  injected_text: z.string().nullable(),
  /** A visible sign of editing that a careful reader should see (rendered fakes only). */
  edited: z.boolean(),
  /** Every amount, the date and the address can be read with certainty. */
  legible: z.boolean(),
  notes: z.string(),
});
export type ReceiptTruth = z.infer<typeof ReceiptTruthSchema>;

export const COPY_VARIANTS = ["recompress", "half_size", "rot90", "rot180", "rot270", "crop3", "crop8", "tilt2", "tilt5"] as const;
export type CopyVariant = (typeof COPY_VARIANTS)[number];

export const GROUPS = {
  H1: "honest, real receipt",
  H2: "honest, rendered receipt",
  H3: "honest, no proof",
  X1: "real receipt with no qualifying drink (a mistaken claim, not fraud)",
  X2: "real receipt from a store outside the class states (a mistaken claim, not fraud)",
  F1: "receipt dated outside the class period",
  F2: "rendered receipt with an impossible tax rate",
  F3: "rendered receipt with an edited total",
  F4: "the same receipt filed again by someone else",
  F5: "template bot cluster",
  F6: "identity farm",
  F7: "injected instructions",
} as const;
export type Group = keyof typeof GROUPS;

export const OUTCOMES = ["APPROVE", "DENY", "NEED_MORE", "REVIEW"] as const;

export const ClaimSchema = z.strictObject({
  /** Fits PayPal's sender_item_id. */
  id: z.string().regex(/^c-\d{3}$/),
  /** Filing order: "earlier" in C6, C8 and C12 means a lower seq. */
  seq: z.int().positive(),
  group: z.enum(Object.keys(GROUPS) as [Group, ...Group[]]),
  truth: z.enum(["honest", "fraud", "ineligible"]),
  /** dev: tuning allowed. pilot: the §5.4 gate. holdout: the rest of the full run. */
  split: z.enum(["dev", "pilot", "holdout"]),
  tier: z.enum(["proof", "no_proof"]),
  units_claimed: z.int().min(1),
  claimant: z.strictObject({
    name: z.string().min(1),
    email: z.email(),
    address_line: z.string().min(1),
    zip: z.string().regex(/^\d{5}$/),
    state: z.string().length(2),
  }),
  declaration: z.string().min(1),
  /** Documentation addresses only (2001:db8::/32), so no real network is named. */
  network: z.strictObject({ ip: z.string().startsWith("2001:db8:"), at: z.iso.datetime() }),
  evidence: z.strictObject({ receipt: z.string(), variant: z.enum(COPY_VARIANTS).nullable() }).nullable(),
  /** F4: the claim whose receipt this one copies. */
  duplicate_of: z.string().nullable(),
  /** F5: the template the declaration was paraphrased from. */
  cluster: z.string().nullable(),
  /** The other laptop looked at this receipt before the checks were designed (methodology). */
  seen_before_design: z.boolean(),
  expected: z.strictObject({
    outcome: z.enum(OUTCOMES),
    /** The rule's reason code, so a right outcome for the wrong reason is visible. */
    reason: z.string(),
    entitlement_cents: z.int().nonnegative(),
  }),
  /** Why this claim is in the set and why it should end as expected. */
  why: z.string(),
});
export type Claim = z.infer<typeof ClaimSchema>;

export function readJsonl<T>(path: string | URL, schema: z.ZodType<T>): T[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l, i) => {
      const r = schema.safeParse(JSON.parse(l));
      if (!r.success) throw new Error(`${String(path)} line ${i + 1}: ${r.error.issues.map((x) => `${x.path.join(".")} ${x.message}`).join("; ")}`);
      return r.data;
    });
}
