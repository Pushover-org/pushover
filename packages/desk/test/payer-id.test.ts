import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { identityKeysFromEnv, openPayerId, pseudonymOf, sealPayerId, type IdentityKeys } from "../src/payer-id.ts";

const keys: IdentityKeys = { seal: randomBytes(32), pseudonym: randomBytes(32) };
const DANA = "QYR5Z8XDVJNXQ";

describe("sealed payer IDs", () => {
  it("opens to the payer ID it sealed, and never stores it in the clear", () => {
    const sealed = sealPayerId(keys, "s1", "c1", DANA);
    expect(sealed.includes(Buffer.from(DANA))).toBe(false);
    expect(openPayerId(keys, "s1", "c1", sealed)).toBe(DANA);
  });

  it("seals the same ID differently each time (a fresh IV)", () => {
    expect(sealPayerId(keys, "s1", "c1", DANA).equals(sealPayerId(keys, "s1", "c1", DANA))).toBe(false);
  });

  it("won't open under another claim or settlement, a changed byte, or another key", () => {
    const sealed = sealPayerId(keys, "s1", "c1", DANA);
    expect(() => openPayerId(keys, "s1", "c2", sealed)).toThrow();
    expect(() => openPayerId(keys, "s2", "c1", sealed)).toThrow();
    const flipped = Buffer.from(sealed);
    flipped[flipped.length - 1] = (flipped[flipped.length - 1] ?? 0) ^ 1;
    expect(() => openPayerId(keys, "s1", "c1", flipped)).toThrow();
    expect(() => openPayerId({ ...keys, seal: randomBytes(32) }, "s1", "c1", sealed)).toThrow();
  });

  it("refuses to seal something that isn't a payer ID", () => {
    expect(() => sealPayerId(keys, "s1", "c1", "dana@example.com")).toThrow("not a PayPal payer ID");
  });
});

describe("pseudonyms", () => {
  it("are stable within a settlement and unrelated across settlements", () => {
    const a = pseudonymOf(keys, "settlement-a", DANA);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(pseudonymOf(keys, "settlement-a", DANA)).toBe(a);
    expect(pseudonymOf(keys, "settlement-b", DANA)).not.toBe(a);
    expect(pseudonymOf(keys, "settlement-a", "ABCDEFGHJKLM2")).not.toBe(a);
  });

  it("depend on the key, so nobody without it can test a guessed payer ID", () => {
    expect(pseudonymOf({ ...keys, pseudonym: randomBytes(32) }, "settlement-a", DANA)).not.toBe(pseudonymOf(keys, "settlement-a", DANA));
  });
});

describe("keys from the environment", () => {
  const b64 = () => randomBytes(32).toString("base64");
  it("reads two 32-byte base64 keys", () => {
    const k = identityKeysFromEnv({ PAYER_SEAL_KEY: b64(), PAYER_PSEUDONYM_KEY: b64() });
    expect(k.seal).toHaveLength(32);
    expect(k.pseudonym).toHaveLength(32);
  });
  it("names the missing or short variable", () => {
    expect(() => identityKeysFromEnv({ PAYER_PSEUDONYM_KEY: b64() })).toThrow("PAYER_SEAL_KEY");
    expect(() => identityKeysFromEnv({ PAYER_SEAL_KEY: b64(), PAYER_PSEUDONYM_KEY: randomBytes(16).toString("base64") })).toThrow("must be 32 bytes");
  });
});
