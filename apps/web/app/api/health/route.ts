// GET /api/health: Railway's healthcheck (a deploy goes live only once this answers 200) and the
// uptime check. It asks the database one question and says nothing else about the app.
import { pool } from "@/lib/server/data.ts";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await pool().query("SELECT 1");
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false, database: "unreachable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
