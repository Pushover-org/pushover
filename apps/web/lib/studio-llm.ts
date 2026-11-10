// AG Studio's agent framework talks in its own turn format (AgLlmRequest / AgLlmResponse); Claude's
// Messages API in another. This module translates between them, both ways, with no I/O, so the
// server route stays small and the translation is unit-tested (plan item C13).
//
// The agent is read-only on purpose (spec §4.7): only the tools in READ_ONLY_TOOLS ever reach the
// model, whatever the browser sends, and none of them can decide, hold or pay a claim. They read the
// table of claims already on the analyst's page.
import type Anthropic from "@anthropic-ai/sdk";
import type { AgAiConversationItem, AgAiEvent, AgAiOutputItem, AgLlmRequest, AgLlmResponse } from "ag-studio";

/** AG Studio's reading tools. Anything that changes the page, a claim or money is left out. */
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set(["view_schema", "view_report", "view_page", "view_widget", "execute_query"]);

const parseArgs = (s: string): Record<string, unknown> => {
  try {
    const v: unknown = JSON.parse(s || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

/** The conversation as Messages API turns, plus any system-role text AG Studio put in it. */
export function toMessages(input: AgAiConversationItem[]): { system: string[]; messages: Anthropic.MessageParam[] } {
  const system: string[] = [];
  const turns: { role: "user" | "assistant"; content: Anthropic.ContentBlockParam[] }[] = [];
  const push = (role: "user" | "assistant", block: Anthropic.ContentBlockParam) => {
    const last = turns.at(-1);
    if (last?.role === role) last.content.push(block);
    else turns.push({ role, content: [block] });
  };
  for (const item of input) {
    if (item.type === "message" && item.kind === "input") {
      const text = item.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("\n");
      if (!text) continue;
      if (item.role === "system") system.push(text);
      else push("user", { type: "text", text });
    } else if (item.type === "message") {
      const text = item.content.map((c) => (c.type === "text" ? c.text : c.refusal)).join("\n");
      if (text) push("assistant", { type: "text", text });
    } else if (item.type === "function_call") {
      push("assistant", { type: "tool_use", id: item.callId, name: item.name, input: parseArgs(item.arguments) });
    } else if (item.type === "function_call_output") {
      push("user", { type: "tool_result", tool_use_id: item.callId, content: item.output });
    }
    // Reasoning items carry nothing to send back: the route runs the model without thinking.
  }

  // Every tool call needs its result in the very next user turn, and results must come first in it.
  // A cancelled run can leave a call without a result; it is answered as not run.
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    if (t?.role !== "assistant") continue;
    const calls = t.content.flatMap((b) => (b.type === "tool_use" ? [b.id] : []));
    if (calls.length === 0) continue;
    let next = turns[i + 1];
    if (next?.role !== "user") {
      next = { role: "user", content: [] };
      turns.splice(i + 1, 0, next);
    }
    const have = new Set(next.content.flatMap((b) => (b.type === "tool_result" ? [b.tool_use_id] : [])));
    const missing = calls.filter((id) => !have.has(id)).map((id): Anthropic.ToolResultBlockParam => ({ type: "tool_result", tool_use_id: id, content: "Not run: the run was stopped.", is_error: true }));
    const results = next.content.filter((b) => b.type === "tool_result" && calls.includes(b.tool_use_id));
    const rest = next.content.filter((b) => b.type !== "tool_result");
    next.content = [...results, ...missing, ...rest];
  }
  // A result whose call is not in the turn before it would be rejected; drop it.
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    if (t?.role !== "user") continue;
    const prev = turns[i - 1];
    const calls = new Set(prev?.role === "assistant" ? prev.content.flatMap((b) => (b.type === "tool_use" ? [b.id] : [])) : []);
    t.content = t.content.filter((b) => b.type !== "tool_result" || calls.has(b.tool_use_id));
  }
  const messages = turns.filter((t) => t.content.length > 0);
  if (messages[0]?.role === "assistant") messages.unshift({ role: "user", content: [{ type: "text", text: "(The conversation so far.)" }] });
  return { system, messages };
}

/** Only the reading tools, in the Messages API's shape. */
export function toTools(tools: AgLlmRequest["tools"]): Anthropic.Tool[] {
  return (tools ?? [])
    .filter((t) => READ_ONLY_TOOLS.has(t.name) && t.kind !== "provided")
    .map((t) => ({ name: t.name, description: t.description, input_schema: { ...(t.parameters as Record<string, unknown>), type: "object" as const } }));
}

export function toToolChoice(choice: AgLlmRequest["toolChoice"], tools: Anthropic.Tool[]): Anthropic.ToolChoice | undefined {
  if (tools.length === 0 || choice === undefined || choice === "auto") return undefined;
  if (choice === "none") return { type: "none" };
  if (choice === "required") return { type: "any" };
  return tools.some((t) => t.name === choice.name) ? { type: "tool", name: choice.name } : undefined;
}

/** The model's reply as AG Studio's response: its text, then its tool calls, in the order given. */
export function fromMessage(res: Anthropic.Message, now = Date.now()): AgLlmResponse {
  const output: AgAiOutputItem[] = [];
  res.content.forEach((b, i) => {
    if (b.type === "text" && b.text) {
      output.push({ id: `${res.id}-${i}`, kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text: b.text, annotations: [] }] });
    } else if (b.type === "tool_use") {
      output.push({ id: b.id, kind: "output", type: "function_call", callId: b.id, name: b.name, arguments: JSON.stringify(b.input ?? {}), status: "completed" });
    }
  });
  if (res.stop_reason === "refusal") {
    output.push({ id: `${res.id}-refusal`, kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "refusal", refusal: "The model declined to answer this." }] });
  }
  return {
    id: res.id,
    createdAt: now,
    model: res.model,
    output,
    status: res.stop_reason === "max_tokens" ? "incomplete" : "completed",
    ...(res.stop_reason === "max_tokens" ? { incompleteDetails: { reason: "max_output_tokens" as const } } : {}),
    usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens, totalTokens: res.usage.input_tokens + res.usage.output_tokens },
  };
}

/** A failed turn, as AG Studio expects one: on the response, not as a stream event. */
export function failed(code: string, message: string, now = Date.now()): AgLlmResponse {
  return { id: `failed-${now}`, createdAt: now, output: [], status: "failed", error: { code, message } };
}

/** The stream AG Studio reads, replayed from a finished response (the route answers in one piece). */
export function* eventsOf(res: AgLlmResponse): Generator<AgAiEvent> {
  for (const item of res.output) {
    if (item.type === "message") {
      const text = item.content.map((c) => (c.type === "text" ? c.text : c.refusal)).join("");
      yield { type: "TEXT_MESSAGE_START", messageId: item.id, role: "assistant" };
      yield { type: "TEXT_MESSAGE_CONTENT", messageId: item.id, delta: text };
      yield { type: "TEXT_MESSAGE_END", messageId: item.id };
    } else if (item.type === "function_call") {
      yield { type: "TOOL_CALL_START", toolCallId: item.callId, toolCallName: item.name };
      yield { type: "TOOL_CALL_ARGS", toolCallId: item.callId, delta: item.arguments };
      yield { type: "TOOL_CALL_END", toolCallId: item.callId };
    }
  }
}
