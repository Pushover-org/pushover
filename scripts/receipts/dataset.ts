// The ExpressExpense SRD receipt images (owner decision 2026-11-01, docs/architecture.md).
// The images are never committed: scripts/receipts/download.ts fetches and checks them.
import { createHash } from "node:crypto";

export const DATASET = {
  zipUrl: "https://expressexpense.com/large-receipt-image-dataset-SRD.zip",
  md5: "c8eb0f2d286da5ab742e7a5b59f15147",
  files: 200,
  outDir: ".data/receipts/expressexpense",
} as const;

export function md5Of(bytes: Uint8Array): string {
  return createHash("md5").update(bytes).digest("hex");
}

/** A corrupted or changed zip must never reach the eval: the labels describe these exact bytes. */
export function assertMd5(bytes: Uint8Array, expected: string): void {
  const got = md5Of(bytes);
  if (got !== expected) throw new Error(`receipt zip md5 is ${got}, expected ${expected}; not unzipping it`);
}

/** Every entry must be a plain receipt image at the top of the zip, so nothing lands outside outDir. */
export function assertSafeEntries(names: string[]): void {
  const bad = names.filter((n) => !/^\d+-receipt\.jpg$/.test(n));
  if (bad.length) throw new Error(`unexpected zip entries: ${bad.slice(0, 5).join(", ")}`);
}
