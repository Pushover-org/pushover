// Checks on what the examiner read: C1, C2, C3, C5, C10, C11, C12. Each is pure. The code
// recomputes everything; a value the model reports is only ever an input.
import { type CheckId, type CheckResult, type Findings, type LineItem, type Settlement } from "@proofofclaim/claims";

const result = (id: CheckId, r: CheckResult["result"], detail: string): CheckResult => ({ id, result: r, detail });

const isRealDate = (d: string) => {
  const t = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
};

export function checkClassPeriod(f: Findings, s: Settlement): CheckResult {
  const d = f.purchase_date;
  if (d === null || !isRealDate(d)) return result("C1", "UNKNOWN", "no readable purchase date");
  const { start, end } = s.classPeriod;
  return d >= start && d <= end
    ? result("C1", "PASS", `${d} is inside ${start} to ${end}`)
    : result("C1", "FAIL", `${d} is outside ${start} to ${end}`);
}

/** Lines that match a real product of this settlement. An ID the model made up counts for nothing. */
function qualifyingLines(f: Findings, s: Settlement): LineItem[] {
  const ids = new Set(s.products.map((p) => p.id));
  return f.line_items.filter((l) => l.matches_product_id !== null && ids.has(l.matches_product_id));
}

export function checkQualifyingProduct(f: Findings, s: Settlement): CheckResult {
  if (f.document_type === "unreadable" || f.document_type === "other") return result("C2", "UNKNOWN", `document type is ${f.document_type}`);
  if (f.line_items.length === 0) return result("C2", "UNKNOWN", "no line items read");
  const hits = qualifyingLines(f, s);
  return hits.length > 0
    ? result("C2", "PASS", `${hits.length} qualifying line(s)`)
    : result("C2", "FAIL", `none of ${f.line_items.length} line(s) match a qualifying product`);
}

const TOLERANCE_CENTS = 1;
const close = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE_CENTS;

const lineTotal = (l: LineItem): number | null => {
  if (l.line_total_cents !== null) return l.line_total_cents;
  return l.unit_cents === null ? null : Math.round((l.qty ?? 1) * l.unit_cents);
};

/**
 * C3. Two sums, each within 1 cent:
 *   lines + adjustments printed above the subtotal = subtotal
 *   subtotal + tax (+ adjustments printed below it, like a tip) = total
 * With no printed subtotal, the lines stand in for it. A line with no price (a modifier) is
 * added as zero: if the sum still matches, nothing is hidden, and if it does not, the unpriced
 * line might explain it, so the answer is UNKNOWN, not FAIL.
 */
export function checkArithmetic(f: Findings): CheckResult {
  const r = (x: CheckResult["result"], d: string) => result("C3", x, d);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const above = sum(f.adjustments.filter((a) => a.applies === "before_subtotal").map((a) => a.cents));
  const below = sum(f.adjustments.filter((a) => a.applies === "after_subtotal").map((a) => a.cents));
  const totals = f.line_items.map(lineTotal);
  const unpriced = totals.filter((t) => t === null).length;
  const lines = sum(totals.map((t) => t ?? 0)) + above;
  const hasLines = f.line_items.length > 0;

  let linesAgree = false;
  if (hasLines && f.subtotal_cents !== null) {
    linesAgree = close(lines, f.subtotal_cents);
    if (!linesAgree && unpriced === 0) return r("FAIL", `lines add to ${lines}c, subtotal says ${f.subtotal_cents}c`);
  }
  const base = f.subtotal_cents ?? (hasLines && unpriced === 0 ? lines : null);
  if (base === null || f.total_cents === null) return r("UNKNOWN", "not enough printed amounts to add up");

  const tax = f.tax_cents ?? 0;
  // Receipts may print a total before the tip, after it, or both, so either is consistent.
  const agrees = close(base + tax, f.total_cents) || close(base + tax + below, f.total_cents);
  if (!agrees) {
    if (f.tax_cents === null) return r("UNKNOWN", `no tax read, and ${base}c does not reach the total ${f.total_cents}c`);
    return r("FAIL", `${base}c + ${tax}c tax${below ? ` + ${below}c after the subtotal` : ""} does not make the total ${f.total_cents}c`);
  }
  if (f.subtotal_cents !== null && !linesAgree) return r("UNKNOWN", hasLines ? `${unpriced} unpriced line(s) leave the subtotal unexplained` : "no line items read");
  return r("PASS", `adds up to ${f.total_cents}c`);
}

const STATE_NAMES: Record<string, string> = {
  AL: "alabama", AK: "alaska", AZ: "arizona", AR: "arkansas", CA: "california", CO: "colorado", CT: "connecticut", DE: "delaware", DC: "district of columbia",
  FL: "florida", GA: "georgia", HI: "hawaii", ID: "idaho", IL: "illinois", IN: "indiana", IA: "iowa", KS: "kansas", KY: "kentucky", LA: "louisiana", ME: "maine",
  MD: "maryland", MA: "massachusetts", MI: "michigan", MN: "minnesota", MS: "mississippi", MO: "missouri", MT: "montana", NE: "nebraska", NV: "nevada",
  NH: "new hampshire", NJ: "new jersey", NM: "new mexico", NY: "new york", NC: "north carolina", ND: "north dakota", OH: "ohio", OK: "oklahoma", OR: "oregon",
  PA: "pennsylvania", RI: "rhode island", SC: "south carolina", SD: "south dakota", TN: "tennessee", TX: "texas", UT: "utah", VT: "vermont", VA: "virginia",
  WA: "washington", WV: "west virginia", WI: "wisconsin", WY: "wyoming",
};

/** Traditional (AP style) abbreviations longer than the code, as printed on real receipts: "Calif", "Tex.". */
const STATE_ABBREVIATIONS: Record<string, string[]> = {
  AL: ["ala"], AZ: ["ariz"], AR: ["ark"], CA: ["calif", "cal"], CO: ["colo"], CT: ["conn"], DE: ["del"], DC: ["d.c."], FL: ["fla"], IL: ["ill"], IN: ["ind"],
  KS: ["kan", "kans"], KY: ["ky."], MA: ["mass"], MI: ["mich"], MN: ["minn"], MS: ["miss"], MT: ["mont"], NE: ["neb", "nebr"], NV: ["nev"], NH: ["n.h."],
  NJ: ["n.j."], NM: ["n.m."], NY: ["n.y."], NC: ["n.c."], ND: ["n.d."], OK: ["okla"], OR: ["ore", "oreg"], RI: ["r.i."], SC: ["s.c."], SD: ["s.d."],
  TN: ["tenn"], TX: ["tex"], WA: ["wash"], WV: ["w.va."], WI: ["wis", "wisc"], WY: ["wyo"],
};
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The state must be printed in the address the examiner read: never inferred from an area code.
 * Accepted: the code in capitals or title case ("TX", "Tx"), the name, or a traditional
 * abbreviation ("Calif", "Tex."). An all-lowercase code is not, because "in", "or" and "me" are
 * ordinary words.
 */
export function stateIsPrinted(state: string, address: string | null): boolean {
  if (!address) return false;
  const title = state.charAt(0) + state.charAt(1).toLowerCase();
  if (new RegExp(`(^|[^A-Za-z])(${state}|${title})([^A-Za-z]|$)`).test(address)) return true;
  const lower = address.toLowerCase();
  const name = STATE_NAMES[state];
  if (name !== undefined && lower.includes(name)) return true;
  return (STATE_ABBREVIATIONS[state] ?? []).some((a) => new RegExp(`(^|[^a-z])${escapeRe(a)}(\\.|[^a-z]|$)`).test(lower));
}

/** C5. A proof claim also needs the store's state, printed on the receipt. */
export function checkGeography(claimantState: string | null, f: Findings | null, s: Settlement, tier: "proof" | "no_proof"): CheckResult {
  const inClass = (st: string) => (s.geography.states as readonly string[]).includes(st);
  if (claimantState === null) return result("C5", "UNKNOWN", "no claimant state");
  if (!inClass(claimantState)) return result("C5", "FAIL", `claimant state ${claimantState} is outside the class`);
  if (tier === "no_proof") return result("C5", "PASS", `claimant state ${claimantState} is in the class`);
  if (f === null || f.merchant_state === null) return result("C5", "UNKNOWN", "no state printed for the store");
  if (!stateIsPrinted(f.merchant_state, f.merchant_address)) return result("C5", "UNKNOWN", `${f.merchant_state} is not printed in the store's address`);
  if (!inClass(f.merchant_state)) return result("C5", "FAIL", `store state ${f.merchant_state} is outside the class`);
  return result("C5", "PASS", `claimant ${claimantState} and store ${f.merchant_state} are in the class`);
}

/** C10. Only an anomaly the examiner is sure of counts. This never denies: it goes to a person. */
export function checkVisualAnomaly(f: Findings): CheckResult {
  const sure = f.visual_anomalies.filter((a) => a.confidence === "high");
  return sure.length > 0
    ? result("C10", "FAIL", `high-confidence anomaly: ${sure.map((a) => a.kind).join(", ")}`)
    : result("C10", "PASS", `${f.visual_anomalies.length} anomalies, none high-confidence`);
}

/** Qualifying units the evidence shows. A line with no printed quantity is one unit. */
export function unitsEvidenced(f: Findings, s: Settlement): number {
  return qualifyingLines(f, s).reduce((n, l) => n + Math.floor(l.qty ?? 1), 0);
}

/** C11. FAIL means "capped", never "denied". */
export function checkUnitsCap(unitsClaimed: number, f: Findings | null, s: Settlement, tier: "proof" | "no_proof"): CheckResult {
  if (tier === "no_proof") {
    return unitsClaimed > 1 ? result("C11", "FAIL", `claimed ${unitsClaimed}, the no-proof tier pays 1`) : result("C11", "PASS", "1 unit");
  }
  if (f === null) return result("C11", "UNKNOWN", "evidence not read");
  const shown = unitsEvidenced(f, s);
  if (shown < 1) return result("C11", "UNKNOWN", "no qualifying units read");
  const cap = Math.min(shown, s.tiers.proof.maxUnits);
  return unitsClaimed > cap ? result("C11", "FAIL", `claimed ${unitsClaimed}, capped at ${cap} (evidence ${shown}, tier ${s.tiers.proof.maxUnits})`) : result("C11", "PASS", `${unitsClaimed} of ${cap}`);
}

export interface ReceiptDetails {
  claimId: string;
  merchant: string | null;
  date: string | null;
  totalCents: number | null;
}

export const normaliseMerchant = (m: string) => m.toLowerCase().replace(/[^a-z0-9]/g, "");

/** C12. Same merchant, date and total as another claim. Rests on what the model read: REVIEW only. */
export function checkRepeatDetails(claimId: string, f: Findings, others: ReceiptDetails[] | null): CheckResult {
  if (others === null) return result("C12", "UNKNOWN", "lookup failed");
  const m = f.merchant_name === null ? "" : normaliseMerchant(f.merchant_name);
  if (m === "" || f.purchase_date === null || f.total_cents === null) return result("C12", "UNKNOWN", "merchant, date or total not read");
  const hits = others.filter((o) => o.claimId !== claimId && o.merchant !== null && normaliseMerchant(o.merchant) === m && o.date === f.purchase_date && o.totalCents === f.total_cents);
  return hits.length > 0 ? result("C12", "FAIL", `same details as claim(s) ${hits.map((h) => h.claimId).join(", ")}`) : result("C12", "PASS", "no other claim shows these details");
}

