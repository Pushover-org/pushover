// The claimant's PayPal payer ID at rest (docs/architecture.md → Claimant privacy; plan P4, P5).
// - pseudonymOf: HMAC-SHA256 under a per-settlement key derived from PAYER_PSEUDONYM_KEY. It
//   enforces one claim per PayPal account and is all any screen, report or payout record shows.
//   The same account gets unrelated pseudonyms in two settlements.
// - sealPayerId / openPayerId: AES-256-GCM under PAYER_SEAL_KEY, with the settlement and claim as
//   associated data, so a sealed value moved to another claim fails to open.
// openPayerId is not exported from the package: only payout.ts imports it, to address a payment
// (test/identity-boundary.test.ts).
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

export interface IdentityKeys {
  /** 32 bytes, AES-256-GCM. */
  seal: Buffer;
  /** 32 bytes, HMAC-SHA256. */
  pseudonym: Buffer;
}

const VERSION = 1;
const PAYER_ID = /^[2-9A-HJ-NP-Z]{13}$/;

/** Both keys from the environment, base64, 32 bytes each. Throws, naming the variable, if either is missing or the wrong size. */
export function identityKeysFromEnv(env: Record<string, string | undefined> = process.env): IdentityKeys {
  const read = (name: string): Buffer => {
    const v = env[name];
    if (!v) throw new Error(`missing environment variable ${name} (32 random bytes, base64)`);
    const b = Buffer.from(v, "base64");
    if (b.length !== 32) throw new Error(`${name} must be 32 bytes, base64 (got ${b.length})`);
    return b;
  };
  return { seal: read("PAYER_SEAL_KEY"), pseudonym: read("PAYER_PSEUDONYM_KEY") };
}

export function pseudonymOf(keys: IdentityKeys, settlementId: string, payerId: string): string {
  const perSettlement = createHmac("sha256", keys.pseudonym).update(`settlement:${settlementId}`).digest();
  return createHmac("sha256", perSettlement).update(payerId).digest("hex");
}

const aad = (settlementId: string, claimId: string) => Buffer.from(`poc-payer-id:v${VERSION}:${settlementId}:${claimId}`);

export function sealPayerId(keys: IdentityKeys, settlementId: string, claimId: string, payerId: string): Buffer {
  if (!PAYER_ID.test(payerId)) throw new Error("not a PayPal payer ID");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keys.seal, iv);
  c.setAAD(aad(settlementId, claimId));
  const body = Buffer.concat([c.update(payerId, "utf8"), c.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, c.getAuthTag(), body]);
}

export function openPayerId(keys: IdentityKeys, settlementId: string, claimId: string, sealed: Buffer): string {
  if (sealed[0] !== VERSION || sealed.length < 1 + 12 + 16 + 1) throw new Error("not a sealed payer ID");
  const d = createDecipheriv("aes-256-gcm", keys.seal, sealed.subarray(1, 13));
  d.setAAD(aad(settlementId, claimId));
  d.setAuthTag(sealed.subarray(13, 29));
  const payerId = Buffer.concat([d.update(sealed.subarray(29)), d.final()]).toString("utf8");
  if (!PAYER_ID.test(payerId)) throw new Error("sealed value is not a PayPal payer ID");
  return payerId;
}
