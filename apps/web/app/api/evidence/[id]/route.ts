import { pseudonymOf } from "@proofofclaim/desk";
import { cookies } from "next/headers";
import { currentAnalyst } from "@/lib/server/auth.ts";
import { demoTruth, evidenceOf, identityKeys, pool } from "@/lib/server/data.ts";
import { IDENTITY_COOKIE, openIdentity } from "@/lib/server/paypal-login.ts";

/**
 * A claim's evidence photo. Photos from live claimants are personal data: only a logged-in
 * analyst or the claimant who filed it may see one. The labelled demo corpus (a public receipt
 * dataset and our own renders) is public, so the demo works without a login.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9._-]{1,63}$/.test(id)) return new Response("bad claim id", { status: 400 });
  const doc = new URL(req.url).searchParams.get("doc");
  if (doc !== null && !/^\d{1,18}$/.test(doc)) return new Response("bad document id", { status: 400 });
  if (!(await mayView(id))) return new Response("log in to see this evidence", { status: 401 });
  // ?doc= picks one document of this claim (a requested document, or one sent with an appeal).
  const e = await evidenceOf(id, doc === null ? null : Number(doc));
  if (!e) return new Response("no evidence", { status: 404 });
  return new Response(new Uint8Array(e.bytes), {
    headers: { "Content-Type": e.contentType, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" },
  });
}

async function mayView(claimId: string): Promise<boolean> {
  const { rows } = await pool().query<{ settlement_id: string; pseudonym: string | null }>("SELECT settlement_id, paypal_pseudonym AS pseudonym FROM claims WHERE id = $1", [claimId]);
  const c = rows[0];
  if (!c) return false;
  if (c.pseudonym === null && (await demoTruth()).has(claimId)) return true;
  if (await currentAnalyst()) return true;
  const me = openIdentity((await cookies()).get(IDENTITY_COOKIE)?.value);
  const keys = identityKeys();
  return !!me && !!keys && c.pseudonym === pseudonymOf(keys, c.settlement_id, me.payerId);
}
