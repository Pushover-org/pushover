"use server";
// Ring detection and the investigator, run by a logged-in analyst. Neither decides anything: a
// group is held for a person, and the investigator's recommendation is only that.
import { latestInvestigation, listGroups } from "@proofofclaim/db";
import { decideGroup, detectRings, GroupDecisionError, investigateGroup } from "@proofofclaim/desk";
import { revalidatePath } from "next/cache";
import { requireAnalyst } from "@/lib/server/auth.ts";
import { desk, pool } from "@/lib/server/data.ts";
import { investigatorDeps, replay } from "@/lib/server/investigator.ts";

export async function detectNow(settlementId: string): Promise<{ error: string | null; message: string | null }> {
  await requireAnalyst(`/admin/${settlementId}/groups`);
  const d = await desk(settlementId);
  if (!d) return { error: "Settlement not found.", message: null };
  const groups = await detectRings(d);
  revalidatePath(`/admin/${settlementId}/groups`);
  return { error: null, message: `${groups.length} group${groups.length === 1 ? "" : "s"} found among the claims.` };
}

export async function investigateNow(settlementId: string, groupId: number): Promise<{ error: string | null; message: string | null }> {
  await requireAnalyst(`/admin/${settlementId}/groups/${groupId}`);
  const d = await desk(settlementId);
  if (!d) return { error: "Settlement not found.", message: null };
  const r = await investigateGroup(d, groupId, investigatorDeps(), replay());
  revalidatePath(`/admin/${settlementId}/groups/${groupId}`);
  revalidatePath(`/admin/${settlementId}/groups`);
  return { error: null, message: r.status === "OK" || r.status === "REPLAYED" ? "The investigator answered." : `No usable answer (${r.status.toLowerCase().replace("_", " ")}).` };
}

/** A person clears or denies one held group (plan item P22). */
export async function decideGroupNow(settlementId: string, groupId: number, decision: "CLEARED" | "DENIED"): Promise<{ error: string | null; message: string | null }> {
  const analyst = await requireAnalyst(`/admin/${settlementId}/groups/${groupId}`);
  const d = await desk(settlementId);
  if (!d) return { error: "Settlement not found.", message: null };
  try {
    const r = await decideGroup(d, groupId, decision, analyst.email);
    revalidatePath(`/admin/${settlementId}/groups/${groupId}`);
    revalidatePath(`/admin/${settlementId}/groups`);
    revalidatePath(`/admin/${settlementId}`);
    return {
      error: null,
      message: decision === "CLEARED" ? "Group cleared: each claim stands on its own checks."
        : `Denied ${r.denied.length} claim${r.denied.length === 1 ? "" : "s"}${r.alreadyDenied.length ? `; ${r.alreadyDenied.length} already denied` : ""}${r.untouched.length ? `; ${r.untouched.length} already in a payout, left alone` : ""}.`,
    };
  } catch (err) {
    if (err instanceof GroupDecisionError) return { error: err.message, message: null };
    throw err;
  }
}

/**
 * Every held group whose latest investigation recommends `follow` (P22's bulk decisions). Still a
 * person's click: the person confirms, and each group and claim is recorded as their decision.
 */
export async function bulkDecideNow(settlementId: string, follow: "CLEAR" | "DENY_GROUP"): Promise<{ error: string | null; message: string | null }> {
  const analyst = await requireAnalyst(`/admin/${settlementId}/groups`);
  const d = await desk(settlementId);
  if (!d) return { error: "Settlement not found.", message: null };
  let groups = 0;
  let claims = 0;
  for (const g of await listGroups(pool(), settlementId, { activeOnly: true })) {
    if (g.status !== "HELD" || (await latestInvestigation(pool(), g.id))?.recommendation !== follow) continue;
    const r = await decideGroup(d, g.id, follow === "CLEAR" ? "CLEARED" : "DENIED", analyst.email);
    groups++;
    claims += r.denied.length;
  }
  revalidatePath(`/admin/${settlementId}/groups`);
  revalidatePath(`/admin/${settlementId}`);
  return { error: null, message: follow === "CLEAR" ? `Cleared ${groups} group${groups === 1 ? "" : "s"}.` : `Denied ${groups} group${groups === 1 ? "" : "s"} (${claims} claims).` };
}

