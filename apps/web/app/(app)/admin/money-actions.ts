"use server";
// Distribute and read back. Code alone calls PayPal; the model is not involved anywhere here.
import { distribute, planDistribution, readBack, recheckApproved } from "@proofofclaim/desk";
import { limiterFromEnv, paypalClientFromEnv } from "@proofofclaim/paypal";
import { revalidatePath } from "next/cache";
import { desk } from "@/lib/server/data.ts";
import { DEMO_DAILY_CAP_CENTS, money } from "@/lib/server/money.ts";

export interface ActionResult {
  error: string | null;
  message: string | null;
}

export async function distributeNow(settlementId: string): Promise<ActionResult> {
  const d = await desk(settlementId);
  if (!d) return { error: "Settlement not found.", message: null };
  const m = await money(settlementId, d.settlement.fundCents);
  const room = DEMO_DAILY_CAP_CENTS - m.sentLast24hCents;
  if (room < 100) return { error: `The demo's sandbox limit of $${DEMO_DAILY_CAP_CENTS / 100} a day is used up. Try again tomorrow.`, message: null };
  const moved = await recheckApproved(d);
  const plan = await planDistribution(d, { capCents: room });
  if (plan.payees.length === 0) return { error: "No approved claims are waiting to be paid.", message: null };
  // TODO(R12): the analyst's identity comes from the admin login.
  const out = await distribute(d, paypalClientFromEnv("guarded", limiterFromEnv()), plan, "analyst:demo-analyst");
  revalidatePath(`/admin/${settlementId}/money`);
  revalidatePath(`/admin/${settlementId}`);
  const sent = out.batches.map((b) => `${b.paypalBatchId} (${b.items} payments, ${b.status})`).join(", ");
  return { error: null, message: `Round ${out.round} sent: ${sent}.${moved.length ? ` The re-check pulled ${moved.length} claim${moved.length === 1 ? "" : "s"} back first.` : ""}` };
}

export async function readBackNow(settlementId: string, batchId: number): Promise<ActionResult> {
  const d = await desk(settlementId);
  if (!d) return { error: "Settlement not found.", message: null };
  const r = await readBack(d, paypalClientFromEnv("guarded", limiterFromEnv()), batchId);
  revalidatePath(`/admin/${settlementId}/money`);
  return { error: null, message: `Batch ${r.status}: ${Object.entries(r.outcomes).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(", ") || "no items"}.` };
}
