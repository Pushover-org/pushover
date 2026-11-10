// Measures ring detection on rings-v1, as pre-registered in packages/eval/corpus/rings-v1/README.md.
// Signals are computed as the app computes them (keyed hashes; C9's network prefix), then
// findRings runs with RING_CONFIG. Writes packages/eval/results/rings-v1-<date>/summary.json.
//   node packages/eval/scripts/eval-rings-v1.ts [corpus] [v1|v2]
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { findRings, ipPrefixKey, normaliseBuilding, normaliseInbox, RING_CONFIG, RING_CONFIG_V1 } from "@proofofclaim/checks";
import { wilson } from "../src/score.ts";

interface Row {
  id: string; kind: string; ring: string | null; truth: "fraud" | "honest"; name: string; email: string; address_line: string; zip: string; ip: string; device_id: string; declaration: string; filed_at: string;
}
const SECRET = "rings-v1-eval";
const keyed = (kind: string, v: string | null) => (v ? createHmac("sha256", SECRET).update(`${kind}:${v}`).digest("hex") : null);

const CORPUS = process.argv[2] ?? "rings-v1";
const VERSION = process.argv[3] === "v1" ? "v1" : "v2";
const CONFIG = VERSION === "v1" ? RING_CONFIG_V1 : RING_CONFIG;
const rows = readFileSync(new URL(`../corpus/${CORPUS}/manifest.jsonl`, import.meta.url), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Row);
const t0 = performance.now();
const groups = findRings(rows.map((r) => ({
  claimId: r.id, deviceKey: keyed("device", r.device_id), inboxKey: keyed("inbox", normaliseInbox(r.email)), buildingKey: keyed("building", normaliseBuilding(r.address_line, r.zip)),
  networkKey: ipPrefixKey(r.ip, SECRET), declaration: r.declaration, filedAtMs: Date.parse(r.filed_at),
})), CONFIG);
const ms = Math.round(performance.now() - t0);

const grouped = new Set(groups.flatMap((g) => g.members));
const byId = new Map(rows.map((r) => [r.id, r]));
const kinds = [...new Set(rows.map((r) => r.kind))];
const rate = (subset: Row[]) => {
  const k = subset.filter((r) => grouped.has(r.id)).length;
  const w = wilson(k, subset.length);
  return { k, n: subset.length, rate: Math.round(w.rate * 10000) / 10000, low: Math.round(w.low * 10000) / 10000, high: Math.round(w.high * 10000) / 10000 };
};
const fraud = rows.filter((r) => r.truth === "fraud");
const honest = rows.filter((r) => r.truth === "honest");
const groupsWithHonest = groups.filter((g) => g.members.some((m) => byId.get(m)?.truth === "honest"));
const groupedFraud = [...grouped].filter((id) => byId.get(id)?.truth === "fraud").length;
// Rings fully or partly found, by ring.
const rings = new Map<string, Row[]>();
for (const r of fraud) rings.set(r.ring as string, [...(rings.get(r.ring as string) ?? []), r]);
const ringsTouched = [...rings.values()].filter((members) => members.some((m) => grouped.has(m.id))).length;

const summary = {
  corpus: CORPUS, version: VERSION, measured: new Date().toISOString(), config: CONFIG, claims: rows.length, ms,
  groups: groups.length, groupsWithAnHonestMember: groupsWithHonest.length,
  precision: { groupedClaims: grouped.size, fraud: groupedFraud, rate: Math.round((groupedFraud / Math.max(1, grouped.size)) * 10000) / 10000 },
  recall: { all: rate(fraud), ringsWithAnyMemberGrouped: { k: ringsTouched, n: rings.size }, byKind: Object.fromEntries(kinds.filter((k) => fraud.some((r) => r.kind === k)).map((k) => [k, rate(fraud.filter((r) => r.kind === k))])) },
  falseHolds: { all: rate(honest), byKind: Object.fromEntries(kinds.filter((k) => honest.some((r) => r.kind === k)).map((k) => [k, rate(honest.filter((r) => r.kind === k))])) },
};

const dir = new URL(`../results/${CORPUS}-${VERSION}-${summary.measured.slice(0, 10)}/`, import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL("summary.json", dir), `${JSON.stringify(summary, null, 2)}\n`);
const pct = (x: { k: number; n: number; rate: number; low: number; high: number }) => `${x.k}/${x.n} = ${(x.rate * 100).toFixed(1)}% [${(x.low * 100).toFixed(1)}–${(x.high * 100).toFixed(1)}]`;
console.log(`${rows.length} claims grouped in ${ms} ms: ${groups.length} groups, ${groupsWithHonest.length} containing an honest claimant`);
console.log(`precision: ${groupedFraud}/${grouped.size} grouped claims are fraud`);
console.log(`recall (fraud claims in a group): ${pct(summary.recall.all)}; rings touched ${ringsTouched}/${rings.size}`);
for (const [k, v] of Object.entries(summary.recall.byKind)) console.log(`  ${k.padEnd(14)} ${pct(v)}`);
console.log(`false holds (honest claims in a group): ${pct(summary.falseHolds.all)}`);
for (const [k, v] of Object.entries(summary.falseHolds.byKind)) console.log(`  ${k.padEnd(14)} ${pct(v)}`);
