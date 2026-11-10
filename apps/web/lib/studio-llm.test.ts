import type Anthropic from "@anthropic-ai/sdk";
import type { AgAiConversationItem, AgAiToolSchema } from "ag-studio";
import { describe, expect, it } from "vitest";
import { eventsOf, fromMessage, toMessages, toToolChoice, toTools } from "./studio-llm.ts";

const user = (text: string): AgAiConversationItem => ({ id: `u-${text}`, kind: "input", type: "message", role: "user", status: "completed", content: [{ type: "text", text }] });
const said = (text: string): AgAiConversationItem => ({ id: `a-${text}`, kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text, annotations: [] }] });
const call = (callId: string, name: string, args: object): AgAiConversationItem => ({ id: callId, kind: "output", type: "function_call", callId, name, arguments: JSON.stringify(args) });
const result = (callId: string, output: string): AgAiConversationItem => ({ type: "function_call_output", callId, output, status: "completed" });
const tool = (name: string): AgAiToolSchema => ({ name, description: `${name} tool`, parameters: { type: "object", properties: { q: { type: "string" } } } });

describe("AG Studio turns as Messages API turns", () => {
  it("puts parallel calls in one assistant turn and all their results first in the next user turn", () => {
    const { messages, system } = toMessages([
      { id: "s", kind: "input", type: "message", role: "system", status: "completed", content: [{ type: "text", text: "Be brief." }] },
      user("denied over $20?"),
      said("Looking."),
      call("t1", "view_schema", {}),
      call("t2", "execute_query", { q: "x" }),
      result("t2", "rows"),
      result("t1", "schema"),
      said("Two claims."),
    ]);
    expect(system).toEqual(["Be brief."]);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(messages[1]?.content).toEqual([
      { type: "text", text: "Looking." },
      { type: "tool_use", id: "t1", name: "view_schema", input: {} },
      { type: "tool_use", id: "t2", name: "execute_query", input: { q: "x" } },
    ]);
    expect(messages[2]?.content).toEqual([
      { type: "tool_result", tool_use_id: "t2", content: "rows" },
      { type: "tool_result", tool_use_id: "t1", content: "schema" },
    ]);
  });

  it("answers a call left without a result (a stopped run) as not run, and drops a result with no call", () => {
    const { messages } = toMessages([user("q"), call("t1", "view_page", {}), user("never mind"), result("ghost", "x")]);
    expect(messages[2]?.content).toEqual([
      { type: "tool_result", tool_use_id: "t1", content: "Not run: the run was stopped.", is_error: true },
      { type: "text", text: "never mind" },
    ]);
    expect(JSON.stringify(messages)).not.toContain("ghost");
  });

  it("starts with a user turn even if the history starts with the assistant", () => {
    expect(toMessages([said("Hello")]).messages[0]?.role).toBe("user");
  });
});

describe("the agent is read-only", () => {
  it("passes on only AG Studio's reading tools, whatever the browser sends", () => {
    const tools = toTools([tool("view_schema"), tool("execute_query"), tool("add_widget"), tool("configure_widget"), tool("approve_claim"), { ...tool("view_page"), kind: "provided", provider: {} }]);
    expect(tools.map((t) => t.name)).toEqual(["view_schema", "execute_query"]);
    expect(tools[0]?.input_schema.type).toBe("object");
  });

  it("forces a tool only when it is one of those", () => {
    const tools = toTools([tool("execute_query")]);
    expect(toToolChoice("required", tools)).toEqual({ type: "any" });
    expect(toToolChoice({ name: "execute_query" }, tools)).toEqual({ type: "tool", name: "execute_query" });
    expect(toToolChoice({ name: "add_widget" }, tools)).toBeUndefined();
    expect(toToolChoice("required", [])).toBeUndefined();
  });
});

describe("Claude's reply as AG Studio's response and stream", () => {
  const msg = (content: unknown[], stop_reason: string): Anthropic.Message =>
    ({ id: "msg_1", type: "message", role: "assistant", model: "claude-haiku-5-5", content, stop_reason, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 20 } }) as unknown as Anthropic.Message;

  it("keeps text and tool calls in order, with usage", () => {
    const res = fromMessage(msg([{ type: "text", text: "Checking." }, { type: "tool_use", id: "toolu_1", name: "execute_query", input: { q: 1 } }], "tool_use"), 5);
    expect(res).toMatchObject({ id: "msg_1", createdAt: 5, status: "completed", model: "claude-haiku-5-5", usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } });
    expect(res.output.map((o) => o.type)).toEqual(["message", "function_call"]);
    expect(res.output[1]).toMatchObject({ callId: "toolu_1", name: "execute_query", arguments: '{"q":1}' });
    expect([...eventsOf(res)].map((e) => e.type)).toEqual(["TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END", "TOOL_CALL_START", "TOOL_CALL_ARGS", "TOOL_CALL_END"]);
  });

  it("reports a cut-off answer as incomplete and a refusal as a refusal", () => {
    expect(fromMessage(msg([{ type: "text", text: "partial" }], "max_tokens"))).toMatchObject({ status: "incomplete", incompleteDetails: { reason: "max_output_tokens" } });
    const refused = fromMessage(msg([], "refusal"));
    expect(refused.output[0]).toMatchObject({ type: "message", content: [{ type: "refusal" }] });
  });
});
