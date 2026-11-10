// GET /api/openapi.json: the OpenAPI 3.1 description of the assistants' JSON API (plan item P15),
// generated from the same zod schemas as the MCP tools. docs/openapi.json is the same document.
import { openApiDocument } from "@/lib/api/openapi.ts";

export const dynamic = "force-static";

export function GET() {
  return Response.json(openApiDocument(), { headers: { "Access-Control-Allow-Origin": "*" } });
}
