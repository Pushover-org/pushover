// One turn of the AG Studio desk agent (plan item C13), relayed to Claude so the API key stays on the
// server. Analysts only. The agent is read-only: lib/studio-llm.ts passes on only AG Studio's reading
// tools, and those run in the analyst's browser over the claims table already on the page, so
// nothing here can decide, hold or pay a claim (spec rule 7).
import Anthropic from "@anthropic-ai/sdk";
import { appendAudit } from "@proofofclaim/db";
import { BudgetExceededError, CostGuard, costUsd } from "@proofofclaim/examiner";
import type { AgLlmRequest } from "ag-studio";
import { z } from "zod";
import { currentAnalyst } from "@/lib/server/auth.ts";
import { pool } from "@/lib/server/data.ts";
import { failed, fromMessage, toMessages, toToolChoice, toTools } from "@/lib/studio-llm.ts";

const MAX_TOKENS = 2048;
const MAX_BODY = 400_000;

const SYSTEM = [
  "You answer an analyst's questions about the claims on a claims desk for a fictional class-action settlement, paid in PayPal's sandbox with play money.",
  "You can only read: the tools you have look at the claims table and the dashboard on the analyst's page and run queries over it. Call view_schema before writing a query.",
  "You cannot approve, deny, hold, clear or pay a claim, or change anything. If asked to, say that a person does that on the claims desk and the money page, and stop.",
  "Amounts are US dollars. Dates are UTC. Answer in plain words, briefly, and give claim numbers when you list claims.",
  "When you use a tool, you may say a brief sentence first. If no tool can express what the user asked for, say so instead of guessing. Do not include internal or system XML tags in your response.",
].join("\n");

const Body = z.object({
  input: z.array(z.record(z.string(), z.unknown())).max(400),
  instructions: z.string().max(40_000).optional(),
  tools: z.array(z.object({ name: z.string().max(64), description: z.string().max(8000), parameters: z.unknown(), kind: z.string().optional() }).loose()).max(64).optional(),
  toolChoice: z.union([z.enum(["auto", "none", "required"]), z.object({ name: z.string() })]).optional(),
  responseFormat: z.object({ type: z.enum(["text", "json"]), schema: z.unknown().optional() }).loose().optional(),
});

const g = globalThis as unknown as { __pocStudioGuard?: CostGuard };

export async function POST(req: Request) {
  const analyst = await currentAnalyst();
  if (!analyst) return Response.json(failed("unauthorised", "Log in as an analyst."), { status: 401 });
  // JSON only: a cross-site form can't send it, and the session cookie is SameSite=Lax anyway.
  if (!req.headers.get("content-type")?.startsWith("application/json")) return Response.json(failed("bad_request", "Send JSON."), { status: 415 });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return Response.json(failed("too_large", "The conversation is too long; start a new one."), { status: 413 });
  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(JSON.parse(raw));
  } catch {
    return Response.json(failed("bad_request", "Not an AG Studio turn."), { status: 400 });
  }
  const request = parsed as unknown as AgLlmRequest;

  const key = process.env["ANTHROPIC_API_KEY"];
  if (!key) return Response.json(failed("no_model", "No model is configured on this server."), { status: 503 });
  const model = process.env["PUSHOVER_MODEL"] ?? "claude-haiku-5-5";
  g.__pocStudioGuard ??= new CostGuard(Number(process.env["STUDIO_AI_BUDGET_USD"] ?? "0.5"), 0);
  const guard = g.__pocStudioGuard;
  try {
    guard.check(CostGuard.reserveFor(model, MAX_TOKENS, Math.ceil(raw.length / 3)));
  } catch (err) {
    if (err instanceof BudgetExceededError) return Response.json(failed("budget", "The desk agent's AI budget for this server is used up."), { status: 429 });
    throw err;
  }

  const { system, messages } = toMessages(request.input);
  if (messages.length === 0) return Response.json(failed("bad_request", "Nothing to answer."), { status: 400 });
  const tools = toTools(request.tools);
  const toolChoice = toToolChoice(request.toolChoice, tools);
  const json = request.responseFormat?.type === "json" ? `Reply with only a JSON value matching this JSON Schema, and no other text:\n${JSON.stringify(request.responseFormat.schema)}` : null;
  const systemText = [SYSTEM, request.instructions ? `AG Studio's instructions for this agent:\n${request.instructions}` : null, ...system, json].filter(Boolean).join("\n\n");

  let res: Anthropic.Message;
  try {
    res = await new Anthropic({ apiKey: key }).messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: systemText,
      messages,
      ...(tools.length ? { tools } : {}),
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
      // Thinking off: AG Studio's conversation can't carry thinking blocks back between turns.
      thinking: { type: "disabled" },
      output_config: { effort: "low" },
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return Response.json(failed("rate_limited", "The model is busy; try again in a moment."), { status: 429 });
    if (err instanceof Anthropic.APIError) return Response.json(failed("model_error", `The model call failed (${err.status ?? "no status"}).`), { status: 502 });
    throw err;
  }
  const cost = costUsd(model, { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens });
  guard.record(cost);
  await appendAudit(pool(), {
    actor: `analyst:${analyst.email}`,
    action: "desk_agent_turn",
    subject: model,
    detail: { cost_usd: Number(cost.toFixed(6)), tool_calls: res.content.filter((b) => b.type === "tool_use").map((b) => (b.type === "tool_use" ? b.name : "")), stop: res.stop_reason },
  });
  return Response.json(fromMessage(res));
}
