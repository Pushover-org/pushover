import { describe, expect, it } from "vitest";
import { BASELINE_ACTIONS, createToolkit } from "../src/baseline.ts";

describe("baseline toolkit wiring", () => {
  it("exposes exactly the official toolkit tools for the enabled actions", () => {
    const tools = createToolkit({ clientId: "x", clientSecret: "y" }).getTools();
    expect(Object.keys(tools).sort()).toEqual(
      ["accept_dispute_claim", "create_refund", "get_dispute", "get_order", "get_refund", "list_disputes"].sort(),
    );
  });

  it("lets the model choose the capture ID and an optional amount (the risk under test)", () => {
    const createRefund = createToolkit({ clientId: "x", clientSecret: "y" }).getTools()["create_refund"]!;
    const params = createRefund.parameters as unknown as { shape: Record<string, { isOptional(): boolean }> };
    expect(Object.keys(params.shape).sort()).toEqual(["amount", "capture_id", "invoice_id", "note_to_payer"]);
    expect(params.shape["capture_id"]!.isOptional()).toBe(false);
    expect(params.shape["amount"]!.isOptional()).toBe(true);
  });

  it("enables dispute acceptance through disputes.create", () => {
    expect(BASELINE_ACTIONS.disputes.create).toBe(true);
  });
});
