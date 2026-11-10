"use server";
// Ring detection and the investigator, run by a logged-in analyst. Neither decides anything: a
// group is held for a person, and the investigator's recommendation is only that.
import { detectRings, investigateGroup } from "@proofofclaim/desk";
import { revalidatePath } from "next/cache";
import { requireAnalyst } from "@/lib/server/auth.ts";
import { desk } from "@/lib/server/data.ts";
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
