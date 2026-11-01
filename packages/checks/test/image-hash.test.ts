import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { checkDuplicateImage, hashDistance, hashRotations } from "../src/image-hash.ts";

/** A receipt-like picture made of blocks, from a seed, so tests need no real photo. */
async function picture(seed: number, w = 240, h = 400): Promise<Buffer> {
  const raw = Buffer.alloc(w * h, 255);
  let s = seed;
  const next = () => (s = (s * 1103515245 + 12345) & 0x7fffffff);
  for (let i = 0; i < 40; i++) {
    const [x, y, bw, bh, v] = [next() % w, next() % h, 10 + (next() % 90), 5 + (next() % 40), next() % 200];
    for (let yy = y; yy < Math.min(h, y + bh); yy++) raw.fill(v, yy * w + x, yy * w + Math.min(w, x + bw));
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer();
}

describe("hashRotations on real image bytes", () => {
  it("returns 4 hashes of 64 bits, and the same image gives the same hashes", async () => {
    const img = await picture(1);
    const a = await hashRotations(img);
    expect(a).toHaveLength(4);
    for (const h of a) expect(h).toMatch(/^[01]{64}$/);
    expect(await hashRotations(img)).toEqual(a);
  });
  it.each([90, 180, 270])("a copy rotated %i degrees matches at distance 0-2", async (angle) => {
    const img = await picture(2);
    const stored = (await hashRotations(img))[0] as string;
    const rotated = await sharp(img).rotate(angle).png().toBuffer();
    const best = Math.min(...(await hashRotations(rotated)).map((h) => hashDistance(h, stored)));
    expect(best).toBeLessThanOrEqual(2);
  });
  it("a recompressed copy stays close", async () => {
    const img = await picture(3);
    const copy = await sharp(img).jpeg({ quality: 40 }).toBuffer();
    expect(hashDistance((await hashRotations(copy))[0] as string, (await hashRotations(img))[0] as string)).toBeLessThanOrEqual(4);
  });
  it("a different picture is far away", async () => {
    const a = (await hashRotations(await picture(4)))[0] as string;
    const b = await hashRotations(await picture(99));
    expect(Math.min(...b.map((h) => hashDistance(h, a)))).toBeGreaterThan(7);
  });
  it("applies a photo's stored orientation before hashing", async () => {
    const img = await picture(5);
    const tagged = await sharp(img).withMetadata({ orientation: 6 }).jpeg({ quality: 95 }).toBuffer();
    const upright = await sharp(tagged).rotate().png().toBuffer();
    expect(hashDistance((await hashRotations(tagged))[0] as string, (await hashRotations(upright))[0] as string)).toBeLessThanOrEqual(2);
  });
});

describe("C6", () => {
  const a = "0".repeat(64);
  const near = "1".repeat(4) + "0".repeat(60);
  const far = "1".repeat(32) + "0".repeat(32);
  it("fails within the threshold, against any rotation", () => {
    expect(checkDuplicateImage("c1", [far, near], [{ claimId: "c0", hash: a }], 4)).toMatchObject({ result: "FAIL", detail: expect.stringContaining("c0") });
  });
  it("passes beyond the threshold", () => expect(checkDuplicateImage("c1", [far], [{ claimId: "c0", hash: a }], 4).result).toBe("PASS"));
  it("does not match a claim against itself", () => expect(checkDuplicateImage("c0", [a], [{ claimId: "c0", hash: a }], 4).result).toBe("PASS"));
  it("no hash or a failed lookup is UNKNOWN", () => {
    expect(checkDuplicateImage("c1", null, [], 4).result).toBe("UNKNOWN");
    expect(checkDuplicateImage("c1", [], [], 4).result).toBe("UNKNOWN");
    expect(checkDuplicateImage("c1", [a], null, 4).result).toBe("UNKNOWN");
  });
  it("refuses a threshold of 8 or more: different receipts in the real set come that close", () => {
    expect(() => checkDuplicateImage("c1", [a], [], 8)).toThrow("0..7");
    expect(() => checkDuplicateImage("c1", [a], [], 7)).not.toThrow();
  });
});
