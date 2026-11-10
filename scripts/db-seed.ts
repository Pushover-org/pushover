// Loads the demo customers and the PayPal seed manifest (.data/seed, written by scripts/seed.ts)
// into the store database. Safe to re-run: customers upsert, stored captures are skipped.
//   node --env-file-if-exists=.env.local scripts/db-seed.ts
import { existsSync, readFileSync } from "node:fs";
import { countPoolCaptures, createPool, insertPoolOrder, upsertCustomer, type Merchant } from "@proofofclaim/db";
import type { SeededCapture } from "./seed.ts";

/** Demo personas, one per sandbox buyer (spec §3.0). The same IDs exist in both stores. */
const CUSTOMERS = [
  { id: "C-1042", displayName: "Dana Reyes", email: "po-buyer1-3h8w@personal.example.com" },
  { id: "C-2210", displayName: "Marcus Bell", email: "po-buyer2-3h8w@personal.example.com" },
  { id: "C-3175", displayName: "Elena Petrova", email: "po-buyer3-3h8w@personal.example.com" },
  { id: "C-4388", displayName: "Tomás Ruiz", email: "po-buyer4-3h8w@personal.example.com" },
  { id: "C-5521", displayName: "Aisha Khan", email: "po-buyer5-3h8w@personal.example.com" },
  { id: "C-6034", displayName: "Wei Chen", email: "po-buyer6-3h8w@personal.example.com" },
];

const MERCHANT: Record<SeededCapture["merchant"], Merchant> = { guarded: "GUARDED", baseline: "BASELINE" };

const pool = createPool();
try {
  for (const merchant of ["GUARDED", "BASELINE"] as const) {
    for (const c of CUSTOMERS) await upsertCustomer(pool, { merchant, ...c });
  }
  console.log(`customers: ${CUSTOMERS.length} per store`);

  for (const app of ["guarded", "baseline"] as const) {
    const file = `.data/seed/captures-${app}.jsonl`;
    if (!existsSync(file)) {
      console.log(`${file}: missing (run pnpm seed first)`);
      continue;
    }
    let added = 0;
    let skipped = 0;
    for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
      const s = JSON.parse(line) as SeededCapture;
      const inserted = await insertPoolOrder(pool, {
        merchant: MERCHANT[s.merchant], ref: s.ref, paypalOrderId: s.paypal_order_id, items: s.items,
        captureId: s.capture_id, captureStatus: s.capture_status, amountCents: s.amount_cents,
      });
      if (inserted) added++;
      else skipped++;
    }
    console.log(`${app}: ${added} orders added, ${skipped} already present, ${await countPoolCaptures(pool, MERCHANT[app])} in pool`);
  }
} finally {
  await pool.end();
}
