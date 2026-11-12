import { NextResponse, type NextRequest } from "next/server";
import { authorizeUrl, newState, returnUrl, STATE_COOKIE } from "@/lib/server/paypal-login.ts";
import { publicOrigin } from "@/lib/server/origin.ts";

export async function GET(req: NextRequest) {
  const settlement = req.nextUrl.searchParams.get("settlement") ?? "";
  if (!/^[a-z0-9-]{1,64}$/.test(settlement)) return new NextResponse("bad settlement", { status: 400 });
  // From the confirm page (P13): come back to the filing the person is confirming, not the claim form.
  const confirm = req.nextUrl.searchParams.get("confirm") ?? "";
  if (confirm && !/^[A-Za-z0-9_-]{32}$/.test(confirm)) return new NextResponse("bad confirm link", { status: 400 });
  const state = newState();
  const res = NextResponse.redirect(authorizeUrl(state, returnUrl(publicOrigin(req))));
  res.cookies.set(STATE_COOKIE, confirm ? `${state}:${settlement}:${confirm}` : `${state}:${settlement}`, { httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:", path: "/", maxAge: 600 });
  return res;
}
