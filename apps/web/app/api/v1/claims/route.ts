// POST /api/v1/claims: the JSON twin of the MCP tool file_claim (OpenAPI: fileClaim). Files a claim
// for a person; it waits UNBOUND until they confirm it with PayPal.
import { FileClaimInput } from "@/lib/api/schemas.ts";
import { admit, fileClaimForPerson } from "@/lib/server/assistant-api.ts";
import { caller } from "@/lib/server/caller.ts";
import { fromFailure, readJson } from "@/lib/server/json-api.ts";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const who = caller(req);
  const busy = await admit(who.network, "call");
  if (busy) return fromFailure(busy);
  const body = await readJson(req, FileClaimInput);
  if (!body.ok) return body.response;
  const r = await fileClaimForPerson(body.value, who);
  return r.ok ? Response.json(r.value, { status: 201 }) : fromFailure(r);
}
