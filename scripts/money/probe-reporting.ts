// node --env-file-if-exists=.env.local scripts/money/probe-reporting.ts [batchId]
// Research for plan items P34, P38 and P39, by asking the sandbox rather than assuming:
//   1. GET /v1/reporting/balances: what the guarded merchant holds before a Distribute.
//   2. GET /v1/payments/payouts/{batch}: the transaction_id PayPal gives each payout item.
//   3. GET /v1/reporting/transactions for the batch's day: whether those transactions show yet,
//      with which event code and status (the history can lag the payout).
//   4. GET /v1/notifications/webhooks-event-types: the payout events a webhook can subscribe to.
// Prints only non-secret fields.
import { getPayoutBatch, limiterFromEnv, paypalClientFromEnv } from "@proofofclaim/paypal";

const pp = paypalClientFromEnv("guarded", limiterFromEnv());
const batchId = process.argv[2] ?? "2HMAKHX862SAE";

const bal = await pp.request<{ balances?: { currency: string; primary?: boolean; total_balance?: { value: string }; available_balance?: { value: string }; withheld_balance?: { value: string } }[]; as_of_time?: string; last_refresh_time?: string }>(
  "GET", "/v1/reporting/balances?currency_code=USD",
);
console.log("1. balances", JSON.stringify({ as_of_time: bal.as_of_time, last_refresh_time: bal.last_refresh_time, balances: bal.balances }));

const batch = await getPayoutBatch(pp, batchId);
const created = batch.batch_header.time_created ?? new Date().toISOString();
const txIds = batch.items.map((i) => (i as { transaction_id?: string }).transaction_id).filter(Boolean) as string[];
console.log("2. batch", batchId, batch.batch_header.batch_status, "created", created, "items", batch.items.length, "with transaction_id:", txIds.length, "e.g.", txIds.slice(0, 2));

const day = new Date(created);
const start = new Date(day.getTime() - 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z");
const end = new Date(Math.min(Date.now(), day.getTime() + 23 * 3_600_000)).toISOString().replace(/\.\d{3}Z$/, "Z");
type Search = { transaction_details?: { transaction_info: Record<string, unknown> }[]; total_items?: number; last_refreshed_datetime?: string };
const search = await pp.request<Search>("GET", `/v1/reporting/transactions?start_date=${start}&end_date=${end}&fields=transaction_info&page_size=100`).catch((err: unknown) => {
  // The history can lag: PayPal answers 404 "Data for the given start date is not available."
  const body = (err as { body?: { message?: string } }).body;
  console.log("3. history", start, "→", end, "NOT AVAILABLE YET:", body?.message ?? String(err));
  return null;
});
if (!search) {
  const types = await pp.request<{ event_types?: { name: string }[] }>("GET", "/v1/notifications/webhooks-event-types");
  console.log("4. payout webhook events:", (types.event_types ?? []).filter((t) => /PAYOUT/.test(t.name)).map((t) => t.name).join(", "));
  process.exit(0);
}
const rows = (search.transaction_details ?? []).map((t) => t.transaction_info);
const ours = rows.filter((r) => txIds.includes(String(r["transaction_id"])) || String(r["paypal_reference_id"] ?? "") === batchId);
console.log("3. history", start, "→", end, "total", search.total_items, "last refreshed", search.last_refreshed_datetime, "matching our batch:", ours.length);
for (const r of (ours.length ? ours : rows).slice(0, 4)) {
  const { transaction_id, paypal_reference_id, paypal_reference_id_type, transaction_event_code, transaction_status, transaction_amount, fee_amount, transaction_initiation_date } = r as Record<string, unknown>;
  console.log("   ", JSON.stringify({ transaction_id, paypal_reference_id, paypal_reference_id_type, transaction_event_code, transaction_status, transaction_amount, fee_amount, transaction_initiation_date }));
}

const types = await pp.request<{ event_types?: { name: string; description?: string }[] }>("GET", "/v1/notifications/webhooks-event-types");
const payoutTypes = (types.event_types ?? []).filter((t) => /PAYOUT/.test(t.name));
console.log("4. payout webhook events:", payoutTypes.map((t) => t.name).join(", "));
