// The referee: what each claim should get, worked out from what the evidence truly shows
// (receipts.jsonl) and the rules as written in docs/architecture.md. It is a second, separate
// implementation of decision table v1 and its checks. It must never import claims, checks,
// distribute or examiner (ESLint), so a mistake in either one shows up as a disagreement.
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Claim, ReceiptTruth } from "../corpus/schema.ts";

/** The rules' settings as written (docs/architecture.md → Corrections; PROVISIONAL_CONFIG). */
export const RULES = {
  hashCaughtVariants: ["recompress", "half_size", "rot90", "rot180", "rot270"],
  taxMarginUnits: 20_000, // 2 percentage points, in 0.0001% units
  templateMinOthers: 3,
  velocityMaxClaims: 5,
  velocityHours: 24,
} as const;

export const OracleSettlementSchema = z.object({
  fundCents: z.int(),
  classPeriod: z.object({ start: z.iso.date(), end: z.iso.date() }),
  geography: z.object({ states: z.array(z.string()) }),
  tiers: z.object({ proof: z.object({ unitCents: z.int(), maxUnits: z.int() }), noProof: z.object({ flatCents: z.int() }) }),
});
export type OracleSettlement = z.infer<typeof OracleSettlementSchema>;

const TaxSchema = z.object({
  state_rows: z.array(z.object({ state: z.string(), from: z.string(), to: z.string(), min_pct: z.number(), max_pct: z.number() })),
  city_rows: z.array(z.object({ state: z.string(), city: z.string(), from: z.string(), to: z.string(), rate_pct: z.number() })),
});
export type OracleTaxTable = z.infer<typeof TaxSchema>;

export function readTaxTable(path: string | URL): OracleTaxTable {
  return TaxSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

type Outcome = "PASS" | "FAIL" | "UNKNOWN";
export interface Expected {
  outcome: "APPROVE" | "DENY" | "NEED_MORE" | "REVIEW";
  reason: string;
  entitlement_cents: number;
}

const DENY_REASON = {
  C1: "OUT_OF_PERIOD", C2: "NO_QUALIFYING_PRODUCT", C3: "ARITHMETIC_MISMATCH", C4: "TAX_IMPLAUSIBLE",
  C5: "OUT_OF_GEOGRAPHY", C6: "DUPLICATE_IMAGE", C8: "DUPLICATE_IDENTITY",
} as const;
const CLAIMANT_CAN_FIX = new Set(["C1", "C2", "C3", "C5"]);
const PROOF_CHECKS = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10", "C11", "C12"];
const NO_PROOF_CHECKS = ["C5", "C7", "C8", "C9", "C11"];

const drinkUnits = (r: ReceiptTruth) => r.lines.filter((l) => l.kind === "nonalcoholic_drink").reduce((n, l) => n + Math.floor(l.qty ?? 1), 0);

export function c3(r: ReceiptTruth): Outcome {
  const near = (a: number, b: number) => Math.abs(a - b) <= 1;
  let lineSum = 0;
  let unpriced = 0;
  for (const l of r.lines) {
    if (l.line_total_cents === null) unpriced++;
    else lineSum += l.line_total_cents;
  }
  for (const a of r.adjustments) if (a.position === "before_subtotal") lineSum += a.cents;
  const after = r.adjustments.filter((a) => a.position === "after_subtotal").reduce((s, a) => s + a.cents, 0);
  let linesOk = false;
  if (r.lines.length > 0 && r.subtotal_cents !== null) {
    linesOk = near(lineSum, r.subtotal_cents);
    if (!linesOk && unpriced === 0) return "FAIL";
  }
  let base: number | null = r.subtotal_cents;
  if (base === null && r.lines.length > 0 && unpriced === 0) base = lineSum;
  if (base === null || r.total_cents === null) return "UNKNOWN";
  const tax = r.tax_cents ?? 0;
  if (!near(base + tax, r.total_cents) && !near(base + tax + after, r.total_cents)) return r.tax_cents === null ? "UNKNOWN" : "FAIL";
  if (r.subtotal_cents !== null && !linesOk) return "UNKNOWN";
  return "PASS";
}

export function c4(r: ReceiptTruth, tax: OracleTaxTable): Outcome {
  let base = r.subtotal_cents;
  if (base === null && r.lines.length > 0 && r.lines.every((l) => l.line_total_cents !== null)) base = r.lines.reduce((s, l) => s + (l.line_total_cents ?? 0), 0);
  const taxCents = r.tax_cents;
  if (taxCents === null || base === null || base <= 0 || r.state_printed === null || r.date === null) return "UNKNOWN";
  const b = base;
  const d = r.date;
  const st = r.state_printed;
  const addr = (r.address ?? "").toLowerCase();
  const cities = tax.city_rows.filter((c) => c.state === st && c.from <= d && d <= c.to && new RegExp(`(^|[^a-z])${c.city.toLowerCase().replace(/[^a-z ]/g, "")}([^a-z]|$)`).test(addr));
  cities.sort((a, b) => b.city.length - a.city.length);
  let lo: number;
  let hi: number;
  const city = cities[0];
  if (city) {
    lo = hi = Math.round(city.rate_pct * 10_000);
  } else {
    const row = tax.state_rows.find((s) => s.state === st && s.from <= d && d <= s.to);
    if (!row) return "UNKNOWN";
    lo = Math.round(row.min_pct * 10_000);
    hi = Math.round(row.max_pct * 10_000);
  }
  // Tax that rate would give on this base, with a cent each way for per-line rounding.
  const within = (lowRate: number, highRate: number) => taxCents >= Math.floor((b * lowRate) / 1_000_000) - 1 && taxCents <= Math.ceil((b * highRate) / 1_000_000) + 1;
  if (within(lo, hi)) return "PASS";
  if (taxCents === 0) return "UNKNOWN";
  if (within(Math.max(0, lo - RULES.taxMarginUnits), hi + RULES.taxMarginUnits)) return "UNKNOWN";
  return "FAIL";
}

const network48 = (ip: string) => ip.toLowerCase().split(":").slice(0, 3).join(":");
const sameEmail = (a: string, b: string) => {
  const n = (e: string) => {
    const [l = "", d = ""] = e.trim().toLowerCase().split("@");
    return `${l.split("+")[0]}@${d}`;
  };
  return n(a) === n(b);
};
const sameAddress = (a: Claim["claimant"], b: Claim["claimant"]) =>
  a.zip === b.zip && a.address_line.toLowerCase().replace(/[^a-z0-9]/g, "") === b.address_line.toLowerCase().replace(/[^a-z0-9]/g, "");
const sameNameZip = (a: Claim["claimant"], b: Claim["claimant"]) => {
  const n = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter(Boolean).sort().join(" ");
  return a.zip === b.zip && n(a.name) === n(b.name);
};

/**
 * Expected decision for every claim, in filing order. A claim's C8 depends on what earlier
 * claims were expected to get: an approved match denies, a match still open goes to a person.
 */
export function expectedDecisions(claims: Claim[], receipts: Map<string, ReceiptTruth>, s: OracleSettlement, tax: OracleTaxTable): Map<string, Expected> {
  const ordered = [...claims].sort((a, b) => a.seq - b.seq);
  const out = new Map<string, Expected>();
  const clusterSize = new Map<string, number>();
  for (const c of claims) if (c.cluster) clusterSize.set(c.cluster, (clusterSize.get(c.cluster) ?? 0) + 1);
  const inClass = (st: string) => s.geography.states.includes(st);

  for (const c of ordered) {
    const r = c.evidence ? receipts.get(c.evidence.receipt) : undefined;
    if (c.evidence && !r) throw new Error(`${c.id}: no truth for receipt ${c.evidence.receipt}`);
    const proof = c.tier === "proof";
    const res: Record<string, Outcome> = {};

    if (proof && r) {
      res["C1"] = r.date === null ? "UNKNOWN" : r.date >= s.classPeriod.start && r.date <= s.classPeriod.end ? "PASS" : "FAIL";
      res["C2"] = r.lines.length === 0 ? "UNKNOWN" : drinkUnits(r) > 0 ? "PASS" : "FAIL";
      res["C3"] = c3(r);
      res["C4"] = c4(r, tax);
      res["C10"] = r.edited ? "FAIL" : "PASS";
      const earlier = ordered.filter((o) => o.seq < c.seq && o.evidence);
      const dupe = c.duplicate_of !== null && c.evidence?.variant !== null && (RULES.hashCaughtVariants as readonly string[]).includes(c.evidence?.variant ?? "");
      res["C6"] = dupe ? "FAIL" : "PASS";
      const repeat = earlier.some((o) => {
        const t = o.evidence ? receipts.get(o.evidence.receipt) : undefined;
        if (!t) return false;
        return t.merchant !== null && r.merchant !== null && t.merchant.toLowerCase().replace(/[^a-z0-9]/g, "") === r.merchant.toLowerCase().replace(/[^a-z0-9]/g, "") && t.date === r.date && t.total_cents === r.total_cents;
      });
      res["C12"] = r.merchant === null || r.date === null || r.total_cents === null ? "UNKNOWN" : repeat ? "FAIL" : "PASS";
    }

    const st = c.claimant.state;
    if (!inClass(st)) res["C5"] = "FAIL";
    else if (!proof) res["C5"] = "PASS";
    else if (!r || r.state_printed === null) res["C5"] = "UNKNOWN";
    else res["C5"] = inClass(r.state_printed) ? "PASS" : "FAIL";

    const size = c.cluster ? (clusterSize.get(c.cluster) ?? 1) : 1;
    res["C7"] = size - 1 >= RULES.templateMinOthers ? "FAIL" : "PASS";

    let c8: Outcome = "PASS";
    for (const o of ordered) {
      if (o.seq >= c.seq) break;
      const prior = out.get(o.id);
      if (!prior) throw new Error(`${o.id} was not decided before ${c.id}`);
      if (prior.outcome === "DENY") continue;
      if (!(sameEmail(c.claimant.email, o.claimant.email) || sameAddress(c.claimant, o.claimant) || sameNameZip(c.claimant, o.claimant))) continue;
      if (prior.outcome === "APPROVE") {
        c8 = "FAIL";
        break;
      }
      c8 = "UNKNOWN";
    }
    res["C8"] = c8;

    const net = network48(c.network.ip);
    const width = RULES.velocityHours * 3_600_000;
    const at = Date.parse(c.network.at);
    const times = claims.filter((o) => network48(o.network.ip) === net).map((o) => Date.parse(o.network.at));
    let busiest = 0;
    for (const start of times) {
      if (start > at || start + width < at) continue;
      busiest = Math.max(busiest, times.filter((t) => t >= start && t <= start + width).length);
    }
    res["C9"] = busiest > RULES.velocityMaxClaims ? "FAIL" : "PASS";

    const units = proof && r ? drinkUnits(r) : 1;
    const cap = Math.min(units, s.tiers.proof.maxUnits);
    res["C11"] = proof ? (units < 1 ? "UNKNOWN" : c.units_claimed > cap ? "FAIL" : "PASS") : c.units_claimed > 1 ? "FAIL" : "PASS";

    out.set(c.id, decideOnTruth(c, r, res, s, units));
  }
  return out;
}

function decideOnTruth(c: Claim, r: ReceiptTruth | undefined, res: Record<string, Outcome>, s: OracleSettlement, units: number): Expected {
  const proof = c.tier === "proof";
  const applicable = proof ? PROOF_CHECKS : NO_PROOF_CHECKS;
  const zero = (outcome: Expected["outcome"], reason: string): Expected => ({ outcome, reason, entitlement_cents: 0 });
  const is = (id: string, o: Outcome) => applicable.includes(id) && res[id] === o;

  // A careful reader is unsure of an illegible receipt, and an unsure reading never denies.
  if (proof && r && !r.legible) return zero("REVIEW", "LOW_CONFIDENCE");
  for (const id of proof ? (["C1", "C2", "C3", "C4", "C5"] as const) : (["C5"] as const)) if (is(id, "FAIL")) return zero("DENY", DENY_REASON[id]);
  for (const id of proof ? (["C6", "C8"] as const) : (["C8"] as const)) if (is(id, "FAIL")) return zero("DENY", DENY_REASON[id]);
  if (is("C7", "FAIL")) return zero("REVIEW", "TEMPLATE_CLUSTER");
  if (is("C9", "FAIL")) return zero("REVIEW", "VELOCITY_CLUSTER");
  if (proof && is("C12", "FAIL")) return zero("REVIEW", "REPEAT_RECEIPT_DETAILS");
  if (proof && is("C10", "FAIL")) return zero("REVIEW", "VISUAL_ANOMALY");
  for (const id of applicable) if (CLAIMANT_CAN_FIX.has(id) && res[id] === "UNKNOWN") return zero("NEED_MORE", "NEED_DOCUMENT");
  for (const id of applicable) if (res[id] === "UNKNOWN") return zero("REVIEW", id === "C4" ? "TAX_UNCONFIRMED" : "CHECK_UNVERIFIED");
  if (!proof) return { outcome: "APPROVE", reason: "APPROVED_NO_PROOF", entitlement_cents: s.tiers.noProof.flatCents };
  const paid = Math.min(c.units_claimed, units, s.tiers.proof.maxUnits);
  return { outcome: "APPROVE", reason: "APPROVED_PROOF", entitlement_cents: paid * s.tiers.proof.unitCents };
}
