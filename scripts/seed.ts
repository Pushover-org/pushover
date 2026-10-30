// Seed captured orders for the demo store (spec §3.6, Path A: sandbox card, proven by D1-3).
// Until packages/db exists (§9 step 5) results go to .data/seed/captures-<merchant>.jsonl.
//
//   node --env-file-if-exists=.env.local scripts/seed.ts [--merchant guarded|baseline|both] [--count 20]
//
// Resumable and safe to re-run: refs continue from the manifest, every order's contents
// derive from its ref, and the create key is "seed-<merchant>-<ref>", so a re-sent create
// returns the original order (PayPal keeps keys for 6 hours) instead of charging again.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createOrder, limiterFromEnv, paypalClientFromEnv, valueToCents, type PayPalApp } from "@pushover/paypal";
import { orderFor, toPurchaseUnit, type StoreItem } from "./seed/catalog.ts";
import { sandboxCard } from "./day1/common.ts";

/** One big ($310) order in every BIG_EVERY, for the human-threshold scenario. */
const BIG_EVERY = 10;
const FIRST_REF: Record<PayPalApp, number> = { guarded: 10001, baseline: 20001 };
const OUT_DIR = ".data/seed";

export interface SeededCapture {
  merchant: PayPalApp;
  ref: string;
  paypal_order_id: string;
  capture_id: string;
  capture_status: string;
  amount_cents: number;
  items: StoreItem[];
  created_at: string;
}

const { values } = parseArgs({
  options: { merchant: { type: "string", default: "both" }, count: { type: "string", default: "20" } },
});
const merchants: PayPalApp[] =
  values.merchant === "both" ? ["guarded", "baseline"] : values.merchant === "guarded" || values.merchant === "baseline" ? [values.merchant] : [];
const count = Number(values.count);
if (merchants.length === 0 || !Number.isInteger(count) || count < 1) {
  console.error("usage: seed.ts [--merchant guarded|baseline|both] [--count N]");
  process.exit(2);
}

mkdirSync(OUT_DIR, { recursive: true });
const limiter = limiterFromEnv(); // one budget for both merchants: same IP
const card = sandboxCard();
let failures = 0;

for (const merchant of merchants) {
  const file = `${OUT_DIR}/captures-${merchant}.jsonl`;
  const existing: SeededCapture[] = existsSync(file)
    ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as SeededCapture)
    : [];
  const client = paypalClientFromEnv(merchant, limiter);
  let next = existing.reduce((m, c) => Math.max(m, Number(c.ref.slice(3)) + 1), FIRST_REF[merchant]);
  console.log(`${merchant}: ${existing.length} already seeded, adding ${count} from PO-${next}`);

  for (let i = 0; i < count; i++, next++) {
    const ref = `PO-${next}`;
    const order = orderFor(ref, { big: (next - FIRST_REF[merchant]) % BIG_EVERY === BIG_EVERY - 1 });
    try {
      const res = await createOrder(client, { requestId: `seed-${merchant}-${ref}`, card, purchaseUnits: [toPurchaseUnit(order)] });
      const cap = res.purchase_units?.[0]?.payments?.captures?.[0];
      const captured = cap?.amount ? valueToCents(cap.amount.value) : undefined;
      if (res.status !== "COMPLETED" || !cap || cap.status !== "COMPLETED" || captured !== order.totalCents) {
        failures++;
        console.log(`${merchant} ${ref}: NOT CAPTURED as expected`, JSON.stringify({ order: res.id, status: res.status, capture: cap?.id, capture_status: cap?.status, captured, expected: order.totalCents }));
        continue;
      }
      const row: SeededCapture = {
        merchant, ref, paypal_order_id: res.id, capture_id: cap.id, capture_status: cap.status,
        amount_cents: captured, items: order.items, created_at: new Date().toISOString(),
      };
      appendFileSync(file, JSON.stringify(row) + "\n");
      console.log(`${merchant} ${ref}: ${res.id} capture ${cap.id} $${(captured / 100).toFixed(2)} (${order.items.map((it) => `${it.qty}x${it.sku}`).join(", ")})`);
    } catch (err) {
      failures++;
      console.log(`${merchant} ${ref}: error ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
console.log(failures === 0 ? "seed OK" : `seed finished with ${failures} failure(s)`);
process.exitCode = failures === 0 ? 0 : 1;
