import { NextResponse, type NextRequest } from "next/server";
import { IDENTITY_COOKIE, identityFromCode, sealIdentity, STATE_COOKIE } from "@/lib/server/paypal-login.ts";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const [state, settlement] = (req.cookies.get(STATE_COOKIE)?.value ?? "").split(":");
  const back = (err?: string) => {
    const url = new URL(`/claim/${settlement || "acme-restaurant-beverage"}`, req.nextUrl.origin);
    if (err) url.searchParams.set("login", err);
    return url;
  };
  // The state must be the one we set, so nobody can log a claimant in as someone else.
  if (!state || q.get("state") !== state) return NextResponse.redirect(back("expired"));
  const code = q.get("code");
  if (!code) return NextResponse.redirect(back(q.get("error") ? "cancelled" : "failed"));
  try {
    const identity = await identityFromCode(code);
    const res = NextResponse.redirect(back());
    const secure = req.nextUrl.protocol === "https:";
    res.cookies.set(IDENTITY_COOKIE, sealIdentity(identity), { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 3600 });
    res.cookies.delete(STATE_COOKIE);
    return res;
  } catch (err) {
    console.error("paypal login failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.redirect(back("failed"));
  }
}
