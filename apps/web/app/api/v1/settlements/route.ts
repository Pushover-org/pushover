// GET /api/v1/settlements: the JSON twin of the MCP tool list_settlements (OpenAPI: listSettlements).
import { admit, listSettlements } from "@/lib/server/assistant-api.ts";
import { caller } from "@/lib/server/caller.ts";
import { fromFailure } from "@/lib/server/json-api.ts";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { origin, network } = caller(req);
  const busy = await admit(network, "call");
  if (busy) return fromFailure(busy);
  return Response.json(await listSettlements(origin));
}
