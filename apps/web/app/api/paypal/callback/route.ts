import { claimantReturns } from "@proofofclaim/desk";
import { NextResponse, type NextRequest } from "next/server";
import { desk } from "@/lib/server/data.ts";
import { IDENTITY_COOKIE, identityFromCode, sealIdentity, STATE_COOKIE } from "@/lib/server/paypal-login.ts";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const [state, settlement, confirm] = (req.cookies.get(STATE_COOKIE)?.value ?? "").split(":");
  const confirming = !!confirm && /^[A-Za-z0-9_-]{32}$/.test(confirm);
  const back = (err?: string) => {
    const url = new URL(confirming ? `/confirm/${confirm}` : `/claim/${settlement || "acme-restaurant-beverage"}`, req.nextUrl.origin);
    if (err) url.searchParams.set("login", err);
    return url;
  };
  // The state must be the one we set, so nobody can log a claimant in as someone else.
  if (!state || q.get("state") !== state) return NextResponse.redirect(back("expired"));
  const code = q.get("code");
  if (!code) return NextResponse.redirect(back(q.get("error") ? "cancelled" : "failed"));
  try {
    const identity = await identityFromCode(code);
    // Already filed here? Record what PayPal says about verification now (an approved claim from
    // an unverified account waits for it) and go straight to a fresh private status link.
    // Someone confirming an assistant's filing goes back to it, whatever else they filed.
    const d = settlement && !confirming ? await desk(settlement) : null;
    const returning = d?.keys ? await claimantReturns(d, { payerId: identity.payerId, verified: identity.verified, emailVerified: identity.emailVerified }) : null;
    const res = NextResponse.redirect(returning ? new URL(`/status/${returning.statusToken}`, req.nextUrl.origin) : back());
    const secure = req.nextUrl.protocol === "https:";
    res.cookies.set(IDENTITY_COOKIE, sealIdentity(identity), { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 3600 });
    res.cookies.delete(STATE_COOKIE);
    return res;
  } catch (err) {
    console.error("paypal login failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.redirect(back("failed"));
  }
}
