// Writes every claim's evidence image for claims-v1 into the git-ignored .data/claims-v1/:
// real photos (after `pnpm receipts:download`), F4 copies made the way R4 measured the image
// hash (packages/checks/scripts/measure-phash.ts), and rendered receipts. No model, no credit.
// From the repo root:  node packages/eval/scripts/materialise-claims-v1.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { renderReceipt } from "../src/corpus/render.ts";
import { ClaimSchema, readJsonl, ReceiptTruthSchema, type CopyVariant } from "../src/corpus/schema.ts";

const DIR = new URL("../corpus/claims-v1/", import.meta.url);
const SRC = ".data/receipts/expressexpense";
const OUT = ".data/claims-v1";

async function copy(b: Buffer, v: CopyVariant): Promise<Buffer> {
  const { width = 0, height = 0 } = await sharp(b).metadata();
  const crop = (p: number) => sharp(b).extract({ left: Math.floor(width * p), top: Math.floor(height * p), width: Math.floor(width * (1 - 2 * p)), height: Math.floor(height * (1 - 2 * p)) });
  const img = {
    recompress: () => sharp(b).jpeg({ quality: 40 }),
    half_size: () => sharp(b).resize(Math.max(8, Math.floor(width / 2))),
    rot90: () => sharp(b).rotate(90),
    rot180: () => sharp(b).rotate(180),
    rot270: () => sharp(b).rotate(270),
    crop3: () => crop(0.03),
    crop8: () => crop(0.08),
    tilt2: () => sharp(b).rotate(2, { background: "white" }),
    tilt5: () => sharp(b).rotate(5, { background: "white" }),
  }[v]();
  return img.jpeg({ quality: v === "recompress" ? 40 : 90 }).toBuffer();
}

const claims = readJsonl(new URL("manifest.jsonl", DIR), ClaimSchema);
const receipts = new Map(readJsonl(new URL("receipts.jsonl", DIR), ReceiptTruthSchema).map((r) => [r.id, r]));
mkdirSync(OUT, { recursive: true });
let n = 0;
for (const c of claims) {
  if (!c.evidence) continue;
  const r = receipts.get(c.evidence.receipt);
  if (!r) throw new Error(`${c.id}: no truth for ${c.evidence.receipt}`);
  let img: Buffer;
  if (r.source === "render") img = await renderReceipt(r);
  else {
    const photo = readFileSync(`${SRC}/${r.id.slice(4)}-receipt.jpg`);
    img = c.evidence.variant ? await copy(photo, c.evidence.variant) : photo;
  }
  writeFileSync(`${OUT}/${c.id}.jpg`, img);
  n++;
}
console.log(`wrote ${n} evidence images to ${OUT}/`);
