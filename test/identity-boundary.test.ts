// A sealed PayPal payer ID is opened in exactly one place: the payout code, to address a payment
// (plan item P4, docs/architecture.md → Claimant privacy). This test reads the source, so any new
// caller of openPayerId, or an export that would let the web app reach it, fails CI.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    if (f === "node_modules" || f === ".next" || f.startsWith(".")) return [];
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|js|mjs)$/.test(f) ? [p] : [];
  });
}

const source = [...walk("packages"), ...walk("apps"), ...walk("scripts")].filter((f) => !/\/test\/|\.test\.ts$|\/e2e\//.test(f));

describe("only the payout code opens a sealed payer ID", () => {
  it("scans the source it guards", () => {
    expect(source.length).toBeGreaterThan(50);
  });

  it("openPayerId appears only where it's defined and in payout.ts", () => {
    const users = source.filter((f) => readFileSync(f, "utf8").includes("openPayerId")).sort();
    expect(users).toEqual(["packages/desk/src/payer-id.ts", "packages/desk/src/payout.ts"]);
  });

  it("the desk package doesn't export it", () => {
    const index = readFileSync("packages/desk/src/index.ts", "utf8");
    expect(index).not.toMatch(/export[^;]*\bopenPayerId\b/);
    expect(index).not.toMatch(/export \* from "\.\/payer-id\.ts"/);
  });
});
