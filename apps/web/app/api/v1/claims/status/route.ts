// POST /api/v1/claims/status: the JSON twin of the MCP tool claim_status (OpenAPI: claimStatus). The
// token goes in the body, not the URL, so it stays out of logs and Referer headers.
import { ClaimStatusInput } from "@/lib/api/schemas.ts";
import { admit, claimStatus } from "@/lib/server/assistant-api.ts";
import { caller } from "@/lib/server/caller.ts";
import { apiError, fromFailure, readJson } from "@/lib/server/json-api.ts";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { origin, network } = caller(req);
  const busy = await admit(network, "call");
  if (busy) return fromFailure(busy);
  const body = await readJson(req, ClaimStatusInput);
  if (!body.ok) return body.response;
  const value = await claimStatus(body.value.status_token, origin);
  return value ? Response.json(value, { headers: { "Cache-Control": "no-store" } }) : apiError(404, "not_found", "No claim has that status token.");
}
