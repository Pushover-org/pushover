// Fraud-ring detection (plan item P25). Claims are linked by shared signals; a group exists only
// around a STRONG core (the same device, the same inbox once normalised, or the same story), and
// WEAK links (the same network, the same building) count only towards joining such a core. So a
// shared home, dorm or café router alone never makes a group: those are how honest people live.
// Deterministic; no model. A group is held for a person, never denied by this code.
import { createHash } from "node:crypto";
import { jaccard, shingles } from "./clusters.ts";

export type SignalKind = "device" | "inbox" | "story" | "building" | "network";
export const STRONG_SIGNALS: readonly SignalKind[] = ["device", "inbox", "story"];
export const WEAK_SIGNALS: readonly SignalKind[] = ["building", "network"];

/** A claim as ring detection sees it: keyed hashes and the declaration, nothing else. */
export interface RingClaim {
  claimId: string;
  deviceKey: string | null;
  inboxKey: string | null;
  buildingKey: string | null;
  networkKey: string | null;
  declaration: string;
  filedAtMs: number;
}

export interface RingConfig {
  /** Story: word-shingle length and the Jaccard similarity that counts as the same story (C7's). */
  storyShingle: number;
  storyThreshold: number;
  /** A claim joins a core through weak links only if it shares them with at least this many core members. */
  attachMinMembers: number;
}

export const RING_CONFIG: RingConfig = { storyShingle: 3, storyThreshold: 0.5, attachMinMembers: 2 };

export interface RingGroup {
  /** SHA-256 of the sorted member IDs: the same members, the same group. */
  signature: string;
  members: string[];
  /** Members linked by strong signals. The rest joined through weak links to the core. */
  core: string[];
  /** For each signal, how many member pairs share it. */
  signals: Record<SignalKind, number>;
  /** Total shared signals among the members: "N shared signals among M claims". */
  sharedSignals: number;
}

// --- Normalisation (the inputs to the keyed hashes stored with each claim) ---

/** An inbox as mail is actually delivered: lower case, "+tag" dropped, and Gmail's dots ignored. */
export function normaliseInbox(email: string): string | null {
  const m = /^([^@\s]+)@([^@\s]+\.[^@\s]+)$/.exec(email.trim().toLowerCase().normalize("NFKC"));
  if (!m) return null;
  let local = (m[1] ?? "").split("+")[0] ?? "";
  let domain = m[2] ?? "";
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replaceAll(".", "");
  return local ? `${local}@${domain}` : null;
}

const STREET_WORDS: Record<string, string> = {
  st: "street", str: "street", ave: "avenue", av: "avenue", rd: "road", blvd: "boulevard", dr: "drive", ln: "lane", ct: "court", pl: "place", ter: "terrace",
  hwy: "highway", pkwy: "parkway", cir: "circle", sq: "square", n: "north", s: "south", e: "east", w: "west", ne: "northeast", nw: "northwest", se: "southeast", sw: "southwest",
};
// A unit designator as a whole word, then its number; or "#" and a number.
const UNIT = /\b(?:apt|apartment|unit|ste|suite|fl|floor|rm|room)\b\.?\s*[a-z0-9-]+|#\s*[a-z0-9-]+/g;

/** The building, not the flat: "12 N Oak St Apt 4B" and "12 North Oak Street #7" are one building. */
export function normaliseBuilding(addressLine: string, zip: string): string | null {
  const z = /^(\d{5})/.exec(zip.trim())?.[1];
  const line = addressLine.toLowerCase().normalize("NFKC").replace(UNIT, " ").replace(/[^\p{L}\p{N}\s]/gu, " ");
  const words = line.split(/\s+/).filter(Boolean).map((w) => STREET_WORDS[w] ?? w);
  if (!z || words.length === 0 || !/^\d/.test(words[0] ?? "")) return null; // no house number: not a building
  return `${words.join(" ")} ${z}`;
}

// --- Story similarity at scale: MinHash banding finds candidates, exact Jaccard confirms them ---

const HASHES = 24;
const BANDS = 8; // 3 rows per band: pairs near the 0.5 threshold are very likely to share a band

function fnv1a(s: string, seed: number): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function storyPairs(claims: RingClaim[], cfg: RingConfig): [number, number][] {
  const sets = claims.map((c) => shingles(c.declaration, cfg.storyShingle));
  const buckets = new Map<string, number[]>();
  sets.forEach((set, i) => {
    if (set.size === 0) return;
    const sig = Array.from({ length: HASHES }, (_, k) => {
      let min = 0xffffffff;
      for (const sh of set) min = Math.min(min, fnv1a(sh, k * 0x9e3779b1));
      return min;
    });
    const rows = HASHES / BANDS;
    for (let b = 0; b < BANDS; b++) {
      const key = `${b}:${sig.slice(b * rows, b * rows + rows).join(",")}`;
      const list = buckets.get(key);
      if (list) list.push(i);
      else buckets.set(key, [i]);
    }
  });
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (const list of buckets.values()) {
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const a = list[x] as number;
        const b = list[y] as number;
        const k = a < b ? `${a},${b}` : `${b},${a}`;
        if (seen.has(k)) continue;
        seen.add(k);
        if (jaccard(sets[a] as Set<string>, sets[b] as Set<string>) >= cfg.storyThreshold) out.push(a < b ? [a, b] : [b, a]);
      }
    }
  }
  return out;
}

// --- Grouping ---

function pairsByKey(claims: RingClaim[], key: (c: RingClaim) => string | null): [number, number][] {
  const by = new Map<string, number[]>();
  claims.forEach((c, i) => {
    const k = key(c);
    if (!k) return;
    const list = by.get(k);
    if (list) list.push(i);
    else by.set(k, [i]);
  });
  const out: [number, number][] = [];
  for (const list of by.values()) for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) out.push([list[x] as number, list[y] as number]);
  return out;
}

export function findRings(claims: RingClaim[], cfg: RingConfig = RING_CONFIG): RingGroup[] {
  const pairs: Record<SignalKind, [number, number][]> = {
    device: pairsByKey(claims, (c) => c.deviceKey),
    inbox: pairsByKey(claims, (c) => c.inboxKey),
    story: storyPairs(claims, cfg),
    building: pairsByKey(claims, (c) => c.buildingKey),
    network: pairsByKey(claims, (c) => c.networkKey),
  };
  // Cores: connected components over strong links only.
  const parent = claims.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i] as number)));
  for (const kind of STRONG_SIGNALS) for (const [a, b] of pairs[kind]) parent[find(a)] = find(b);
  const cores = new Map<number, number[]>();
  claims.forEach((_, i) => {
    const r = find(i);
    const list = cores.get(r);
    if (list) list.push(i);
    else cores.set(r, [i]);
  });
  const coreOf = new Map<number, number>();
  for (const [r, members] of cores) if (members.length >= 2) for (const m of members) coreOf.set(m, r);

  // Weak links count only towards a core, and never chain: an attached claim attaches nobody.
  const weakTo = new Map<number, Map<number, Set<number>>>(); // outsider → core → core members it shares a weak signal with
  for (const kind of WEAK_SIGNALS) {
    for (const [a, b] of pairs[kind]) {
      for (const [out, inside] of [[a, b], [b, a]] as const) {
        const r = coreOf.get(inside);
        if (r === undefined || coreOf.has(out)) continue;
        const m = weakTo.get(out) ?? new Map<number, Set<number>>();
        const set = m.get(r) ?? new Set<number>();
        set.add(inside);
        m.set(r, set);
        weakTo.set(out, m);
      }
    }
  }
  const groupOf = new Map(coreOf);
  for (const [out, m] of weakTo) {
    const best = [...m.entries()].filter(([, s]) => s.size >= cfg.attachMinMembers).sort((x, y) => y[1].size - x[1].size)[0];
    if (best) groupOf.set(out, best[0]);
  }

  const groups = new Map<number, number[]>();
  for (const [i, r] of groupOf) {
    const list = groups.get(r);
    if (list) list.push(i);
    else groups.set(r, [i]);
  }
  const out: RingGroup[] = [];
  for (const [r, idx] of groups) {
    const inGroup = new Set(idx);
    const signals = { device: 0, inbox: 0, story: 0, building: 0, network: 0 } as Record<SignalKind, number>;
    for (const kind of [...STRONG_SIGNALS, ...WEAK_SIGNALS]) signals[kind] = pairs[kind].filter(([a, b]) => inGroup.has(a) && inGroup.has(b)).length;
    const members = idx.map((i) => (claims[i] as RingClaim).claimId).sort();
    out.push({
      signature: createHash("sha256").update(members.join("\n")).digest("hex"), members,
      core: (cores.get(r) ?? []).map((i) => (claims[i] as RingClaim).claimId).sort(), signals, sharedSignals: Object.values(signals).reduce((t, n) => t + n, 0),
    });
  }
  return out.sort((a, b) => b.members.length - a.members.length || (a.signature < b.signature ? -1 : 1));
}
