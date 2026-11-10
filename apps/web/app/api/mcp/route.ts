// The MCP endpoint (plan item P12), Streamable HTTP, stateless: every request gets a fresh server and
// transport, as in the SDK's web-standard example, so nothing is held between requests and any
// instance can answer. Open to any assistant (no key) but rate-limited per network; safety comes from
// the tools themselves, which can file and read but never confirm, decide or pay.
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildMcpServer } from "@/lib/mcp/server.ts";
import { admit, claimStatus, fileClaimForPerson, listSettlements } from "@/lib/server/assistant-api.ts";
import { caller } from "@/lib/server/caller.ts";

export const dynamic = "force-dynamic";

async function handle(req: Request): Promise<Response> {
  const { origin, network } = caller(req);
  const busy = await admit(network, "call");
  if (busy) {
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32000, message: busy.error }, id: null },
      { status: 429, headers: { "Retry-After": String(busy.retryAfterSeconds ?? 60) } },
    );
  }
  const server = buildMcpServer({
    listSettlements: () => listSettlements(origin),
    fileClaim: (input) => fileClaimForPerson(input, { origin, network }),
    claimStatus: (token) => claimStatus(token, origin),
  });
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    // The JSON response is complete by now; nothing is kept between requests.
    void server.close();
  }
}

/**
 * Stateless: there is no server-to-client stream to open (GET) and no session to end (DELETE). The
 * MCP spec lets such a server answer 405, as the SDK's own stateless example does; an empty stream
 * that closes at once would only make some clients reconnect in a loop.
 */
function methodNotAllowed(): Response {
  return Response.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed. This server is stateless: send JSON-RPC with POST." }, id: null }, { status: 405, headers: { Allow: "POST" } });
}

export const POST = handle;
export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
