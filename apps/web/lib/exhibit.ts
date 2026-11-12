// The landing page's exhibit (design direction "Exhibit A", docs/design-direction.md): one real claim
// from the committed test set, c-114, shown as the evidence it is. Everything on it is read from the
// repo at build time and checked by the real code: the receipt's transcription
// (packages/eval/corpus/claims-v1/receipts.jsonl), what Claude recommended in the committed pilot run
// (packages/eval/results/claims-pilot-2026-11-01-haiku/claims.csv), and the tax rule's own verdict,
// computed here by packages/checks against the cited tax table. Nothing is typed in by hand.
import { readFileSync } from "node:fs";
import path from "node:path";
import { FindingsSchema, US_STATES, type UsState } from "@proofofclaim/claims";
import { checkTax, loadTaxTable, PROVISIONAL_CONFIG } from "@proofofclaim/checks";

const CLAIM = "c-114";
const root = path.resolve(process.cwd(), "../..");

interface ReceiptTruth {
  id: string;
  merchant: string;
  address: string;
  state_printed: string | null;
  date: string;
  lines: { desc: string; qty: number | null; line_total_cents: number; kind: string }[];
  subtotal_cents: number | null;
  tax_cents: number | null;
  total_cents: number | null;
}

export interface Exhibit {
  claimId: string;
  receipt: ReceiptTruth;
  /** What the AI examiner recommended for this claim in the committed pilot run. */
  model: { said: string; confidence: string };
  /** The rule's outcome and reason code in that run. */
  outcome: string;
  reason: string;
  tax: { result: string; detail: string; chargedPct: string; allowedPct: string; scope: string };
}

export function loadExhibit(): Exhibit {
  const manifest = readFileSync(path.join(root, "packages/eval/corpus/claims-v1/manifest.jsonl"), "utf8");
  const claim = manifest.split("\n").filter(Boolean).map((l) => JSON.parse(l) as { id: string; evidence: { receipt: string } | null }).find((c) => c.id === CLAIM);
  if (!claim?.evidence) throw new Error(`${CLAIM} has no receipt in the manifest`);
  const receiptId = claim.evidence.receipt;
  const receipt = readFileSync(path.join(root, "packages/eval/corpus/claims-v1/receipts.jsonl"), "utf8")
    .split("\n").filter(Boolean).map((l) => JSON.parse(l) as ReceiptTruth).find((r) => r.id === receiptId);
  if (!receipt) throw new Error(`receipt ${receiptId} not found`);

  const csv = readFileSync(path.join(root, "packages/eval/results/claims-pilot-2026-11-01-haiku/claims.csv"), "utf8").trim().split("\n");
  const head = (csv[0] ?? "").split(",");
  const row = csv.map((l) => l.split(",")).find((r) => r[0] === CLAIM);
  if (!row) throw new Error(`${CLAIM} not in the pilot results`);
  const col = (name: string) => row[head.indexOf(name)] ?? "";

  const state = receipt.state_printed && (US_STATES as readonly string[]).includes(receipt.state_printed) ? (receipt.state_printed as UsState) : null;
  const findings = FindingsSchema.parse({
    document_type: "receipt", merchant_name: receipt.merchant, merchant_address: receipt.address, merchant_state: state, purchase_date: receipt.date,
    line_items: receipt.lines.map((l) => ({ description: l.desc, qty: l.qty, unit_cents: null, line_total_cents: l.line_total_cents, matches_product_id: null })),
    adjustments: [], subtotal_cents: receipt.subtotal_cents, tax_cents: receipt.tax_cents, total_cents: receipt.total_cents, visual_anomalies: [],
    declaration_consistent_with_evidence: "yes", declaration_issues: [], confidence: "high", model_recommendation: "deny",
  });
  const tax = checkTax(findings, loadTaxTable(path.join(root, "data/tax-rates.json")), PROVISIONAL_CONFIG.taxMarginPct);
  const allowed = /allowed ([\d.]+%)(?: to ([\d.]+%))? for (.+?) on /.exec(tax.detail);
  const charged = receipt.tax_cents !== null && receipt.subtotal_cents ? `${((100 * receipt.tax_cents) / receipt.subtotal_cents).toFixed(1)}%` : "?";
  return {
    claimId: CLAIM, receipt,
    model: { said: col("model_recommendation"), confidence: col("confidence") },
    outcome: col("c_outcome"), reason: col("c_reason"),
    tax: { result: tax.result, detail: tax.detail, chargedPct: charged, allowedPct: allowed?.[2] && allowed[2] !== allowed[1] ? `${allowed[1]}–${allowed[2]}` : (allowed?.[1] ?? "?"), scope: allowed?.[3] ?? "" },
  };
}
