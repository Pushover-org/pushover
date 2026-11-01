// AI spend per call, from list prices in USD per 1M tokens (input/output) recorded in
// docs/architecture.md → AI models (Haiku 5.5 price holds for prompts up to 100K tokens).
// An unknown model is an error: a cost is never guessed.
const PRICE_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
};

export function costUsd(model: string, usage: { inputTokens: number; outputTokens: number }): number {
  const p = PRICE_PER_MTOK[model];
  if (!p) throw new Error(`no list price recorded for ${model}; add it from Anthropic's pricing page first`);
  return (usage.inputTokens * p.input + usage.outputTokens * p.output) / 1_000_000;
}
