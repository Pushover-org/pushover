// C6: perceptual hash. sharp-phash returns a 64-character 0/1 string. It hashes one orientation,
// so a claim is compared in all four.
import sharp from "sharp";
import phashModule from "sharp-phash";
import type { CheckResult } from "@proofofclaim/claims";

// The package is CommonJS and its types declare an ES default, so under Node's ESM loading the
// types and the runtime disagree. At runtime the default import is the function itself.
const phash = phashModule as unknown as (image: Buffer) => Promise<string>;

/** Bits that differ, as in the package's own distance.js. Unequal lengths are a programming error. */
export function hashDistance(a: string, b: string): number {
  if (a.length !== b.length) throw new Error("image hashes differ in length");
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

/** Different receipts in the real set come as close as 8, and a C6 FAIL denies (docs/architecture.md). */
export const MAX_ALLOWED_DISTANCE = 7;

export interface ImageHash {
  claimId: string;
  hash: string;
}

/** The hash of the image as stored (index 0), then at 90, 180 and 270 degrees. */
export async function hashRotations(bytes: Uint8Array): Promise<string[]> {
  // .rotate() with no angle applies the photo's stored orientation first.
  const upright = await sharp(bytes).rotate().png().toBuffer();
  const out: string[] = [];
  for (const angle of [0, 90, 180, 270]) {
    const rotated = angle === 0 ? upright : await sharp(upright).rotate(angle).png().toBuffer();
    out.push(await phash(rotated));
  }
  return out;
}

export function checkDuplicateImage(claimId: string, rotations: string[] | null, earlier: ImageHash[] | null, maxDistance: number): CheckResult {
  if (!Number.isInteger(maxDistance) || maxDistance < 0 || maxDistance > MAX_ALLOWED_DISTANCE) throw new Error(`C6 threshold must be 0..${MAX_ALLOWED_DISTANCE}, got ${maxDistance}`);
  if (rotations === null || rotations.length === 0) return { id: "C6", result: "UNKNOWN", detail: "image hash not available" };
  if (earlier === null) return { id: "C6", result: "UNKNOWN", detail: "lookup failed" };
  let best: { claimId: string; d: number } | null = null;
  for (const e of earlier) {
    if (e.claimId === claimId) continue;
    for (const r of rotations) {
      const d = hashDistance(r, e.hash);
      if (best === null || d < best.d) best = { claimId: e.claimId, d };
    }
  }
  if (best !== null && best.d <= maxDistance) return { id: "C6", result: "FAIL", detail: `distance ${best.d} from the image on claim ${best.claimId}` };
  return { id: "C6", result: "PASS", detail: best === null ? "no earlier images" : `closest earlier image is distance ${best.d}` };
}
