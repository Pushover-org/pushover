import { logout } from "@proofofclaim/desk";
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE } from "@/lib/server/auth.ts";
import { pool } from "@/lib/server/data.ts";
import { publicOrigin } from "@/lib/server/origin.ts";

/** Ends the session server-side, not just in the browser. */
export async function POST(req: NextRequest) {
  await logout(pool(), req.cookies.get(ADMIN_COOKIE)?.value);
  const res = NextResponse.redirect(new URL("/login?out=1", publicOrigin(req)), 303);
  res.cookies.delete(ADMIN_COOKIE);
  return res;
}
