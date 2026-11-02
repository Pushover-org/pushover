import { settlement } from "@/lib/server/data.ts";
import { reportRows, toCsv } from "@/lib/server/report.ts";

export async function GET(_req: Request, ctx: { params: Promise<{ settlement: string }> }) {
  const { settlement: id } = await ctx.params;
  const S = await settlement(id);
  if (!S) return new Response("no such settlement", { status: 404 });
  return new Response(toCsv(await reportRows(S.id)), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${S.id}-court-report.csv"` },
  });
}
