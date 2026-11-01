import { describe, expect, it } from "vitest";
import { costUsd } from "../src/cost.ts";

describe("costUsd", () => {
  it("prices Haiku 5.5 from the recorded list price and refuses an unknown model", () => {
    expect(costUsd("claude-haiku-5-5", { inputTokens: 10309, outputTokens: 406 })).toBeCloseTo(0.0012339, 7); // D1-6's turn ≈ $0.0012
    expect(() => costUsd("claude-unknown", { inputTokens: 1, outputTokens: 1 })).toThrow("no list price");
  });

  it("prices Sonnet 5.5 from the recorded list price", () => {
    expect(costUsd("claude-sonnet-5-5", { inputTokens: 1_000_000, outputTokens: 100_000 })).toBeCloseTo(3, 9);
  });
});
