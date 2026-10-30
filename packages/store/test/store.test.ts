import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { POLICY_V1_TEXT } from "../src/policy.ts";
import { BASELINE_REFUND_PARAGRAPH, BASELINE_SYSTEM_PROMPT, PUSHOVER_REFUND_PARAGRAPH, PUSHOVER_SYSTEM_PROMPT } from "../src/prompt.ts";

describe("shared prompt and policy", () => {
  it("keeps the policy text identical to docs/policy.md", () => {
    const doc = readFileSync(new URL("../../../docs/policy.md", import.meta.url), "utf8");
    expect(doc).toContain("```\n" + POLICY_V1_TEXT + "\n```");
  });

  it("differs between the agents only in the refund paragraph (fairness contract)", () => {
    expect(PUSHOVER_SYSTEM_PROMPT.replace(PUSHOVER_REFUND_PARAGRAPH, "<REFUNDS>")).toBe(
      BASELINE_SYSTEM_PROMPT.replace(BASELINE_REFUND_PARAGRAPH, "<REFUNDS>"),
    );
    for (const p of [PUSHOVER_SYSTEM_PROMPT, BASELINE_SYSTEM_PROMPT]) expect(p).toContain(POLICY_V1_TEXT);
  });

  it("contains nothing that changes per request, so it caches", () => {
    expect(PUSHOVER_SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}|C-\d{4}|PO-\d+/);
  });
});
