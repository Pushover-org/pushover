// The drift test (plan item P15): the published OpenAPI document, the MCP tools and the claim form
// are one contract. Change a schema without regenerating docs/openapi.json (pnpm openapi), or let an
// MCP tool's schema differ from its operation's, and this fails.
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildMcpServer, TOOL_NAMES } from "../mcp/server.ts";
import { openApiDocument, openApiText } from "./openapi.ts";
import { ClaimFormSchema, FileClaimInput } from "./schemas.ts";

type Doc = { openapi: string; paths: Record<string, Record<string, Op>>; components: { schemas: Record<string, Record<string, unknown>> }; "x-mcp": { tools: string[] } };
type Op = { operationId: string; requestBody?: { content: Record<string, { schema: { $ref: string } }> }; responses: Record<string, { content?: Record<string, { schema: { $ref: string } }> }> };
const doc = openApiDocument() as unknown as Doc;

async function mcpTools() {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await buildMcpServer({} as never).connect(a);
  const client = new Client({ name: "drift-test", version: "1.0.0" });
  await client.connect(b);
  return (await client.listTools()).tools;
}
// The SDK labels tool schemas draft-07; OpenAPI 3.1's are 2020-12. Only the label may differ.
const withoutDialect = (s: unknown) => {
  const rest = { ...((s ?? {}) as Record<string, unknown>) };
  delete rest["$schema"];
  return rest;
};

// Each MCP tool and the JSON operation that does the same thing.
const TWINS = {
  list_settlements: { operationId: "listSettlements", request: null, response: "ListSettlementsResult" },
  file_claim: { operationId: "fileClaim", request: "FileClaimRequest", response: "FileClaimResult" },
  claim_status: { operationId: "claimStatus", request: "ClaimStatusRequest", response: "ClaimStatusResult" },
} as const;

describe("OpenAPI 3.1, MCP and the claim form share one contract (P15)", () => {
  it("docs/openapi.json is what the schemas generate (run `pnpm openapi` after changing them)", () => {
    const committed = readFileSync(new URL("../../../../docs/openapi.json", import.meta.url), "utf8");
    expect(committed, "docs/openapi.json is out of date: run pnpm openapi").toBe(openApiText());
  });

  it("every MCP tool's input and output schema is exactly its operation's", async () => {
    const tools = await mcpTools();
    expect(Object.keys(TWINS).sort()).toEqual([...TOOL_NAMES].sort());
    for (const t of tools) {
      const twin = TWINS[t.name as keyof typeof TWINS];
      const op = Object.values(doc.paths).flatMap((p) => Object.values(p)).find((o) => o.operationId === twin.operationId);
      expect(op, t.name).toBeDefined();
      if (twin.request) {
        expect(op?.requestBody?.content["application/json"]?.schema.$ref).toBe(`#/components/schemas/${twin.request}`);
        expect(withoutDialect(t.inputSchema), `${t.name} input`).toEqual(doc.components.schemas[twin.request]);
      } else {
        expect(op?.requestBody).toBeUndefined();
        expect(Object.keys(t.inputSchema.properties ?? {})).toEqual([]);
      }
      const ok = Object.entries(op?.responses ?? {}).find(([code]) => code.startsWith("2"))?.[1];
      expect(ok?.content?.["application/json"]?.schema.$ref).toBe(`#/components/schemas/${twin.response}`);
      expect(withoutDialect(t.outputSchema), `${t.name} output`).toEqual(doc.components.schemas[twin.response]);
    }
    expect(doc["x-mcp"].tools).toEqual([...TOOL_NAMES]);
  });

  it("the claim form and the assistants check each shared field by the same rule", () => {
    const pairs = [["name", "name"], ["addressLine", "address_line"], ["city", "city"], ["state", "state"], ["zip", "zip"], ["declaration", "declaration"], ["settlement", "settlement"], ["tier", "tier"]] as const;
    for (const [form, api] of pairs) {
      expect(z.toJSONSchema(ClaimFormSchema.shape[form]), form).toEqual(z.toJSONSchema(FileClaimInput.shape[api]));
    }
  });

  it("is a well-formed OpenAPI 3.1 document: unique operation IDs, every reference resolves, every response is described", () => {
    expect(doc.openapi).toBe("3.1.0");
    const ops = Object.values(doc.paths).flatMap((p) => Object.values(p));
    expect(new Set(ops.map((o) => o.operationId)).size).toBe(ops.length);
    const refs = JSON.stringify(doc).match(/"\$ref":"[^"]+"/g) ?? [];
    expect(refs.length).toBeGreaterThan(5);
    for (const r of refs) {
      const name = /#\/components\/schemas\/([A-Za-z]+)/.exec(r)?.[1];
      expect(name && doc.components.schemas[name], r).toBeTruthy();
    }
    for (const op of ops) {
      expect(Object.keys(op.responses).some((c) => c.startsWith("2")), op.operationId).toBe(true);
      for (const [code, r] of Object.entries(op.responses)) expect(r.content?.["application/json"], `${op.operationId} ${code}`).toBeDefined();
    }
    for (const [name, s] of Object.entries(doc.components.schemas)) {
      expect(s["type"], name).toBe("object");
      expect(s["$schema"], name).toBeUndefined();
    }
  });

  it("describes what the caller can't do: no operation confirms, decides or pays", () => {
    const ops = Object.values(doc.paths).flatMap((p) => Object.values(p)).map((o) => o.operationId);
    expect(ops.sort()).toEqual(["claimStatus", "fileClaim", "listSettlements"]);
    for (const id of ops) expect(id).not.toMatch(/confirm|approve|decide|pay|distribut|review/i);
    expect(JSON.stringify(doc)).toMatch(/A filing is not a claim until its person confirms it/);
    // A request field that defaults (units) is optional to the caller.
    expect((doc.components.schemas["FileClaimRequest"]?.["required"] as string[])).not.toContain("units");
  });
});
