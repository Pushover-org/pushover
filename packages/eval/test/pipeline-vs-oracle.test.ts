// With a perfect reader, the real checks and decision table must reach the oracle's decision on
// every claim. A difference is a bug in packages/checks, packages/claims or the oracle. Image
// hashes are stand-ins: a copy the real hash catches gets its original's hash, any other image
// a distinct one (which copies the hash catches was measured in R4, docs/architecture.md).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSettlement } from "@proofofclaim/claims";
import { loadTaxTable, PROVISIONAL_CONFIG } from "@proofofclaim/checks";
import { perfectFindings } from "../src/corpus/perfect.ts";
import { ClaimSchema, readJsonl, ReceiptTruthSchema } from "../src/corpus/schema.ts";
import { RULES } from "../src/oracle/expected.ts";
import { runArmC, type Reading } from "../src/pipeline.ts";

const DIR = new URL("../corpus/claims-v1/", import.meta.url);
const claims = readJsonl(new URL("manifest.jsonl", DIR), ClaimSchema);
const receipts = new Map(readJsonl(new URL("receipts.jsonl", DIR), ReceiptTruthSchema).map((r) => [r.id, r]));
const settlement = parseSettlement(JSON.parse(readFileSync(new URL("settlement.json", DIR), "utf8")));

const bits = (seed: string) => [...createHash("sha256").update(seed).digest()].slice(0, 8).map((b) => b.toString(2).padStart(8, "0")).join("");
const readings = new Map<string, Reading>();
const hashes = new Map<string, string[]>();
for (const c of claims) {
  if (!c.evidence) continue;
  readings.set(c.id, { status: "OK", findings: perfectFindings(receipts.get(c.evidence.receipt)!) });
  const caught = c.evidence.variant !== null && (RULES.hashCaughtVariants as readonly string[]).includes(c.evidence.variant);
  const seed = caught || c.evidence.variant === null ? c.evidence.receipt : `${c.evidence.receipt}:${c.evidence.variant}`;
  hashes.set(c.id, [0, 90, 180, 270].map((a) => bits(`${seed}:${a}`)));
}
const results = runArmC({ claims, readings, hashes, settlement, table: loadTaxTable(), config: PROVISIONAL_CONFIG, networkSecret: "test" });

const got = (id: string) => {
  const d = results.get(id)!.decision;
  return { outcome: d.outcome, reason: d.reason, entitlement_cents: d.outcome === "APPROVE" ? d.entitlementCents : 0 };
};

describe("arm C with a perfect reader", () => {
  // The oracle knows which claims a bot farm filed; C7 has only the text. Where the spinner's
  // wording slips under the similarity threshold, C7 misses. Recorded 2026-11-01, before any
  // run, with the provisional threshold left unchanged (docs/methodology.md).
  const C7_MISSES = ["c-093", "c-106"];

  it.each(claims.filter((c) => !C7_MISSES.includes(c.id)).map((c) => [c.id, c] as const))("%s reaches the expected decision", (_id, c) => {
    expect(got(c.id)).toEqual(c.expected);
  });

  it("the bot claims C7 misses are exactly the recorded ones", () => {
    const misses = claims.filter((c) => c.group === "F5" && results.get(c.id)!.checks.find((x) => x.id === "C7")?.result !== "FAIL").map((c) => c.id);
    expect(misses).toEqual(C7_MISSES);
    expect(got("c-093").reason).toBe("VELOCITY_CLUSTER");
    expect(got("c-106").outcome).toBe("APPROVE");
  });
});
