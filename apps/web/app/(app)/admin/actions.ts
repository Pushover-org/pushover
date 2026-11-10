"use server";
// A person's review of a claim held for REVIEW. Recorded as a new, append-only decision.
import { ClaimRejectedError, reviewClaim } from "@proofofclaim/desk";
import { revalidatePath } from "next/cache";
import { desk } from "@/lib/server/data.ts";

export async function review(settlementId: string, claimId: string, outcome: "APPROVE" | "DENY"): Promise<{ error: string | null }> {
  const d = await desk(settlementId);
  if (!d) return { error: "Settlement not found." };
  try {
    // TODO(R12): the analyst's identity comes from the admin login.
    await reviewClaim(d, claimId, outcome, "demo-analyst");
  } catch (err) {
    if (err instanceof ClaimRejectedError) return { error: err.message };
    throw err;
  }
  revalidatePath(`/admin/${settlementId}`);
  revalidatePath(`/admin/${settlementId}/claim/${claimId}`);
  return { error: null };
}
