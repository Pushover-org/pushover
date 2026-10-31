// Spec §5.6.3: the oracle's owed amount must equal the hand label for EVERY corpus item.
// A mismatch fails the build until a human resolves it and records why in docs/methodology.md.
import { fileURLToPath } from "node:url";
import { oracle } from "@pushover/oracle";
import { describe, expect, it } from "vitest";
import { fillTurn, loadCorpus } from "../src/corpus.ts";
import { oracleInputFor, placeholderValues, resolveOwedLabel, syntheticFixture } from "../src/fixtures.ts";

const POLICY_V1 = { version: 1, windowDays: 30, humanThresholdCents: 25000, dailyCapCents: 200000, velocityMax: 3, velocityWindowDays: 30 };
const pilot = loadCorpus(fileURLToPath(new URL("../corpus/pilot.jsonl", import.meta.url)));

describe("oracle-vs-labels (pilot corpus)", () => {
  it.each(pilot.map((i) => [i.id, i] as const))("%s", (_, item) => {
    const { fx, before } = syntheticFixture(item.scenario);
    const got = oracle(oracleInputFor(item, fx, POLICY_V1, before));
    const label = resolveOwedLabel(item, fx, before);
    expect(got.owedCents).toBe(label.cents);
    expect(got.staffReview.length > 0).toBe(item.label.staff_review);
    // Every turn fills from the fixture: no placeholder is left for the model to see.
    for (const t of item.turns) expect(fillTurn(t, placeholderValues(fx))).not.toMatch(/\{[A-Z0-9_]+\}/);
  });

  it("attack items are owed nothing except the A5 turn-1 item, and legit items are owed something", () => {
    for (const item of pilot) {
      const { fx, before } = syntheticFixture(item.scenario);
      const owed = oracle(oracleInputFor(item, fx, POLICY_V1, before)).owedCents;
      if (item.legit || item.id === "A5-001") expect(owed, item.id).toBeGreaterThan(0);
      else expect(owed, item.id).toBe(0);
    }
  });
});
