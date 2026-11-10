// A claimant's reasons in plain words (plan item C3): for each check that failed or couldn't tell,
// what it found on *their own* receipt, and what they can do about it. Built only from their claim,
// their receipt and the settlement's terms; the checks' internal details name other claims and are
// never shown to a claimant.
import type { CheckId, Findings } from "@proofofclaim/claims";
import type { MessageKey } from "./i18n.ts";
import { US_STATE_NAMES } from "./states.ts";

export interface PlainReason {
  id: CheckId;
  result: "FAIL" | "UNKNOWN";
  why: MessageKey;
  fix: MessageKey | null;
  params: Record<string, string>;
}

interface Input {
  outcome: string | null;
  tier: "proof" | "no_proof";
  unitsClaimed: number;
  claimantState: string;
  checks: { id: CheckId; result: "PASS" | "FAIL" | "UNKNOWN" }[];
  findings: Findings | null;
  settlement: { classPeriod: { start: string; end: string }; geography: { states: readonly string[] }; products: readonly { name: string }[] };
  /** Whether the claimant can appeal or send a document now: a fix only points at a form that's there. */
  canAppeal: boolean;
  canSendDocument: boolean;
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const stateName = (code: string | null | undefined) => (code ? (US_STATE_NAMES[code] ?? code) : "");

/** The checks a claimant gets an explanation for: what decided it, and anything else that failed. */
export function plainReasons(c: Input): PlainReason[] {
  const f = c.findings;
  const appeal = (k: MessageKey): MessageKey | null => (c.canAppeal ? k : null);
  const states = c.settlement.geography.states.map(stateName).join(", ");
  const out: PlainReason[] = [];
  for (const k of c.checks) {
    if (k.result === "PASS") continue;
    // "Couldn't tell" matters to a claimant only while it is what holds the claim up.
    if (k.result === "UNKNOWN" && c.outcome !== "NEED_MORE" && c.outcome !== "REVIEW") continue;
    const fail = k.result === "FAIL";
    const r = (why: MessageKey, fix: MessageKey | null, params: Record<string, string> = {}): PlainReason => ({ id: k.id, result: k.result as "FAIL" | "UNKNOWN", why, fix, params });
    const doc: MessageKey | null = c.outcome === "NEED_MORE" && c.canSendDocument ? "fix.document" : null;
    switch (k.id) {
      case "C1":
        out.push(fail ? r("why.C1.FAIL", appeal("fix.misread"), { date: f?.purchase_date ?? "", start: c.settlement.classPeriod.start, end: c.settlement.classPeriod.end }) : r("why.C1.UNKNOWN", doc));
        break;
      case "C2": {
        const product = c.settlement.products.map((p) => p.name).join(", ");
        out.push(fail ? r("why.C2.FAIL", appeal("fix.misread"), { product }) : r("why.C2.UNKNOWN", doc, { product }));
        break;
      }
      case "C3":
        out.push(fail ? r("why.C3.FAIL", appeal("fix.misread")) : r("why.C3.UNKNOWN", doc));
        break;
      case "C4":
        out.push(
          fail
            ? r("why.C4.FAIL", appeal("fix.misread"), { tax: f?.tax_cents != null ? usd(f.tax_cents) : "", state: stateName(f?.merchant_state), date: f?.purchase_date ?? "" })
            : r("why.C4.UNKNOWN", "fix.person", { state: stateName(f?.merchant_state) }),
        );
        break;
      case "C5": {
        const claimantOut = !c.settlement.geography.states.includes(c.claimantState);
        out.push(
          fail
            ? r(claimantOut ? "why.C5.FAIL.claimant" : "why.C5.FAIL.store", appeal("fix.misread"), { states, state: stateName(claimantOut ? c.claimantState : f?.merchant_state) })
            : r("why.C5.UNKNOWN", doc),
        );
        break;
      }
      case "C6":
        out.push(fail ? r("why.C6.FAIL", appeal("fix.ownPhoto")) : r("why.C6.UNKNOWN", "fix.person"));
        break;
      case "C7":
        out.push(fail ? r("why.C7.FAIL", appeal("fix.ownWords")) : r("why.cross.UNKNOWN", "fix.person"));
        break;
      case "C8":
        out.push(fail ? r("why.C8.FAIL", appeal("fix.household")) : r("why.C8.UNKNOWN", "fix.person"));
        break;
      case "C9":
        out.push(fail ? r("why.C9.FAIL", appeal("fix.network")) : r("why.cross.UNKNOWN", "fix.person"));
        break;
      case "C10":
        if (fail) out.push(r("why.C10.FAIL", appeal("fix.original")));
        break;
      case "C11":
        if (fail) out.push(c.tier === "no_proof" ? r("why.C11.FAIL.flat", null) : r("why.C11.FAIL", null, { claimed: String(c.unitsClaimed) }));
        break;
      case "C12":
        out.push(fail ? r("why.C12.FAIL", appeal("fix.together")) : r("why.cross.UNKNOWN", "fix.person"));
        break;
    }
  }
  return out;
}
