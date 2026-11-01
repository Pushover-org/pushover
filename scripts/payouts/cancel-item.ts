// One attempt (no automatic retries) to cancel an UNCLAIMED payout item, then a read-back.
// A cancel returns the money to the fund early; otherwise PayPal returns it after 30 days.
//   node --env-file-if-exists=.env.local scripts/payouts/cancel-item.ts <payout_item_id>
import { cancelPayoutItem, getPayoutItem, limiterFromEnv, paypalClientFromEnv } from "@pushover/paypal";

const [itemId] = process.argv.slice(2);
if (!itemId) throw new Error("usage: cancel-item.ts <payout_item_id>");
const pp = paypalClientFromEnv("guarded", limiterFromEnv(), { maxAttempts: 1 });
const show = (label: string, it: { transaction_status?: string; errors?: { name?: string }; time_processed?: string }) =>
  console.log(label, JSON.stringify({ status: it.transaction_status, error: it.errors?.name, time_processed: it.time_processed }));

console.log(`cancel run at ${new Date().toISOString()} item=${itemId}`);
show("before", await getPayoutItem(pp, itemId));
try {
  show("cancel returned", await cancelPayoutItem(pp, itemId));
} catch (err) {
  const e = err as { name?: string; message?: string; lastError?: { status?: number; debugId?: string; issue?: string } };
  console.log("cancel failed", JSON.stringify({ type: e.name, status: e.lastError?.status, issue: e.lastError?.issue, debug_id: e.lastError?.debugId }));
}
show("after (read back)", await getPayoutItem(pp, itemId));
