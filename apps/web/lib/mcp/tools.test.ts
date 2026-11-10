// The MCP server's contract (plan item P12): exactly three tools, none of which can confirm, decide,
// approve or pay. Run with the SDK's own client, in memory and over Streamable HTTP.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { describe, expect, it } from "vitest";
import { buildMcpServer, INSTRUCTIONS, TOOL_NAMES, type AssistantOps } from "./server.ts";

const filed: unknown[] = [];
const ops: AssistantOps = {
  listSettlements: async () => ({
    settlements: [{
      id: "acme-restaurant-beverage", name: "Acme Restaurant Beverage Settlement (fictional demo)", demo: true, who_qualifies: "Anyone who bought a drink.",
      class_period: { start: "2015-01-01", end: "2019-12-31" }, states: ["CA"], products: [{ id: "restaurant-drink", name: "Drink", description: "A drink" }],
      tiers: { proof: { unit_cents: 1500, max_units: 5 }, no_proof: { flat_cents: 1000 } }, filing_closes_at: null, claim_url: "https://example.test/claim/acme-restaurant-beverage",
    }],
  }),
  fileClaim: async (input) => {
    filed.push(input);
    if (input.tier === "proof" && !input.receipt) return { ok: false, code: "no_receipt", error: "The proof tier needs the receipt photo." };
    return {
      ok: true,
      value: {
        claim_id: "poc-0123456789ab", state: "UNBOUND", confirm_url: "https://example.test/confirm/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", lapses_at: "2026-11-17T00:00:00.000Z",
        status_token: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", status_url: "https://example.test/status/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", next_step: "Give the person the confirm_url.",
      },
    };
  },
  claimStatus: async (token) =>
    token === "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
      ? {
          claim_id: "poc-0123456789ab", settlement: "acme-restaurant-beverage", state: "UNBOUND", title: "Waiting for you to confirm", detail: "Nothing is paid before the person confirms.",
          outcome: null, reason: null, expected_amount: { amount: "$10.00", basis: "flat" }, filed_by: { via: "ASSISTANT", agent_name: "Test Assistant", confirmed_at: null },
          status_url: "https://example.test/status/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        }
      : null,
};

async function inMemory(): Promise<Client> {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await buildMcpServer(ops).connect(a);
  const client = new Client({ name: "tools-test", version: "1.0.0" });
  await client.connect(b);
  return client;
}

/** The route's own wiring (stateless: a fresh server and transport per request), without Next. */
async function overHttp(): Promise<Client> {
  const fetchViaRoute = async (url: string | URL, init?: RequestInit) => {
    const server = buildMcpServer(ops);
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(new Request(url, init));
  };
  const client = new Client({ name: "tools-test-http", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL("http://mcp.test/api/mcp"), { fetch: fetchViaRoute }));
  return client;
}

// Words for what only a person or the rules may do. No tool's name, and no input field, may be one.
const POWER = /confirm|approve|decide|decision|deny|review|hold|release|pay|payout|distribut|refund|bind|verify|override|cy.?pres|amount|entitle|payer|paypal|outcome|analyst|admin/i;

describe("the MCP server's tools (P12)", () => {
  it("lists exactly list_settlements, file_claim and claim_status", async () => {
    const { tools } = await (await inMemory()).listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it("no tool's name, and no input field, could confirm, decide, approve or pay", async () => {
    const { tools } = await (await inMemory()).listTools();
    for (const t of tools) {
      expect(t.name, t.name).not.toMatch(POWER);
      const fields = Object.keys((t.inputSchema as { properties?: Record<string, unknown> }).properties ?? {});
      const nested = JSON.stringify(t.inputSchema.properties ?? {}).match(/"([a-z_]+)":\{/g) ?? [];
      for (const f of [...fields, ...nested.map((n) => n.slice(1, n.indexOf('"', 1)))]) expect(f, `${t.name}.${f}`).not.toMatch(POWER);
    }
  });

  it("the reading tools say they only read; filing says it is not destructive", async () => {
    const { tools } = await (await inMemory()).listTools();
    const by = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));
    expect(by["list_settlements"]?.readOnlyHint).toBe(true);
    expect(by["claim_status"]?.readOnlyHint).toBe(true);
    expect(by["file_claim"]).toMatchObject({ readOnlyHint: false, destructiveHint: false });
  });

  it("tells the assistant, in the tool and the server instructions, that the person confirms and it can't", async () => {
    const client = await inMemory();
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === "file_claim")?.description).toMatch(/You cannot confirm, decide or pay/);
    expect(client.getInstructions()).toBe(INSTRUCTIONS);
    expect(INSTRUCTIONS).toMatch(/logs in with PayPal/);
  });

  it("file_claim has no 'sworn' field: an assistant can't swear for anyone", async () => {
    const { tools } = await (await inMemory()).listTools();
    const fields = Object.keys(tools.find((t) => t.name === "file_claim")?.inputSchema.properties ?? {});
    expect(fields).not.toContain("sworn");
    expect(fields).toEqual(expect.arrayContaining(["settlement", "agent_name", "tier", "name", "address_line", "state", "zip", "declaration", "receipt"]));
  });

  it("over Streamable HTTP, an MCP client files a claim and reads its status", async () => {
    const client = await overHttp();
    const list = await client.callTool({ name: "list_settlements", arguments: {} });
    expect((list.structuredContent as { settlements: { id: string }[] }).settlements[0]?.id).toBe("acme-restaurant-beverage");
    const filedNow = await client.callTool({
      name: "file_claim",
      arguments: {
        settlement: "acme-restaurant-beverage", agent_name: "Test Assistant", tier: "no_proof", name: "Ada Lovelace", address_line: "1 Main St", city: "Fresno",
        state: "CA", zip: "93701", declaration: "I had an iced tea with lunch at a diner in Fresno in 2017.",
      },
    });
    expect(filedNow.isError).toBeFalsy();
    expect(filedNow.structuredContent).toMatchObject({ state: "UNBOUND", claim_id: "poc-0123456789ab" });
    expect(JSON.stringify(filedNow.content)).toMatch(/confirm/);
    const status = await client.callTool({ name: "claim_status", arguments: { status_token: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB" } });
    expect(status.structuredContent).toMatchObject({ state: "UNBOUND", filed_by: { via: "ASSISTANT", agent_name: "Test Assistant" } });
  });

  it("refuses bad input before the operation runs, and reports the operation's own refusals as tool errors", async () => {
    const client = await inMemory();
    const before = filed.length;
    const bad = await client.callTool({ name: "file_claim", arguments: { settlement: "acme-restaurant-beverage", agent_name: "X", tier: "proof", name: "A", state: "ZZ" } });
    expect(bad.isError).toBe(true);
    expect(filed.length).toBe(before);
    const noReceipt = await client.callTool({
      name: "file_claim",
      arguments: { settlement: "acme-restaurant-beverage", agent_name: "Test Assistant", tier: "proof", units: 2, name: "Ada Lovelace", address_line: "1 Main St", city: "Fresno", state: "CA", zip: "93701", declaration: "I had two lemonades at a diner in Fresno in 2017." },
    });
    expect(noReceipt.isError).toBe(true);
    expect(JSON.stringify(noReceipt.content)).toMatch(/no_receipt/);
    const unknown = await client.callTool({ name: "claim_status", arguments: { status_token: "C".repeat(32) } });
    expect(unknown.isError).toBe(true);
  });

  it("refuses a field it doesn't know, such as 'sworn' or 'confirmed', instead of ignoring it", async () => {
    const client = await inMemory();
    const before = filed.length;
    for (const extra of [{ sworn: true }, { confirmed: true }, { approve: true }]) {
      const r = await client.callTool({
        name: "file_claim",
        arguments: { settlement: "acme-restaurant-beverage", agent_name: "Test Assistant", tier: "no_proof", name: "Ada Lovelace", address_line: "1 Main St", city: "Fresno", state: "CA", zip: "93701", declaration: "I had an iced tea with lunch at a diner in Fresno in 2017.", ...extra },
      });
      expect(r.isError, JSON.stringify(extra)).toBe(true);
      expect(JSON.stringify(r.content)).toMatch(/unrecognized/i);
    }
    expect(filed.length).toBe(before);
  });

  it("a tool that doesn't exist can't be called, whatever its name", async () => {
    const client = await inMemory();
    for (const name of ["confirm_claim", "approve_claim", "pay_claim", "distribute"]) {
      const r = await client.callTool({ name, arguments: {} }).catch((e: unknown) => ({ isError: true, thrown: String(e) }));
      expect(r.isError, name).toBe(true);
    }
  });
});
