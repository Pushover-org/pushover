// A claimant sends the document the rules asked for, or appeals (plan items P9, C9, B3). The private
// status link is the claimant's key, as on the status page. Errors go back as short codes, so the
// status page shows them in the claimant's language.
import { appealClaim, claimByStatusToken, ClaimRejectedError, sendDocument } from "@proofofclaim/desk";
import { NextResponse, type NextRequest } from "next/server";
import { claimView, desk, pool } from "@/lib/server/data.ts";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const id = await claimByStatusToken({ pool: pool() }, token);
  const c = id ? await claimView(id) : null;
  const d = c ? await desk(c.settlementId) : null;
  if (!id || !d) return new Response("not found", { status: 404 });
  const back = new URL(`/status/${token}`, req.nextUrl.origin);
  const fail = (code: string) => {
    back.searchParams.set("error", code);
    return NextResponse.redirect(back, 303);
  };

  const data = await req.formData().catch(() => null);
  const kind = data?.get("kind");
  const file = data?.get("file");
  let image: Uint8Array | null = null;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_IMAGE_BYTES) return fail("too_big");
    image = new Uint8Array(await file.arrayBuffer());
  }
  try {
    if (kind === "document") {
      if (!image) return fail("no_file");
      await sendDocument(d, id, image);
    } else if (kind === "appeal") {
      await appealClaim(d, id, { message: String(data?.get("message") ?? ""), image });
    } else {
      return new Response("unknown follow-up", { status: 400 });
    }
  } catch (err) {
    if (!(err instanceof ClaimRejectedError)) throw err;
    return fail(err.code ?? "not_now");
  }
  back.searchParams.set("sent", kind);
  return NextResponse.redirect(back, 303);
}
