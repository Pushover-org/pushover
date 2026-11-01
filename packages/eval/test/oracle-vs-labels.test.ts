// The labels must match the rules as written (spec §5.1). The expected decision in the manifest
// comes from each group's intent and the builder's listed exceptions; the oracle works it out
// again from the receipts' truth with its own code. Any difference is a mistake in one of them.
import { describe, expect, it } from "vitest";
import { ClaimSchema, readJsonl, ReceiptTruthSchema } from "../src/corpus/schema.ts";
import { expectedDecisions, OracleSettlementSchema, readTaxTable } from "../src/oracle/expected.ts";
import { readFileSync } from "node:fs";

const DIR = new URL("../corpus/claims-v1/", import.meta.url);
const claims = readJsonl(new URL("manifest.jsonl", DIR), ClaimSchema);
const receipts = new Map(readJsonl(new URL("receipts.jsonl", DIR), ReceiptTruthSchema).map((r) => [r.id, r]));
const settlement = OracleSettlementSchema.parse(JSON.parse(readFileSync(new URL("settlement.json", DIR), "utf8")));
const tax = readTaxTable(new URL("../../../data/tax-rates.json", import.meta.url));
const oracle = expectedDecisions(claims, receipts, settlement, tax);

describe("claims-v1 labels", () => {
  it.each(claims.map((c) => [c.id, c] as const))("%s matches the oracle", (_id, c) => {
    expect({ ...oracle.get(c.id), group: c.group }).toEqual({ ...c.expected, group: c.group });
  });

  it("ids and filing order are consistent", () => {
    expect(new Set(claims.map((c) => c.id)).size).toBe(claims.length);
    claims.forEach((c, i) => expect(c.seq).toBe(i + 1));
    for (const c of claims) {
      if (c.evidence) expect(receipts.has(c.evidence.receipt), c.id).toBe(true);
      if (c.duplicate_of) expect(claims.find((o) => o.id === c.duplicate_of)!.seq).toBeLessThan(c.seq);
    }
  });

  it("honest means honest and fraud means fraud by group", () => {
    for (const c of claims) {
      const want = c.group.startsWith("H") ? "honest" : c.group.startsWith("X") ? "ineligible" : "fraud";
      expect(c.truth, c.id).toBe(want);
    }
  });

  it("no claim the other laptop already looked at is in the pilot or holdout", () => {
    expect(claims.filter((c) => c.seen_before_design && c.split !== "dev").map((c) => c.id)).toEqual([]);
  });
});
