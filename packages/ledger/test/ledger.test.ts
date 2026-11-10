import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { auditSample, canonical, commitmentDigest, inclusionProof, leafHash, merkleRoot, verifyInclusion, type Commitment, type DecisionLeaf } from "../src/ledger.ts";

const leaf = (i: number, over: Partial<DecisionLeaf> = {}): DecisionLeaf => ({
  claim: `c-${String(i).padStart(3, "0")}`, outcome: i % 3 ? "APPROVE" : "DENY", reason: i % 3 ? "APPROVED_PROOF" : "TAX_IMPLAUSIBLE", rule: i % 3 ? 8 : 1,
  version: "decision-v1", decidedBy: "rules", amountCents: i % 3 ? 1500 : null, evidenceSha256: "ab".repeat(32), findingsSha256: null,
  checks: { C1: "PASS", C4: i % 3 ? "PASS" : "FAIL" }, ...over,
});
const leaves = Array.from({ length: 11 }, (_, i) => leaf(i));
const RANDOMNESS = "25ae9ff34b07d5526d6cd59da4b113f829ad6b268c5e7d0fe4451ecb0977b537";

describe("canonical JSON", () => {
  it("is the same whatever order the keys came in", () => {
    expect(canonical({ b: 1, a: { d: [2, { y: 1, x: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[2,{"x":2,"y":1}]},"b":1}');
    expect(canonical({ a: 1, skip: undefined })).toBe('{"a":1}');
  });
});

describe("the Merkle root", () => {
  it("doesn't depend on the order leaves arrive in", () => {
    expect(merkleRoot([...leaves].reverse())).toBe(merkleRoot(leaves));
  });

  it("changes if any single field of any leaf changes", () => {
    const root = merkleRoot(leaves);
    const changes: Partial<DecisionLeaf>[] = [{ outcome: "APPROVE" }, { amountCents: 1501 }, { rule: 2 }, { evidenceSha256: "cd".repeat(32) }, { checks: { C1: "PASS", C4: "PASS" } }, { decidedBy: "analyst" }];
    for (const change of changes) {
      const tampered = leaves.map((l, i) => (i === 3 ? { ...l, ...change } : l));
      expect(merkleRoot(tampered), JSON.stringify(change)).not.toBe(root);
    }
    expect(merkleRoot(leaves.slice(1))).not.toBe(root); // dropping a claim
    expect(merkleRoot([...leaves, leaf(99)])).not.toBe(root); // slipping one in
  });

  it("proves each claim's leaf alone, and a changed leaf fails its proof", () => {
    const root = merkleRoot(leaves);
    for (const l of leaves) expect(verifyInclusion(l, inclusionProof(leaves, l.claim), root)).toBe(true);
    const l = leaves[4] as DecisionLeaf;
    expect(verifyInclusion({ ...l, amountCents: 99999 }, inclusionProof(leaves, l.claim), root)).toBe(false);
  });

  it("proofs hold for any number of leaves (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 60 }), fc.integer({ min: 0, max: 59 }), (n, pick) => {
        const ls = Array.from({ length: n }, (_, i) => leaf(i));
        const target = ls[pick % n] as DecisionLeaf;
        return verifyInclusion(target, inclusionProof(ls, target.claim), merkleRoot(ls));
      }),
      { numRuns: 300 },
    );
  });

  it("keeps leaves and inner nodes apart", () => {
    expect(leafHash(leaf(1))).toMatch(/^[0-9a-f]{64}$/);
    expect(merkleRoot([leaf(1)])).toBe(leafHash(leaf(1)));
  });
});

describe("the audit sample", () => {
  const root = merkleRoot(leaves);
  it("is fixed by the randomness and the root, and drawn from the ledger", () => {
    const s = auditSample(leaves, root, RANDOMNESS, 3);
    expect(s).toHaveLength(3);
    expect(new Set(s).size).toBe(3);
    expect(auditSample([...leaves].reverse(), root, RANDOMNESS, 3)).toEqual(s);
    for (const c of s) expect(leaves.map((l) => l.claim)).toContain(c);
  });
  it("changes with the randomness, so it couldn't be chosen in advance", () => {
    const other = `${RANDOMNESS.slice(0, -2)}00`;
    const draws = new Set([RANDOMNESS, other, "11".repeat(32), "22".repeat(32)].map((r) => auditSample(leaves, root, r, 3).join()));
    expect(draws.size).toBeGreaterThan(1);
  });
});

describe("the commitment digest", () => {
  it("covers every field", () => {
    const c: Commitment = {
      version: "poc-ledger-v1", settlementId: "s", kind: "CLAIMS", round: 1, planSha256: "aa".repeat(32), root: merkleRoot(leaves), leafCount: leaves.length,
      rules: { decisionTable: "11".repeat(32), taxTable: "22".repeat(32), settlement: "33".repeat(32) }, rulesSha256: "44".repeat(32),
      drand: { chain: "52db", round: 100 }, committedAt: "2026-11-10T00:00:00.000Z",
    };
    const d = commitmentDigest(c);
    expect(commitmentDigest({ ...c, drand: { ...c.drand, round: 101 } })).not.toBe(d);
    expect(commitmentDigest({ ...c, rules: { ...c.rules, taxTable: "23".repeat(32) } })).not.toBe(d);
    expect(commitmentDigest({ ...c, root: merkleRoot(leaves.slice(1)) })).not.toBe(d);
  });
});
