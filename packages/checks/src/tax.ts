// The cited tax table (data/tax-rates.json) and C4. Rates are held as integers, in units of
// 0.0001%, so 8.875% is 88750 and no float touches a comparison of money.
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { CheckResult, Findings } from "@proofofclaim/claims";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const pct = z.number().min(0).max(25);
const url = z.url({ protocol: /^https$/ });

export const TaxTableSchema = z.object({
  version: z.string(),
  state_rows: z.array(z.strictObject({ state: z.string().length(2), from: date, to: date, min_pct: pct, max_pct: pct, source_url: url, note: z.string() })),
  city_rows: z.array(z.strictObject({ state: z.string().length(2), city: z.string().min(2), from: date, to: date, rate_pct: pct, source_url: url })),
});
export type TaxTable = z.infer<typeof TaxTableSchema>;

export function loadTaxTable(path: string | URL = new URL("../../../data/tax-rates.json", import.meta.url)): TaxTable {
  return TaxTableSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

const units = (p: number) => Math.round(p * 10_000);
const asPct = (u: number) => `${u / 10_000}%`;

export interface TaxRange {
  min: number;
  max: number;
  scope: string;
  source: string;
}

/** The exact rate if a row names the city in the address, otherwise the state's range. */
export function rangeFor(table: TaxTable, state: string, date: string, address: string | null): TaxRange | null {
  const inForce = <T extends { state: string; from: string; to: string }>(r: T) => r.state === state && r.from <= date && date <= r.to;
  const where = (address ?? "").toLowerCase();
  const city = table.city_rows
    .filter(inForce)
    .filter((r) => new RegExp(`(^|[^a-z])${r.city.toLowerCase().replace(/[^a-z ]/g, "")}([^a-z]|$)`).test(where))
    .sort((a, b) => b.city.length - a.city.length)[0];
  if (city) return { min: units(city.rate_pct), max: units(city.rate_pct), scope: `${city.city}, ${state}`, source: city.source_url };
  const row = table.state_rows.find(inForce);
  return row ? { min: units(row.min_pct), max: units(row.max_pct), scope: state, source: row.source_url } : null;
}

const taxBase = (f: Findings): number | null => {
  if (f.subtotal_cents !== null) return f.subtotal_cents;
  if (f.line_items.length === 0 || f.line_items.some((l) => l.line_total_cents === null)) return null;
  return f.line_items.reduce((s, l) => s + (l.line_total_cents ?? 0), 0);
};

/**
 * C4. Inside the range → PASS. Outside it by no more than the margin → UNKNOWN (a person looks):
 * real shops overcharge. Further outside → FAIL. Zero tax → UNKNOWN: some sales are exempt, such
 * as hot coffee sold to go in California. One cent of rounding is always allowed, because many
 * tills tax each line separately.
 */
export function checkTax(f: Findings, table: TaxTable, marginPct: number): CheckResult {
  const r = (result: CheckResult["result"], detail: string): CheckResult => ({ id: "C4", result, detail });
  const base = taxBase(f);
  if (f.tax_cents === null || base === null || base <= 0) return r("UNKNOWN", "tax or subtotal not read");
  if (f.merchant_state === null || f.purchase_date === null) return r("UNKNOWN", "store's state or purchase date not read");
  const range = rangeFor(table, f.merchant_state, f.purchase_date, f.merchant_address);
  if (!range) return r("UNKNOWN", `no cited rate for ${f.merchant_state} on ${f.purchase_date}`);
  const margin = units(marginPct);
  const low = (rate: number) => Math.floor((base * rate) / 1_000_000) - 1;
  const high = (rate: number) => Math.ceil((base * rate) / 1_000_000) + 1;
  const seen = `${f.tax_cents}c on ${base}c, allowed ${asPct(range.min)} to ${asPct(range.max)} for ${range.scope} on ${f.purchase_date}`;
  if (f.tax_cents >= low(range.min) && f.tax_cents <= high(range.max)) return r("PASS", seen);
  if (f.tax_cents === 0) return r("UNKNOWN", `no tax charged, which may be an exempt sale: ${seen}`);
  if (f.tax_cents >= low(Math.max(0, range.min - margin)) && f.tax_cents <= high(range.max + margin)) return r("UNKNOWN", `outside the rate by less than the margin: ${seen}`);
  return r("FAIL", `outside the rate: ${seen}`);
}
