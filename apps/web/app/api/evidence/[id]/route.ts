import { cookies } from "next/headers";
import { currentAnalyst } from "@/lib/server/auth.ts";
import { demoTruth, evidenceOf, pool } from "@/lib/server/data.ts";
import { IDENTITY_COOKIE, openIdentity } from "@/lib/server/paypal-login.ts";

/**
 * A claim's evidence photo. Photos from live claimants are personal data: only a logged-in
 * analyst or the claimant who filed it may see one. The labelled demo corpus (a public receipt
 * dataset and our own renders) is public, so the demo works without a login.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9._-]{1,63}$/.test(id)) return new Response("bad claim id", { status: 400 });
  if (!(await mayView(id))) return new Response("log in to see this evidence", { status: 401 });
  const e = await evidenceOf(id);
  if (!e) return new Response("no evidence", { status: 404 });
  return new Response(new Uint8Array(e.bytes), {
    headers: { "Content-Type": e.contentType, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" },
  });
}

async function mayView(claimId: string): Promise<boolean> {
  if ((await demoTruth()).has(claimId)) {
    const { rows } = await pool().query<{ live: boolean }>("SELECT paypal_payer_id IS NOT NULL AS live FROM claims WHERE id = $1", [claimId]);
    if (rows[0] && !rows[0].live) return true;
  }
  if (await currentAnalyst()) return true;
  const me = openIdentity((await cookies()).get(IDENTITY_COOKIE)?.value);
  if (!me) return false;
  const { rows } = await pool().query<{ payer: string | null }>("SELECT paypal_payer_id AS payer FROM claims WHERE id = $1", [claimId]);
  return rows[0]?.payer === me.payerId;
}
