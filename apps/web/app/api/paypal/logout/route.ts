import { NextResponse, type NextRequest } from "next/server";
import { IDENTITY_COOKIE } from "@/lib/server/paypal-login.ts";

export async function POST(req: NextRequest) {
  const settlement = req.nextUrl.searchParams.get("settlement") ?? "acme-restaurant-beverage";
  const res = NextResponse.redirect(new URL(`/claim/${encodeURIComponent(settlement)}`, req.nextUrl.origin), 303);
  res.cookies.delete(IDENTITY_COOKIE);
  return res;
}
