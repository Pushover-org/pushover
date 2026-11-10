// A claimant asks for a payment that came back to be sent again (plan item C4). The private
// status link is the claimant's key, as on the status page.
import { claimByStatusToken, ClaimRejectedError, requestReoffer } from "@proofofclaim/desk";
import { NextResponse, type NextRequest } from "next/server";
import { claimView, desk, pool } from "@/lib/server/data.ts";

export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const id = await claimByStatusToken({ pool: pool() }, token);
  const c = id ? await claimView(id) : null;
  const d = c ? await desk(c.settlementId) : null;
  if (!id || !d) return new Response("not found", { status: 404 });
  const back = new URL(`/status/${token}`, req.nextUrl.origin);
  try {
    await requestReoffer(d, id);
    back.searchParams.set("reoffer", "asked");
  } catch (err) {
    if (!(err instanceof ClaimRejectedError)) throw err;
    back.searchParams.set("reoffer", "refused");
  }
  return NextResponse.redirect(back, 303);
}
