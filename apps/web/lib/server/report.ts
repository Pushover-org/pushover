// The public court report: every claim's decision, reason and amount, with personal data masked
// (spec §4.7). Nothing here identifies a claimant: initials, state, and the claim ID only.
import { REASONS, type ReasonCode } from "@proofofclaim/claims";
import { initials } from "../labels.ts";
import { claimViews, type ClaimView } from "./data.ts";

export interface ReportRow {
  claim: string;
  filed: string;
  claimant: string;
  state: string;
  tier: string;
  decision: string;
  reason: string;
  reasonText: string;
  decidedBy: string;
  rule: number | null;
  amountCents: number | null;
  payout: string;
}

const PAYOUT: Record<string, string> = { SCHEDULED: "scheduled", PAID: "paid", UNCLAIMED: "unclaimed", RETURNED: "returned", FAILED: "failed", CY_PRES_ELIGIBLE: "to charity", UNVERIFIED: "unconfirmed" };

export async function reportRows(settlementId: string): Promise<ReportRow[]> {
  const views: ClaimView[] = await claimViews(settlementId);
  return views.map((v) => ({
    claim: v.id, filed: v.submittedAt.slice(0, 10), claimant: initials(v.name), state: v.state, tier: v.tier === "proof" ? "receipt" : "no receipt",
    decision: v.outcome ?? "PENDING", reason: v.reason ?? "", reasonText: v.reason && v.reason in REASONS ? REASONS[v.reason as ReasonCode] : "",
    decidedBy: v.decidedBy?.startsWith("analyst:") ? "analyst" : v.decidedBy ? "rules" : "", rule: v.rule,
    amountCents: v.outcome === "APPROVE" || PAYOUT[v.status] ? v.entitlementCents : null, payout: PAYOUT[v.status] ?? "",
  }));
}

const cell = (v: string | number | null) => {
  const s = v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows: ReportRow[]): string {
  const head = ["claim", "filed", "claimant", "state", "tier", "decision", "reason", "reason_text", "decided_by", "rule", "amount_usd", "payout"];
  const body = rows.map((r) => [r.claim, r.filed, r.claimant, r.state, r.tier, r.decision, r.reason, r.reasonText, r.decidedBy, r.rule, r.amountCents === null ? "" : (r.amountCents / 100).toFixed(2), r.payout].map(cell).join(","));
  return `${head.join(",")}\n${body.join("\n")}\n`;
}
