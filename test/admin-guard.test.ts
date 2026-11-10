// Every admin page and every admin server action checks the analyst session itself, before it
// reads anything. A Next.js layout is not enough: layouts don't re-run on every navigation, and
// server actions are POST endpoints that skip layouts entirely. This test reads the source, so a
// new page or action without the check fails CI.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ADMIN = "apps/web/app/(app)/admin";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(ADMIN);
const pages = files.filter((f) => f.endsWith("page.tsx"));
const actionFiles = files.filter((f) => /\.tsx?$/.test(f) && /^["']use server["'];/m.test(readFileSync(f, "utf8")));

/** Calls that read claim, settlement or money data. The guard must come before the first one. */
const DATA_CALL = /\b(settlement|desk|claimDetail|claimViews|claimView|money|pool|demoTruth|planDistribution|openProposal)\(/;

/** The body of `export default async function …(…) {` up to the end of the file. */
function defaultExportBody(src: string): string {
  const i = src.search(/export default async function \w+\(/);
  if (i < 0) throw new Error("no async default export");
  return src.slice(src.indexOf("{", src.indexOf(")", i)) + 1);
}

describe("admin pages and actions check the analyst session first", () => {
  it("finds the admin pages and actions it guards", () => {
    expect(pages.length).toBeGreaterThanOrEqual(3);
    expect(actionFiles.length).toBeGreaterThanOrEqual(2);
  });

  it.each(pages)("%s calls requireAnalyst before reading data", (file) => {
    const body = defaultExportBody(readFileSync(file, "utf8"));
    const guard = body.search(/await requireAnalyst\(/);
    const data = body.search(DATA_CALL);
    expect(guard, "no requireAnalyst call").toBeGreaterThanOrEqual(0);
    expect(data === -1 || guard < data, "data is read before the session is checked").toBe(true);
  });

  it.each(actionFiles)("every exported server action in %s starts with requireAnalyst", (file) => {
    const src = readFileSync(file, "utf8");
    const actions = [...src.matchAll(/export async function (\w+)\([^)]*\)[^\n]*\{\n([^\n]*)/g)];
    expect(actions.length).toBeGreaterThan(0);
    for (const [, name, firstLine] of actions) expect(firstLine, `${name} doesn't check the session first`).toMatch(/await requireAnalyst\(/);
  });

  it("the evidence route checks who is asking", () => {
    const src = readFileSync("apps/web/app/api/evidence/[id]/route.ts", "utf8");
    expect(src).toMatch(/currentAnalyst\(\)/);
    expect(src).toMatch(/mayView\(id\)/);
  });
});
