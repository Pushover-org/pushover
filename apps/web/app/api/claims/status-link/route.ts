import { claimantReturns } from "@proofofclaim/desk";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { desk } from "@/lib/server/data.ts";
import { IDENTITY_COOKIE, openIdentity } from "@/lib/server/paypal-login.ts";
import { publicOrigin } from "@/lib/server/origin.ts";

/**
 * A new private status link for a claimant still logged in with PayPal (the identity cookie lasts
 * an hour). The old link stops working, since only its hash was ever stored.
 */
export async function POST(req: NextRequest) {
  const settlement = req.nextUrl.searchParams.get("settlement") ?? "";
  const back = new URL(`/claim/${encodeURIComponent(settlement)}`, publicOrigin(req));
  const me = openIdentity((await cookies()).get(IDENTITY_COOKIE)?.value);
  const d = /^[a-z0-9-]{1,64}$/.test(settlement) ? await desk(settlement) : null;
  if (!me || !d?.keys) return NextResponse.redirect(back, 303);
  const r = await claimantReturns(d, { payerId: me.payerId, verified: me.verified, emailVerified: me.emailVerified });
  return NextResponse.redirect(r ? new URL(`/status/${r.statusToken}`, publicOrigin(req)) : back, 303);
}
