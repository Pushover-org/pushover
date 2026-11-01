// C7 and C9 look at all claims together, not only earlier ones, so the first members of a
// cluster are caught too. Run them again across all claims before Distribute. No model is used.
import { createHmac } from "node:crypto";
import type { CheckResult } from "@pushover/claims";

export interface Declaration {
  claimId: string;
  text: string;
}

export interface TemplateConfig {
  /** Word shingle length. */
  shingle: number;
  /** Jaccard similarity at or above this links two declarations. */
  threshold: number;
  /** A claim fails when its cluster has at least this many other claims. */
  minOthers: number;
}

const words = (t: string) => t.toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}]+/gu) ?? [];

export function shingles(text: string, n: number): Set<string> {
  const w = words(text);
  if (w.length === 0) return new Set();
  if (w.length < n) return new Set([w.join(" ")]);
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let both = 0;
  for (const x of a) if (b.has(x)) both++;
  return both / (a.size + b.size - both);
}

/** Size of the cluster each claim belongs to (1 means alone). Similar-to-similar is one cluster. */
export function templateClusters(all: Declaration[], cfg: TemplateConfig): Map<string, number> {
  const sets = all.map((d) => shingles(d.text, cfg.shingle));
  const parent = all.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root] as number;
    while (parent[i] !== root) {
      const next = parent[i] as number;
      parent[i] = root;
      i = next;
    }
    return root;
  };
  // Only pairs that share a shingle can be similar.
  const seenWith = new Map<string, number[]>();
  sets.forEach((set, i) => {
    const candidates = new Set<number>();
    for (const s of set) for (const j of seenWith.get(s) ?? []) candidates.add(j);
    for (const j of candidates) {
      if (find(i) !== find(j) && jaccard(set, sets[j] as Set<string>) >= cfg.threshold) parent[find(i)] = find(j);
    }
    for (const s of set) {
      const list = seenWith.get(s);
      if (list) list.push(i);
      else seenWith.set(s, [i]);
    }
  });
  const sizes = new Map<number, number>();
  all.forEach((_, i) => sizes.set(find(i), (sizes.get(find(i)) ?? 0) + 1));
  return new Map(all.map((d, i) => [d.claimId, sizes.get(find(i)) ?? 1]));
}

export function checkTemplate(claimId: string, text: string | null, sizes: Map<string, number> | null, cfg: TemplateConfig): CheckResult {
  if (text === null || words(text).length === 0) return { id: "C7", result: "UNKNOWN", detail: "no declaration text" };
  const size = sizes?.get(claimId);
  if (size === undefined) return { id: "C7", result: "UNKNOWN", detail: "cluster lookup failed" };
  return size - 1 >= cfg.minOthers
    ? { id: "C7", result: "FAIL", detail: `declaration is in a cluster of ${size} similar claims` }
    : { id: "C7", result: "PASS", detail: `cluster of ${size}` };
}

/** IPv4 /24 or IPv6 /48, keyed with a secret, so no raw IP is ever stored. Null if unparsable. */
export function ipPrefixKey(ip: string, secret: string): string | null {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  let prefix: string | null = null;
  if (v4 && v4.slice(1).every((o) => Number(o) <= 255)) prefix = `${v4[1]}.${v4[2]}.${v4[3]}`;
  else if (ip.includes(":") && /^[0-9a-f:]+$/i.test(ip)) {
    const [head = ""] = ip.toLowerCase().split("::");
    const groups = head.split(":").filter(Boolean);
    if (groups.length >= 1) prefix = [...groups, "0", "0", "0"].slice(0, 3).map((g) => g.padStart(4, "0")).join(":");
  }
  return prefix === null ? null : createHmac("sha256", secret).update(prefix).digest("hex");
}

export interface Arrival {
  claimId: string;
  ipKey: string | null;
  atMs: number;
}

export interface VelocityConfig {
  /** More than this many claims... */
  maxClaims: number;
  /** ...from one network within this many hours fails. */
  hours: number;
}

/** C9: the busiest window of `hours` that contains this claim. */
export function checkVelocity(claimId: string, all: Arrival[] | null, cfg: VelocityConfig): CheckResult {
  if (all === null) return { id: "C9", result: "UNKNOWN", detail: "lookup failed" };
  const me = all.find((a) => a.claimId === claimId);
  if (!me || me.ipKey === null) return { id: "C9", result: "UNKNOWN", detail: "no network recorded" };
  const width = cfg.hours * 3_600_000;
  const times = all.filter((a) => a.ipKey === me.ipKey && Math.abs(a.atMs - me.atMs) <= width).map((a) => a.atMs).sort((x, y) => x - y);
  let busiest = 0;
  for (const start of times) {
    if (start > me.atMs) break;
    if (start + width < me.atMs) continue;
    busiest = Math.max(busiest, times.filter((t) => t >= start && t <= start + width).length);
  }
  return busiest > cfg.maxClaims
    ? { id: "C9", result: "FAIL", detail: `${busiest} claims from one network within ${cfg.hours} hours` }
    : { id: "C9", result: "PASS", detail: `at most ${busiest} claims from this network within ${cfg.hours} hours` };
}
