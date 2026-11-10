// One ledger commitment, everything needed to check it without trusting us (plan item P43): the
// commitment, its frozen leaves, the stored root and digest, the drand round (and the beacon and
// sample once recorded), and PayPal's note on each payout as we read it back. No personal data:
// a leaf holds a claim ID, its decision and hashes.
import { getCommitment, paypalNotesOf } from "@proofofclaim/db";
import { pool } from "@/lib/server/data.ts";

export async function GET(_req: Request, ctx: { params: Promise<{ settlement: string; id: string }> }) {
  const { settlement, id } = await ctx.params;
  const n = Number(id);
  const c = Number.isSafeInteger(n) && n > 0 ? await getCommitment(pool(), n) : null;
  if (!c || c.settlementId !== settlement) return new Response("no such ledger commitment", { status: 404 });
  const notes = await paypalNotesOf(pool(), c.id);
  return Response.json(
    {
      id: c.id, settlementId: c.settlementId, kind: c.kind, round: c.round, root: c.root, digest: c.digest, commitment: c.commitment, leaves: c.leaves,
      drandRound: c.drandRound, committedAt: c.committedAt.toISOString(), beacon: c.beacon, sample: c.sample, paypalNotes: notes,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
