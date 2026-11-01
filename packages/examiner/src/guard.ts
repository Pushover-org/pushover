// Cost guard: stops before a call that could pass the budget. Credit is prepaid and small, and a
// live demo must not be able to drain it.
import { costUsd } from "./cost.ts";

export class BudgetExceededError extends Error {
  constructor(spent: number, reserve: number, limit: number) {
    super(`AI budget: spent $${spent.toFixed(4)}, next call could cost $${reserve.toFixed(4)}, limit $${limit}`);
    this.name = "BudgetExceededError";
  }
}

export class CostGuard {
  private spentUsd: number;
  readonly limitUsd: number;

  constructor(limitUsd: number, spentUsd = 0) {
    if (!(limitUsd > 0)) throw new Error(`budget must be above zero, got ${limitUsd}`);
    this.limitUsd = limitUsd;
    this.spentUsd = spentUsd;
  }

  get spent(): number {
    return this.spentUsd;
  }

  /** The most this call can cost: output is capped by max_tokens; input is a generous estimate. */
  static reserveFor(model: string, maxTokens: number, inputTokensEstimate = 8000): number {
    return costUsd(model, { inputTokens: inputTokensEstimate, outputTokens: maxTokens });
  }

  check(reserveUsd: number): void {
    if (this.spentUsd + reserveUsd > this.limitUsd) throw new BudgetExceededError(this.spentUsd, reserveUsd, this.limitUsd);
  }

  record(usd: number): void {
    this.spentUsd += usd;
  }
}
