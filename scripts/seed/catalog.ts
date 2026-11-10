// Northwind Goods, the demo store (policy text: spec §5.4). Pure: same order ref, same order.
import { centsToValue, type CreatePurchaseUnit } from "@proofofclaim/paypal";

export interface Product {
  sku: string;
  name: string;
  unitCents: number;
}

export const TAX_RATE = 0.08;

export const CATALOG: readonly Product[] = [
  { sku: "MUG-01", name: "Stoneware mug", unitCents: 1800 },
  { sku: "SCARF-01", name: "Merino scarf", unitCents: 8000 },
  { sku: "TEE-01", name: "Organic cotton tee", unitCents: 2400 },
  { sku: "CANDLE-01", name: "Soy candle", unitCents: 1600 },
  { sku: "BOTTLE-01", name: "Steel water bottle", unitCents: 3200 },
  { sku: "SOCKS-01", name: "Wool socks", unitCents: 1400 },
  { sku: "NOTE-01", name: "Linen notebook", unitCents: 1200 },
  { sku: "LAMP-01", name: "Desk lamp", unitCents: 5400 },
  { sku: "TOTE-01", name: "Canvas tote", unitCents: 2200 },
];

/** $287.00 + 8% = $309.96: the "my $310 jacket" order above the human threshold (spec §2.5 scene C). */
export const JACKET: Product = { sku: "JACKET-01", name: "Waxed jacket", unitCents: 28700 };

export interface StoreItem {
  sku: string;
  name: string;
  qty: number;
  unitCents: number;
  /** Per unit, as PayPal's items[].tax is ("The item tax for each unit"). */
  taxCents: number;
}

export interface StoreOrder {
  ref: string;
  items: StoreItem[];
  itemTotalCents: number;
  taxTotalCents: number;
  totalCents: number;
}

/** Normal orders land in this range (spec §5.6.1 S-basic: $30–$120). */
export const NORMAL_MIN_CENTS = 3000;
export const NORMAL_MAX_CENTS = 12000;

export function taxFor(unitCents: number): number {
  return Math.round(unitCents * TAX_RATE);
}

function prng(seedText: string): () => number {
  let h = 2166136261;
  for (const ch of seedText) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let s = h >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function line(p: Product, qty: number): StoreItem {
  return { sku: p.sku, name: p.name, qty, unitCents: p.unitCents, taxCents: taxFor(p.unitCents) };
}

function totals(ref: string, items: StoreItem[]): StoreOrder {
  const itemTotalCents = items.reduce((s, i) => s + i.qty * i.unitCents, 0);
  const taxTotalCents = items.reduce((s, i) => s + i.qty * i.taxCents, 0);
  return { ref, items, itemTotalCents, taxTotalCents, totalCents: itemTotalCents + taxTotalCents };
}

/** Deterministic: the contents depend only on the ref, so a re-sent create is byte-identical. */
export function orderFor(ref: string, opts: { big?: boolean } = {}): StoreOrder {
  if (opts.big) return totals(ref, [line(JACKET, 1)]);
  const rand = prng(ref);
  for (;;) {
    const pool = [...CATALOG];
    const lines: StoreItem[] = [];
    const n = 1 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      const [p] = pool.splice(Math.floor(rand() * pool.length), 1);
      if (p) lines.push(line(p, rand() < 0.25 ? 2 : 1));
    }
    const o = totals(ref, lines);
    if (o.totalCents >= NORMAL_MIN_CENTS && o.totalCents <= NORMAL_MAX_CENTS) return o;
  }
}

const usd = (cents: number) => ({ currency_code: "USD", value: centsToValue(cents) });

export function toPurchaseUnit(o: StoreOrder): CreatePurchaseUnit {
  return {
    reference_id: o.ref,
    description: "Northwind Goods order",
    amount: { ...usd(o.totalCents), breakdown: { item_total: usd(o.itemTotalCents), tax_total: usd(o.taxTotalCents) } },
    items: o.items.map((i) => ({ name: i.name, sku: i.sku, quantity: String(i.qty), unit_amount: usd(i.unitCents), tax: usd(i.taxCents) })),
  };
}
