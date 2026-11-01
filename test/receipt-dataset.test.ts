import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertMd5, assertSafeEntries, md5Of } from "../scripts/receipts/dataset.ts";

const bytes = new TextEncoder().encode("receipt");

describe("receipt dataset download", () => {
  it("accepts the expected md5 and refuses any other", () => {
    expect(() => assertMd5(bytes, md5Of(bytes))).not.toThrow();
    expect(() => assertMd5(new TextEncoder().encode("edited"), md5Of(bytes))).toThrow("not unzipping");
  });

  it("refuses zip entries that are not top-level receipt images", () => {
    expect(() => assertSafeEntries(["1000-receipt.jpg", "1199-receipt.jpg"])).not.toThrow();
    for (const bad of ["../1000-receipt.jpg", "sub/1000-receipt.jpg", "run.sh", "/etc/passwd"]) {
      expect(() => assertSafeEntries([bad])).toThrow("unexpected zip entries");
    }
  });

  it("lists each known duplicate once, and keeps one file from every group", () => {
    const { groups } = JSON.parse(readFileSync("data/receipts/expressexpense-duplicates.json", "utf8")) as {
      groups: { keep: string; exclude: string[] }[];
    };
    const all = groups.flatMap((g) => [g.keep, ...g.exclude]);
    expect(new Set(all).size).toBe(all.length);
    expect(groups.map((g) => g.keep).sort()).toEqual(["1034-receipt.jpg", "1186-receipt.jpg"]);
  });
});
