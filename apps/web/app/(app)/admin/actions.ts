"use server";
// A person's review of a claim held for REVIEW. Recorded as a new, append-only decision that
// names the logged-in analyst.
import { ClaimRejectedError, reviewClaim } from "@proofofclaim/desk";
import { revalidatePath } from "next/cache";
import { requireAnalyst } from "@/lib/server/auth.ts";
import { desk } from "@/lib/server/data.ts";

export async function review(settlementId: string, claimId: string, outcome: "APPROVE" | "DENY"): Promise<{ error: string | null }> {
  const analyst = await requireAnalyst(`/admin/${settlementId}/claim/${claimId}`);
  const d = await desk(settlementId);
  if (!d) return { error: "Settlement not found." };
  try {
    await reviewClaim(d, claimId, outcome, analyst.email);
  } catch (err) {
    if (err instanceof ClaimRejectedError) return { error: err.message };
    throw err;
  }
  revalidatePath(`/admin/${settlementId}`);
  revalidatePath(`/admin/${settlementId}/claim/${claimId}`);
  return { error: null };
}
