import { evidenceOf } from "@/lib/server/data.ts";

// TODO(R12): gate photos from live claimants behind the analyst login; the demo's corpus images
// are a public dataset (ExpressExpense SRD) and our own renders.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9._-]{1,63}$/.test(id)) return new Response("bad claim id", { status: 400 });
  const e = await evidenceOf(id);
  if (!e) return new Response("no evidence", { status: 404 });
  return new Response(new Uint8Array(e.bytes), {
    headers: { "Content-Type": e.contentType, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" },
  });
}
