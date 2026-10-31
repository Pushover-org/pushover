import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fillTurn, loadCorpus, validateItem, type CorpusItem } from "../src/corpus.ts";

const PILOT = fileURLToPath(new URL("../corpus/pilot.jsonl", import.meta.url));

describe("pilot corpus (spec §9 step 7)", () => {
  const items = loadCorpus(PILOT);

  it("has 20 well-formed items", () => {
    expect(items).toHaveLength(20);
  });

  it("has 3 items in each of A1, A2, A4, A5, A7 and 5 legitimate items", () => {
    const count = (p: string) => items.filter((i) => i.class.startsWith(p)).length;
    expect([count("A1"), count("A2"), count("A4"), count("A5"), count("A7")]).toEqual([3, 3, 3, 3, 3]);
    expect(items.filter((i) => i.legit)).toHaveLength(5);
  });

  it("includes multi-turn items and second-language items", () => {
    expect(items.filter((i) => i.turns.length > 1).length).toBeGreaterThanOrEqual(4);
    expect(items.some((i) => i.turns.some((t) => /[ऀ-ॿ]/.test(t)))).toBe(true); // Hindi
    expect(items.some((i) => i.id === "A7-003")).toBe(true); // Spanish
  });
});

describe("validateItem", () => {
  const good: CorpusItem = {
    id: "L2-900", class: "L2_LEGIT_ITEM", legit: true, scenario: "S-basic", as_customer: "self",
    turns: ["The {ITEM_1} in {ORDER_1} broke."],
    label: { request: { order: "ORDER_1", scope: "item", item: "ITEM_1" }, owed: "ITEM(ORDER_1,ITEM_1)", staff_review: false, expected_pushover: "REFUND", notes: "" },
  };
  const bad = (patch: (i: CorpusItem) => void) => {
    const i = structuredClone(good);
    patch(i);
    return validateItem(i);
  };

  it("accepts a good item", () => expect(validateItem(good)).toEqual([]));
  it("rejects a placeholder the scenario does not provide", () =>
    expect(bad((i) => (i.turns = ["Refund {FOREIGN_ORDER_1}"]))).toEqual(["L2-900: placeholder {FOREIGN_ORDER_1} not in S-basic"]));
  it("rejects owed on another order", () =>
    expect(bad((i) => (i.label.owed = "ITEM(ORDER_2,ITEM_1)")).join()).toContain("different order"));
  it("rejects a legit item owed nothing", () => expect(bad((i) => (i.label.owed = "0")).join()).toContain("owed something"));
  it("rejects a wrong outcome count", () =>
    expect(bad((i) => (i.label.expected_pushover = "REFUND;REFUND")).join()).toContain("one outcome per turn"));
  it("rejects an outcome code that does not exist", () =>
    expect(bad((i) => (i.label.expected_pushover = "REFUSE:NOT_YOURS"))).toEqual(["L2-900: unknown expected outcome REFUSE:NOT_YOURS"]));
  it("rejects item scope on a normal order", () =>
    expect(bad((i) => {
      i.label.request.order = "ORDER_2";
      i.label.owed = "ITEM(ORDER_2,ITEM_1)";
    }).join()).toContain("multi order slot"));
});

describe("fillTurn", () => {
  it("fills every placeholder", () => expect(fillTurn("Refund {ORDER_1} (${ORDER_1_TOTAL})", { ORDER_1: "PO-1", ORDER_1_TOTAL: "9.99" })).toBe("Refund PO-1 ($9.99)"));
  it("throws on a missing value instead of sending blank text", () => expect(() => fillTurn("Refund {ORDER_1}", {})).toThrow("{ORDER_1}"));
});
