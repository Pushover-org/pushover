// The OpenAPI 3.1 description of the assistants' JSON API (plan item P15), generated from the same
// zod schemas the MCP tools use (lib/api/schemas.ts), with zod's own JSON Schema output: OpenAPI 3.1
// uses JSON Schema 2020-12, zod's default target, so no converter library is needed.
//
// The published copy is docs/openapi.json (`pnpm openapi` writes it); the drift test fails when the
// schemas change and that file doesn't, or when an MCP tool's schema differs from its operation's.
import { z } from "zod";
import { TOOL_NAMES } from "../mcp/server.ts";
import { API_SCHEMAS, LIMITS } from "./schemas.ts";

/** Requests are described as the caller sends them (defaults optional), responses as we send them. */
const REQUESTS = new Set<keyof typeof API_SCHEMAS>(["FileClaimRequest", "ClaimStatusRequest"]);

function schemaOf(name: keyof typeof API_SCHEMAS): Record<string, unknown> {
  // OpenAPI 3.1's dialect is already JSON Schema 2020-12, so the per-schema "$schema" is dropped.
  const schema = z.toJSONSchema(API_SCHEMAS[name], { io: REQUESTS.has(name) ? "input" : "output" }) as Record<string, unknown>;
  delete schema["$schema"];
  return schema;
}

const ref = (name: keyof typeof API_SCHEMAS) => ({ $ref: `#/components/schemas/${name}` });
const json = (name: keyof typeof API_SCHEMAS) => ({ content: { "application/json": { schema: ref(name) } } });
const error = (description: string) => ({ description, ...json("ApiError") });
const limited = {
  description: "Too many requests from this network, or this settlement is taking too many assistant filings right now.",
  headers: { "Retry-After": { description: "Seconds to wait.", schema: { type: "integer" } } },
  ...json("ApiError"),
};

export function openApiDocument(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "Proof of Claim: claims API for assistants",
      version: "1.0.0",
      summary: "File a class-action claim for a person, with their receipt, and follow it. Nothing here can confirm, decide or pay a claim.",
      description: [
        "Proof of Claim runs claims for class-action settlements. An assistant (or any program) can find an open settlement, file a claim on a person's behalf with the receipt photo, and read the claim's progress.",
        "",
        "**A filing is not a claim until its person confirms it.** fileClaim returns a `confirm_url`. The person opens it, logs in with PayPal, checks what was filed and swears to it. Until then nothing is read, checked, decided or paid, and if nobody confirms it within 7 days (or by the filing deadline) it closes.",
        "",
        "**Decisions are made by published rules and claims staff, never by the caller.** Approved claims are paid through PayPal Payouts, only to the PayPal account that confirmed the claim, and only after two different staff members approve the payout round.",
        "",
        `The same three operations are available as MCP tools (${TOOL_NAMES.join(", ")}) at \`/api/mcp\` (Streamable HTTP).`,
        "",
        `No API key. Limits per network: ${LIMITS.callsPerMinute} requests and ${LIMITS.filingsPerMinute} filings a minute; per settlement: ${LIMITS.filingsPerSettlementPerHour} assistant filings an hour.`,
        "",
        "Demo settlements are fictional and pay PayPal sandbox play money.",
      ].join("\n"),
      license: { name: "MIT", identifier: "MIT" },
    },
    servers: [{ url: "/", description: "This deployment" }],
    tags: [{ name: "claims", description: "Filing and following claims" }],
    "x-mcp": { endpoint: "/api/mcp", transport: "streamable-http", tools: [...TOOL_NAMES] },
    paths: {
      "/api/v1/settlements": {
        get: {
          operationId: "listSettlements",
          tags: ["claims"],
          summary: "List open settlements",
          description: "Settlements taking claims now: who qualifies, the class period and states, and what a claim can pay. MCP tool: list_settlements.",
          responses: { "200": { description: "The open settlements.", ...json("ListSettlementsResult") }, "429": limited },
        },
      },
      "/api/v1/claims": {
        post: {
          operationId: "fileClaim",
          tags: ["claims"],
          summary: "File a claim for a person",
          description:
            "Files a claim on a person's behalf, with their receipt photo for the proof tier. It waits (state UNBOUND) until the person opens confirm_url, logs in with PayPal and confirms it. MCP tool: file_claim.",
          requestBody: { required: true, ...json("FileClaimRequest") },
          responses: {
            "201": { description: "Filed, waiting for the person to confirm it.", ...json("FileClaimResult") },
            "400": error("The body is invalid, or the receipt is missing or not an image."),
            "404": error("No settlement has that ID."),
            "409": error("Filing for this settlement has closed."),
            "413": error("The receipt photo is over 8 MB."),
            "415": error("The body is not application/json."),
            "429": limited,
          },
        },
      },
      "/api/v1/claims/status": {
        post: {
          operationId: "claimStatus",
          tags: ["claims"],
          summary: "Check a claim's progress",
          description:
            "A claim's state, decision, reason and expected amount, by its private status token (in the body, so it stays out of URLs and logs). Nothing personal is returned. MCP tool: claim_status.",
          requestBody: { required: true, ...json("ClaimStatusRequest") },
          responses: {
            "200": { description: "The claim's progress.", ...json("ClaimStatusResult") },
            "400": error("The body is invalid."),
            "404": error("No claim has that status token."),
            "415": error("The body is not application/json."),
            "429": limited,
          },
        },
      },
    },
    components: {
      schemas: Object.fromEntries((Object.keys(API_SCHEMAS) as (keyof typeof API_SCHEMAS)[]).map((n) => [n, schemaOf(n)])),
    },
  };
}

/** The file docs/openapi.json holds: stable formatting, so a diff shows only real changes. */
export const openApiText = () => `${JSON.stringify(openApiDocument(), null, 2)}\n`;
