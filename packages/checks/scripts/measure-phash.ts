// node packages/checks/scripts/measure-phash.ts, from the repo root. How far C6's hash moves for copies of real
// receipts, against how close different receipts come. Uses the git-ignored images; spends nothing.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { hashDistance, hashRotations } from "../src/image-hash.ts";
import { DATASET } from "../../../scripts/receipts/dataset.ts";

const dups = JSON.parse(readFileSync("data/receipts/expressexpense-duplicates.json", "utf8")) as { groups: { keep: string; exclude: string[] }[] };
const excluded = new Set(dups.groups.flatMap((g) => g.exclude));
const files = readdirSync(DATASET.outDir).filter((f) => f.endsWith(".jpg") && !excluded.has(f)).sort();

async function variants(b: Buffer): Promise<Record<string, Buffer>> {
  const { width = 1, height = 1 } = await sharp(b).metadata();
  const crop = (p: number) => sharp(b).extract({ left: Math.floor(width * p), top: Math.floor(height * p), width: Math.floor(width * (1 - 2 * p)), height: Math.floor(height * (1 - 2 * p)) }).toBuffer();
  return {
    "jpeg q40": await sharp(b).jpeg({ quality: 40 }).toBuffer(),
    "half size": await sharp(b).resize(Math.max(8, Math.floor(width / 2))).toBuffer(),
    "rotated 90": await sharp(b).rotate(90).toBuffer(),
    "rotated 180": await sharp(b).rotate(180).toBuffer(),
    "tilted 2 deg": await sharp(b).rotate(2, { background: "white" }).toBuffer(),
    "tilted 5 deg": await sharp(b).rotate(5, { background: "white" }).toBuffer(),
    "crop 3% each side": await crop(0.03),
    "crop 8% each side": await crop(0.08),
    "crop 15% each side": await crop(0.15),
  };
}

const upright = new Map<string, string>();
const all = new Map<string, string[]>();
for (const f of files) {
  const r = await hashRotations(readFileSync(join(DATASET.outDir, f)));
  all.set(f, r);
  upright.set(f, r[0] as string);
}
const copies: Record<string, number[]> = {};
for (const f of files) {
  const v = await variants(readFileSync(join(DATASET.outDir, f)));
  for (const [name, bytes] of Object.entries(v)) {
    const d = Math.min(...(await hashRotations(bytes)).map((h) => hashDistance(h, upright.get(f) as string)));
    (copies[name] ??= []).push(d);
  }
}
const nearest: number[] = [];
for (const a of files) {
  let best = 64;
  for (const b of files) if (a !== b) best = Math.min(best, ...(all.get(a) as string[]).map((h) => hashDistance(h, upright.get(b) as string)));
  nearest.push(best);
}
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)];
console.log(`${files.length} receipts after removing known copies`);
console.log("copies: distance from the original (best of 4 rotations). 'within N' = share a threshold of N would catch");
for (const [k, xs] of Object.entries(copies)) {
  const w = (n: number) => `${Math.round((100 * xs.filter((x) => x <= n).length) / xs.length)}%`;
  console.log(`  ${k.padEnd(20)} median ${pct(xs, 0.5)}  p90 ${pct(xs, 0.9)}  max ${Math.max(...xs)}  within 2: ${w(2)}  within 4: ${w(4)}  within 6: ${w(6)}  within 7: ${w(7)}`);
}
const within = (n: number) => nearest.filter((x) => x <= n).length;
console.log(`different receipts: nearest other receipt (any rotation), min ${Math.min(...nearest)}, median ${pct(nearest, 0.5)}`);
for (const n of [2, 4, 6, 7, 8, 10]) console.log(`  threshold ${n}: ${within(n)} of ${nearest.length} receipts would wrongly match another receipt`);
