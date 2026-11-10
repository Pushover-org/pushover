// The rules in force, by hash (plan item C2): the decision table's source and the tax table, as
// deployed. Committed with every ledger, so anyone can compare them with the public repository.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

export const RULE_FILES = { decisionTable: "packages/claims/src/decision-v1.ts", taxTable: "data/tax-rates.json" } as const;

let cached: { decisionTable: string; taxTable: string } | null | undefined;

/** Null if either file can't be read: then the ledger can't be committed and no money is sent. */
export function rulesFiles(): { decisionTable: string; taxTable: string } | null {
  if (cached !== undefined) return cached;
  try {
    const hash = (rel: string) => createHash("sha256").update(readFileSync(path.resolve(process.cwd(), "../..", rel))).digest("hex");
    cached = { decisionTable: hash(RULE_FILES.decisionTable), taxTable: hash(RULE_FILES.taxTable) };
  } catch {
    cached = null;
  }
  return cached;
}
