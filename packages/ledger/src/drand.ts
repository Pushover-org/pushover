// drand quicknet, read from its own relays and checked with its own public key (plan items P33,
// P43). Values were read from https://api.drand.sh/chains and /<hash>/info on 2026-11-10.
// Runs the same in Node and in the browser: @noble/curves and @noble/hashes only.
import { bls12_381 } from "@noble/curves/bls12-381.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

export const QUICKNET = {
  hash: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
  publicKey:
    "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a",
  period: 3,
  genesisTime: 1692803367,
  scheme: "bls-unchained-g1-rfc9380",
  relays: ["https://api.drand.sh", "https://api2.drand.sh", "https://api3.drand.sh", "https://drand.cloudflare.com"],
} as const;

/** RFC 9380's hash-to-G1 tag for BLS signatures, as the scheme name says. */
const DST = "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_";

export interface Beacon {
  round: number;
  randomness: string;
  signature: string;
}

/** The first round published at or after `at`. */
export function roundAt(at: Date): number {
  const t = Math.floor(at.getTime() / 1000);
  return Math.floor((t - QUICKNET.genesisTime) / QUICKNET.period) + 1;
}

/** When a round is published. */
export const roundTime = (round: number) => new Date((QUICKNET.genesisTime + (round - 1) * QUICKNET.period) * 1000);

/** The message an unchained beacon signs: SHA-256 of the round as 8 big-endian bytes. */
function roundMessage(round: number): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(round));
  return sha256(b);
}

/**
 * True only if the signature is quicknet's for this round and the randomness is its SHA-256.
 * Nothing about the beacon is trusted until this passes.
 */
export function verifyBeacon(b: Beacon): boolean {
  try {
    const sig = hexToBytes(b.signature);
    if (bytesToHex(sha256(sig)) !== b.randomness.toLowerCase()) return false;
    const sigs = bls12_381.shortSignatures;
    return sigs.verify(sig, sigs.hash(roundMessage(b.round), DST), hexToBytes(QUICKNET.publicKey));
  } catch {
    return false;
  }
}

/** Fetches a round from the relays in turn; null while it isn't published yet. Verifies before returning. */
export async function fetchBeacon(round: number, fetchFn: typeof fetch = fetch): Promise<Beacon | null> {
  let lastError: unknown = null;
  for (const relay of QUICKNET.relays) {
    try {
      const res = await fetchFn(`${relay}/${QUICKNET.hash}/public/${round}`);
      if (res.status === 404 || res.status === 425) return null; // not published yet
      if (!res.ok) throw new Error(`${relay} answered ${res.status}`);
      const j = (await res.json()) as Beacon;
      if (j.round !== round) throw new Error(`${relay} returned round ${j.round} for ${round}`);
      if (!verifyBeacon(j)) throw new Error(`${relay} returned a beacon that fails verification`);
      return { round: j.round, randomness: j.randomness, signature: j.signature };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("no drand relay answered");
}
