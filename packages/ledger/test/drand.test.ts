import { describe, expect, it } from "vitest";
import { roundAt, roundTime, verifyBeacon, type Beacon } from "../src/drand.ts";

// Fetched from https://api.drand.sh/52db9ba7…e971/public/33829302 on 2026-11-10.
const REAL: Beacon = {
  round: 33829302,
  randomness: "25ae9ff34b07d5526d6cd59da4b113f829ad6b268c5e7d0fe4451ecb0977b537",
  signature: "b1053a1468736f65fe1e772b96d16df1ed6af4928ffdb4fb7f9c2444ffabb808f364bf702c43d84d8ccfb9f89506b278",
};

describe("drand quicknet", () => {
  it("verifies a real beacon against quicknet's public key", () => {
    expect(verifyBeacon(REAL)).toBe(true);
  });

  it("refuses the same signature for another round, changed randomness, or a flipped signature byte", () => {
    expect(verifyBeacon({ ...REAL, round: REAL.round + 1 })).toBe(false);
    expect(verifyBeacon({ ...REAL, randomness: `${REAL.randomness.slice(0, -1)}8` })).toBe(false);
    const flipped = `${REAL.signature.slice(0, 10)}${REAL.signature[10] === "0" ? "1" : "0"}${REAL.signature.slice(11)}`;
    expect(verifyBeacon({ ...REAL, signature: flipped })).toBe(false);
    expect(verifyBeacon({ ...REAL, signature: "zz" })).toBe(false);
  });

  it("maps times to rounds and back (3-second rounds from genesis)", () => {
    const t = roundTime(REAL.round);
    expect(roundAt(t)).toBe(REAL.round);
    expect(roundAt(new Date(t.getTime() + 2_999))).toBe(REAL.round);
    expect(roundAt(new Date(t.getTime() + 3_000))).toBe(REAL.round + 1);
  });
});
