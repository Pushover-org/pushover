import { NextResponse, type NextRequest } from "next/server";
import { authorizeUrl, newState, returnUrl, STATE_COOKIE } from "@/lib/server/paypal-login.ts";

export async function GET(req: NextRequest) {
  const settlement = req.nextUrl.searchParams.get("settlement") ?? "";
  if (!/^[a-z0-9-]{1,64}$/.test(settlement)) return new NextResponse("bad settlement", { status: 400 });
  const state = newState();
  const res = NextResponse.redirect(authorizeUrl(state, returnUrl(req.nextUrl.origin)));
  res.cookies.set(STATE_COOKIE, `${state}:${settlement}`, { httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:", path: "/", maxAge: 600 });
  return res;
}
