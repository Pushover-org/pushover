import { NextResponse, type NextRequest } from "next/server";
import { IDENTITY_COOKIE } from "@/lib/server/paypal-login.ts";
import { publicOrigin } from "@/lib/server/origin.ts";

export async function POST(req: NextRequest) {
  const settlement = req.nextUrl.searchParams.get("settlement") ?? "acme-restaurant-beverage";
  // From the confirm page, back to the filing being confirmed (P13).
  const confirm = req.nextUrl.searchParams.get("confirm");
  const to = confirm && /^[A-Za-z0-9_-]{32}$/.test(confirm) ? `/confirm/${confirm}` : `/claim/${encodeURIComponent(settlement)}`;
  const res = NextResponse.redirect(new URL(to, publicOrigin(req)), 303);
  res.cookies.delete(IDENTITY_COOKIE);
  return res;
}
