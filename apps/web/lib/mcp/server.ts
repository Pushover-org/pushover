// The MCP server for assistants (plan item P12): three tools, and only three.
//
//   list_settlements  read-only   which settlements are open, who qualifies, what they pay
//   file_claim        writes      files a claim FOR a person, with the receipt; it waits UNBOUND
//   claim_status      read-only   a claim's progress, by its private status token
//
// There is no tool that confirms, decides, approves, holds or pays, and none can be added by an
// assistant: the tool list is fixed here, and tools.test.ts fails if it changes or if any tool could
// reach money. A filing becomes a claim only when its person logs in with PayPal and confirms it on
// the confirm page, which no tool can open on their behalf.
//
// The operations are passed in, so this file holds only the contract (and tests can run it without a
// database). app/api/mcp/route.ts passes lib/server/assistant-api.ts.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";
import { ClaimStatusInput, ClaimStatusResult, FileClaimInput, FileClaimResult, ListSettlementsInput, ListSettlementsResult } from "../api/schemas.ts";

export const SERVER_NAME = "proof-of-claim";
export const SERVER_VERSION = "1.0.0";

/** The whole tool list. tools.test.ts holds this to exactly these three. */
export const TOOL_NAMES = ["list_settlements", "file_claim", "claim_status"] as const;

export const INSTRUCTIONS = [
  "Proof of Claim runs claims for class-action settlements. You can help a person claim: find a settlement they qualify for, fill in the claim, attach their receipt photo, and follow its progress.",
  "You cannot make it their claim. file_claim returns a confirm_url: the person opens it, logs in with PayPal, checks what you filed and swears to it. Until then nothing is read, decided or paid, and if nobody confirms it in time it closes.",
  "Decisions are made by published rules and claims staff, never by you or by the receipt reader, and payment goes only to the PayPal account that confirmed the claim.",
  "Use the person's own words for the declaration. Never file for someone who hasn't asked you to.",
].join("\n\n");

export type Failure = { ok: false; code: string; error: string; retryAfterSeconds?: number };
export interface AssistantOps {
  listSettlements(): Promise<z.infer<typeof ListSettlementsResult>>;
  fileClaim(input: z.infer<typeof FileClaimInput>): Promise<{ ok: true; value: z.infer<typeof FileClaimResult> } | Failure>;
  claimStatus(token: string): Promise<z.infer<typeof ClaimStatusResult> | null>;
}

const text = (s: string) => [{ type: "text" as const, text: s }];
const refuse = (f: Failure) => ({
  isError: true,
  content: text(`${f.error} (${f.code}${f.retryAfterSeconds ? `, retry after ${f.retryAfterSeconds}s` : ""})`),
});

export function buildMcpServer(ops: AssistantOps): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "list_settlements",
    {
      title: "List open settlements",
      description: "Settlements taking claims now: who qualifies, the class period and states, and what a claim can pay with and without a receipt.",
      inputSchema: ListSettlementsInput,
      outputSchema: ListSettlementsResult,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const value = await ops.listSettlements();
      const lines = value.settlements.map((s) => `${s.id}: ${s.name}. ${s.who_qualifies}`);
      return { structuredContent: value, content: text(lines.length ? lines.join("\n") : "No settlement is taking claims right now.") };
    },
  );

  server.registerTool(
    "file_claim",
    {
      title: "File a claim for a person",
      description:
        "Files a claim on a person's behalf, with their receipt photo for the proof tier. The claim waits (state UNBOUND) until the person opens confirm_url, logs in with PayPal and confirms it is theirs; only then is it read, checked and decided. Give them the confirm_url. You cannot confirm, decide or pay.",
      inputSchema: FileClaimInput,
      outputSchema: FileClaimResult,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input) => {
      const r = await ops.fileClaim(input);
      if (!r.ok) return refuse(r);
      return {
        structuredContent: r.value,
        content: text(`Filed ${r.value.claim_id}, waiting for the person. Ask them to open ${r.value.confirm_url} and confirm it with PayPal by ${r.value.lapses_at.slice(0, 10)}.`),
      };
    },
  );

  server.registerTool(
    "claim_status",
    {
      title: "Check a claim's progress",
      description: "A claim's state, the decision and its reason, and the amount it can expect. Shows nothing personal. The token stops working once the person confirms, because the claim is theirs from then on.",
      inputSchema: ClaimStatusInput,
      outputSchema: ClaimStatusResult,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ status_token }) => {
      const value = await ops.claimStatus(status_token);
      if (!value) return refuse({ ok: false, code: "not_found", error: "No claim has that status token. If the person has confirmed the claim, ask them for their own status link." });
      return { structuredContent: value, content: text(`${value.claim_id}: ${value.title}. ${value.detail}`) };
    },
  );

  return server;
}
