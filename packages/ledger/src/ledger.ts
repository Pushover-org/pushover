// The decision ledger (plan items P33, C1, C2, P44): before money moves, every decided claim
// becomes a leaf (its decision, reason, rule, table version, amount, the hashes of its evidence and
// findings, and its check results), and the Merkle root of all leaves is committed together with a
// fingerprint of the rules and a drand round that doesn't exist yet. Anyone can then check, in a
// browser, that the decisions and rules were fixed before the payout, and recompute an audit sample
// that nobody could have picked. Same code on the server and in the browser.
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

export const LEDGER_VERSION = "poc-ledger-v1";
/** Claims the audit sample picks for a person to re-examine. */
export const SAMPLE_SIZE = 5;

export type CheckOutcome = "PASS" | "FAIL" | "UNKNOWN";

/** One decided claim. No personal data: the claim ID, the decision and hashes only. */
export interface DecisionLeaf {
  claim: string;
  outcome: string;
  reason: string;
  /** The decision table rule, or null for a person's decision. */
  rule: number | null;
  version: string;
  decidedBy: "rules" | "analyst";
  /** What the decision entitles the claim to, in cents; null when it pays nothing. */
  amountCents: number | null;
  /** SHA-256 of the evidence file as filed, or null without one. */
  evidenceSha256: string | null;
  /** SHA-256 of the canonical findings the examiner reported, or null. */
  findingsSha256: string | null;
  checks: Record<string, CheckOutcome>;
}

/** The rules in force, by hash: anyone can compare each with the public repository. */
export interface RulesFingerprint {
  /** SHA-256 of packages/claims/src/decision-v1.ts. */
  decisionTable: string;
  /** SHA-256 of data/tax-rates.json. */
  taxTable: string;
  /** SHA-256 of the settlement's canonical configuration. */
  settlement: string;
}

export interface Commitment {
  version: typeof LEDGER_VERSION;
  settlementId: string;
  kind: "CLAIMS" | "CY_PRES";
  round: number;
  /** SHA-256 of the money plan two people approved. */
  planSha256: string;
  root: string;
  leafCount: number;
  rules: RulesFingerprint;
  rulesSha256: string;
  drand: { chain: string; round: number };
  committedAt: string;
}

/** JSON with keys sorted at every level: the same bytes in every browser and on the server. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}

export const sha256Hex = (data: string | Uint8Array) => bytesToHex(sha256(typeof data === "string" ? utf8ToBytes(data) : data));

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/** Leaves and inner nodes are hashed apart (0x00 and 0x01 prefixes), so one can't pass for the other. */
export const leafHash = (leaf: DecisionLeaf): string => bytesToHex(sha256(concat(Uint8Array.of(0), utf8ToBytes(canonical(leaf)))));
const nodeHash = (l: Uint8Array, r: Uint8Array) => sha256(concat(Uint8Array.of(1), l, r));

/** Leaves in claim-ID order: the order is part of the commitment. */
export const ordered = (leaves: DecisionLeaf[]) => [...leaves].sort((a, b) => (a.claim < b.claim ? -1 : a.claim > b.claim ? 1 : 0));

function levels(leafHashes: string[]): Uint8Array[][] {
  if (leafHashes.length === 0) return [[sha256(utf8ToBytes(`${LEDGER_VERSION}:empty`))]];
  const out: Uint8Array[][] = [leafHashes.map(hexToBytes)];
  while ((out[out.length - 1] ?? []).length > 1) {
    const prev = out[out.length - 1] ?? [];
    const next: Uint8Array[] = [];
    // An odd node is carried up unchanged, never paired with itself.
    for (let i = 0; i < prev.length; i += 2) next.push(i + 1 < prev.length ? nodeHash(prev[i] as Uint8Array, prev[i + 1] as Uint8Array) : (prev[i] as Uint8Array));
    out.push(next);
  }
  return out;
}

export function merkleRoot(leaves: DecisionLeaf[]): string {
  const l = levels(ordered(leaves).map(leafHash));
  return bytesToHex((l[l.length - 1] ?? [])[0] as Uint8Array);
}

export type ProofStep = { side: "left" | "right"; hash: string };

/** The path from one claim's leaf to the root, so a single claimant can check theirs alone. */
export function inclusionProof(leaves: DecisionLeaf[], claim: string): ProofStep[] {
  const sorted = ordered(leaves);
  let i = sorted.findIndex((l) => l.claim === claim);
  if (i < 0) throw new Error(`claim ${claim} is not in the ledger`);
  const path: ProofStep[] = [];
  const lv = levels(sorted.map(leafHash));
  for (let d = 0; d < lv.length - 1; d++) {
    const row = lv[d] ?? [];
    const sib = i % 2 === 0 ? i + 1 : i - 1;
    if (sib < row.length) path.push({ side: i % 2 === 0 ? "right" : "left", hash: bytesToHex(row[sib] as Uint8Array) });
    i = Math.floor(i / 2);
  }
  return path;
}

export function verifyInclusion(leaf: DecisionLeaf, path: ProofStep[], root: string): boolean {
  let h = hexToBytes(leafHash(leaf));
  for (const step of path) h = step.side === "right" ? nodeHash(h, hexToBytes(step.hash)) : nodeHash(hexToBytes(step.hash), h);
  return bytesToHex(h) === root;
}

export const rulesSha256 = (r: RulesFingerprint) => sha256Hex(canonical(r));
/** What each payout's note at PayPal carries: the hash of the whole commitment. */
export const commitmentDigest = (c: Commitment) => sha256Hex(canonical(c));

/**
 * The audit sample (P44): claims to re-examine, picked by randomness that didn't exist when the
 * root was committed. Each leaf is ranked by HMAC-SHA256(randomness, root ‖ leaf hash); the lowest
 * `size` are the sample. Same answer in every browser and on the server.
 */
export function auditSample(leaves: DecisionLeaf[], root: string, randomness: string, size: number): string[] {
  const key = hexToBytes(randomness);
  return ordered(leaves)
    .map((l) => ({ claim: l.claim, rank: bytesToHex(hmac(sha256, key, concat(hexToBytes(root), hexToBytes(leafHash(l))))) }))
    .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0))
    .slice(0, size)
    .map((x) => x.claim);
}
