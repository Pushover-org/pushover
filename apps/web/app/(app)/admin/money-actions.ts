"use server";
// Money leaves the fund in two steps by two people: an analyst proposes the exact round, and a
// different supervisor approves and sends it. Code alone calls PayPal; the model is not involved.
import { approveAndDistribute, cancelProposal, MoneyRefusedError, proposeDistribution, readBack } from "@proofofclaim/desk";
import { limiterFromEnv, paypalClientFromEnv } from "@proofofclaim/paypal";
import { revalidatePath } from "next/cache";
import { requireAnalyst } from "@/lib/server/auth.ts";
import { desk } from "@/lib/server/data.ts";
import { DEMO_DAILY_CAP_CENTS, money } from "@/lib/server/money.ts";

export interface ActionResult {
  error: string | null;
  message: string | null;
}

const refused = (err: unknown): ActionResult => {
  if (err instanceof MoneyRefusedError) return { error: err.message, message: null };
  throw err;
};

/** Sandbox money the demo may still send today; every round pays from at most this much. */
async function roomToday(settlementId: string, fundCents: number): Promise<number> {
  const m = await money(settlementId, fundCents);
  return DEMO_DAILY_CAP_CENTS - m.sentLast24hCents;
}

export async function proposeNow(settlementId: string): Promise<ActionResult> {
  const analyst = await requireAnalyst(`/admin/${settlementId}/money`);
  const d = await desk(settlementId);
  if (!d) return { error: "Settlement not found.", message: null };
  const room = await roomToday(settlementId, d.settlement.fundCents);
  if (room < 100) return { error: `The demo's sandbox limit of $${DEMO_DAILY_CAP_CENTS / 100} a day is used up. Try again tomorrow.`, message: null };
  try {
    const { proposal, moved } = await proposeDistribution(d, analyst, { capCents: room });
    revalidatePath(`/admin/${settlementId}/money`);
    revalidatePath(`/admin/${settlementId}`);
    const pulled = moved.length ? ` The re-check pulled ${moved.length} claim${moved.length === 1 ? "" : "s"} back first.` : "";
    return { error: null, message: `Proposal ${proposal.id} recorded. A supervisor other than you approves it before anything is sent.${pulled}` };
  } catch (err) {
    return refused(err);
  }
}

export async function approveNow(settlementId: string, proposalId: number): Promise<ActionResult> {
  const analyst = await requireAnalyst(`/admin/${settlementId}/money`);
  const d = await desk(settlementId);
  if (!d) return { error: "Settlement not found.", message: null };
  try {
    const room = await roomToday(settlementId, d.settlement.fundCents);
    const out = await approveAndDistribute(d, paypalClientFromEnv("guarded", limiterFromEnv()), analyst, proposalId, { capCents: room });
    revalidatePath(`/admin/${settlementId}/money`);
    revalidatePath(`/admin/${settlementId}`);
    return { error: null, message: `Round ${out.round} sent: ${out.batches.map((b) => `${b.paypalBatchId} (${b.items} payments, ${b.status})`).join(", ")}.` };
  } catch (err) {
    revalidatePath(`/admin/${settlementId}/money`);
    return refused(err);
  }
}

export async function cancelNow(settlementId: string, proposalId: number): Promise<ActionResult> {
  const analyst = await requireAnalyst(`/admin/${settlementId}/money`);
  const d = await desk(settlementId);
  if (!d) return { error: "Settlement not found.", message: null };
  try {
    await cancelProposal(d, analyst, proposalId);
    revalidatePath(`/admin/${settlementId}/money`);
    return { error: null, message: "Proposal withdrawn. Nothing was sent." };
  } catch (err) {
    return refused(err);
  }
}

export async function readBackNow(settlementId: string, batchId: number): Promise<ActionResult> {
  await requireAnalyst(`/admin/${settlementId}/money`);
  const d = await desk(settlementId);
  if (!d) return { error: "Settlement not found.", message: null };
  const r = await readBack(d, paypalClientFromEnv("guarded", limiterFromEnv()), batchId);
  revalidatePath(`/admin/${settlementId}/money`);
  return { error: null, message: `Batch ${r.status}: ${Object.entries(r.outcomes).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(", ") || "no items"}.` };
}
