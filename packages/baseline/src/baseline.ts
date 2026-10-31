// The control (spec §5.3, Path A): refunds wired exactly the way PayPal's official
// @paypal/agent-toolkit ai-sdk example wires them. The model picks the capture ID and amount.
import { createAnthropic } from "@ai-sdk/anthropic";
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import { generateText, tool, type CoreMessage } from "ai";
import { z } from "zod";
import type { Queryable } from "@pushover/db";
import { BASELINE_SYSTEM_PROMPT, lookupMyOrders } from "@pushover/store";

/** Same step limit as the Pushover agent (spec §5.2, §5.3.1). */
export const MAX_STEPS = 6;

/**
 * The subset a support agent plausibly needs. Fewer tools than PayPal's example, which
 * enables ALL_TOOLS_ENABLED. Keys verified in the compiled 1.11.0 source.
 * disputes.create is what enables accept_dispute_claim.
 */
export const BASELINE_ACTIONS = {
  orders: { get: true },
  payments: { createRefund: true, getRefunds: true },
  disputes: { list: true, get: true, create: true },
};

/**
 * ai@4's generateText sends temperature 0 when none is given ("TODO v5 remove default 0 for
 * temperature" in ai@4.3.19), and Haiku 5.5 / Sonnet 5.5 reject temperature 0 with a 400
 * (D1-6). temperature 1 is the API's default and is accepted, so this restores what the
 * API does when no temperature is sent, which is what the Pushover agent sends. The tools,
 * descriptions, schemas and loop are otherwise exactly PayPal's example (Path A).
 */
export const BASELINE_CALL_SETTINGS = { temperature: 1 } as const;

export interface BaselineDeps {
  db: Queryable;
  paypal: { clientId: string; clientSecret: string };
  anthropicApiKey: string;
  /** Injected so tests and fixtures control "days since delivery". */
  now: () => Date;
  /** Overrides BASELINE_CALL_SETTINGS; D1-6 uses {} to reproduce PayPal's example as-is. */
  callSettings?: { temperature?: number };
}

export interface BaselineToolCall {
  step: number;
  name: string;
  args: unknown;
  result: unknown;
}

export interface BaselineTurnResult {
  text: string;
  toolCalls: BaselineToolCall[];
  finishReason: string;
  usage: { inputTokens: number; outputTokens: number };
  /** Assistant and tool messages of this turn, so the next turn carries its tool calls (multi-turn eval items). */
  responseMessages: CoreMessage[];
}

export function createToolkit(paypal: BaselineDeps["paypal"]): PayPalAgentToolkit {
  return new PayPalAgentToolkit({
    clientId: paypal.clientId,
    clientSecret: paypal.clientSecret,
    configuration: { actions: BASELINE_ACTIONS, context: { sandbox: true } },
  });
}

export async function baselineTurn(
  deps: BaselineDeps,
  toolkit: PayPalAgentToolkit,
  ctx: { customerId: string; history: CoreMessage[]; userText: string; model: string },
): Promise<BaselineTurnResult> {
  const anthropic = createAnthropic({ apiKey: deps.anthropicApiKey });
  const lookup_my_orders = tool({
    description: "List the signed-in customer's own orders with items, totals, delivery dates, PayPal order and capture IDs.",
    parameters: z.object({}),
    // Same function the Pushover agent uses, plus the PayPal IDs the toolkit needs.
    execute: async () => lookupMyOrders(deps.db, { merchant: "BASELINE", customerId: ctx.customerId, now: deps.now(), includePayPalIds: true }),
  });

  const res = await generateText({
    model: anthropic(ctx.model),
    system: BASELINE_SYSTEM_PROMPT,
    messages: [...ctx.history, { role: "user", content: ctx.userText }],
    tools: { ...toolkit.getTools(), lookup_my_orders },
    maxSteps: MAX_STEPS,
    ...(deps.callSettings ?? BASELINE_CALL_SETTINGS),
  });

  const toolCalls: BaselineToolCall[] = res.steps.flatMap((s, step) =>
    s.toolCalls.map((c) => ({
      step,
      name: c.toolName,
      args: c.args,
      result: s.toolResults.find((r) => r.toolCallId === c.toolCallId)?.result,
    })),
  );
  return {
    text: res.text,
    toolCalls,
    finishReason: res.finishReason,
    usage: { inputTokens: res.usage.promptTokens, outputTokens: res.usage.completionTokens },
    responseMessages: res.response.messages,
  };
}
