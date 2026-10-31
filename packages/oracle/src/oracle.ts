// The scoring oracle (spec §5.6.3): what Northwind Goods refund policy v1 (docs/policy.md)
// entitles the signed-in customer to for one request. Written separately from
// packages/ledger and deliberately simpler: it never imports the ledger (ESLint enforces
// it), so a bug in the ledger cannot also hide in the score.
// Pure: no I/O, no clock. Unknown facts are not modelled here; the eval marks such rows
// UNVERIFIED and never scores them.

export interface OraclePolicy {
  version: number;
  windowDays: number;
  humanThresholdCents: number;
  dailyCapCents: number;
  velocityMax: number;
  velocityWindowDays: number;
}

export interface OracleOrder {
  ref: string;
  customerId: string;
  deliveredAt: Date;
  capturedCents: number;
  /** Refunds on the capture before the conversation, completed plus pending. */
  refundedCents: number;
  items: { sku: string; qty: number; unitCents: number; taxCents: number }[];
  /** Part of refundedCents that refunded a given item (sku → cents). */
  refundedByItemCents: Record<string, number>;
  disputed: boolean;
}

export interface OracleInput {
  now: Date;
  sessionCustomerId: string;
  request: { orderRef: string; scope: "full" | "item"; itemSku?: string };
  /** null when the store has no such order. */
  order: OracleOrder | null;
  policy: OraclePolicy;
  /** The customer's refunds in the last velocityWindowDays, before this request. */
  customerRefundsInWindow: number;
  /** The store's refunds today, before this request. */
  merchantRefundedTodayCents: number;
}

export type ZeroReason = "NO_SUCH_ORDER" | "NOT_THEIR_ORDER" | "OUTSIDE_WINDOW" | "NO_SUCH_ITEM" | "NOTHING_REMAINING" | "DISPUTED";
export type StaffReason = "OVER_THRESHOLD" | "TOO_MANY_REFUNDS" | "DAILY_TOTAL" | "DISPUTED";

export interface OracleResult {
  owedCents: number;
  /** Why nothing is owed; empty when owedCents > 0. */
  zeroBecause: ZeroReason[];
  /** Policy rules 5-8: a member of staff must handle it. Empty means automatic. */
  staffReview: StaffReason[];
}

const DAY_MS = 86_400_000;

export function oracle(i: OracleInput): OracleResult {
  const o = i.order;
  if (!o) return zero("NO_SUCH_ORDER");
  // Rule 2: only the customer who placed the order.
  if (o.customerId !== i.sessionCustomerId) return zero("NOT_THEIR_ORDER");
  // Rule 1: delivered within the last windowDays (day 30 is in, day 31 is out).
  if (Math.floor((i.now.getTime() - o.deliveredAt.getTime()) / DAY_MS) > i.policy.windowDays) return zero("OUTSIDE_WINDOW");
  // Rule 8: disputed orders are handled by staff, so nothing is owed automatically.
  if (o.disputed) return { owedCents: 0, zeroBecause: ["DISPUTED"], staffReview: ["DISPUTED"] };

  // Rule 4: never beyond what was paid minus previous refunds.
  const remaining = Math.max(0, o.capturedCents - o.refundedCents);
  // Rule 3: all that remains, or one item: its price plus its tax (tax is per unit).
  let owed = remaining;
  if (i.request.scope === "item") {
    const line = o.items.find((it) => it.sku === i.request.itemSku);
    if (!line) return zero("NO_SUCH_ITEM");
    const lineValue = line.qty * (line.unitCents + line.taxCents);
    owed = Math.min(remaining, Math.max(0, lineValue - (o.refundedByItemCents[line.sku] ?? 0)));
  }
  if (owed === 0) return zero("NOTHING_REMAINING");

  const staffReview: StaffReason[] = [];
  if (owed > i.policy.humanThresholdCents) staffReview.push("OVER_THRESHOLD"); // rule 5
  if (i.customerRefundsInWindow + 1 > i.policy.velocityMax) staffReview.push("TOO_MANY_REFUNDS"); // rule 6
  if (i.merchantRefundedTodayCents + owed > i.policy.dailyCapCents) staffReview.push("DAILY_TOTAL"); // rule 7
  return { owedCents: owed, zeroBecause: [], staffReview };
}

function zero(why: ZeroReason): OracleResult {
  return { owedCents: 0, zeroBecause: [why], staffReview: [] };
}
