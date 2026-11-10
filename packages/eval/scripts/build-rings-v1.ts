// Builds packages/eval/corpus/rings-v1/: 5,000 synthetic claimants for measuring fraud-ring
// detection (plan items P31, P32, C8). About a third are in rings; the rest are honest, including
// the look-alikes ring detection must not hold: households, dorms, cafés and people who write alike.
// Deterministic (seeded). Labels are committed before any measurement (README).
//   node packages/eval/scripts/build-rings-v1.ts
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = new URL("../corpus/rings-v1/", import.meta.url);
const SEED = 20261110;

function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)] as T;

const FIRST = ["Ana", "Ben", "Cara", "Dev", "Eli", "Fay", "Gus", "Hana", "Ivo", "Jae", "Kofi", "Lena", "Milo", "Nia", "Omar", "Pia", "Quin", "Rosa", "Sami", "Tara", "Uma", "Vik", "Wren", "Xia", "Yusuf", "Zoe", "Ada", "Bo", "Cy", "Dina", "Ezra", "Flo", "Gia", "Hal", "Iris", "Jon", "Kai", "Lior", "Mae", "Noor"];
const LAST = ["Abara", "Bianchi", "Castillo", "Dimitrov", "Eze", "Fischer", "Garza", "Haddad", "Ibarra", "Jensen", "Kowalski", "Laurent", "Mensah", "Nakamura", "Okafor", "Petrov", "Quispe", "Rahman", "Sato", "Tran", "Ueda", "Varga", "Wojcik", "Xu", "Yilmaz", "Zamora", "Arce", "Bloom", "Chen", "Duarte"];
const STREETS = ["Oak", "Maple", "Cedar", "Pine", "Elm", "Birch", "Willow", "Aspen", "Spruce", "Juniper", "Laurel", "Hawthorn", "Sycamore", "Magnolia", "Poplar", "Alder"];
const SUFFIX = ["St", "Ave", "Rd", "Dr", "Ln", "Ct", "Pl", "Blvd", "Way", "Ter"];
const STATES = [["CA", "9"], ["NY", "1"], ["TX", "7"], ["FL", "3"], ["WA", "9"], ["MI", "4"], ["NJ", "0"], ["SC", "2"], ["CT", "0"]] as const;
const DOMAINS = ["gmail.com", "yahoo.com", "outlook.com", "icloud.com", "proton.me", "example.org"];

// Honest people write their own words: several sentence shapes over a large vocabulary.
const W = {
  drink: ["iced tea", "lemonade", "a cola", "root beer", "hot cocoa", "an espresso", "cream soda", "orange juice", "ginger ale", "a milkshake", "sweet tea", "a latte", "mango lassi", "horchata", "apple cider", "a cappuccino", "limeade", "a chai"],
  place: ["diner", "ballpark stand", "bakery", "drive-in", "ferry cafe", "pizza place", "taqueria", "hotel buffet", "noodle bar", "truck stop", "food court", "bistro", "steakhouse", "sushi counter", "burger joint", "crepe stand"],
  city: ["Austin", "Fresno", "Albany", "Buffalo", "Tampa", "Spokane", "Newark", "Laredo", "Flint", "Orlando", "Yonkers", "Tacoma", "Syracuse", "Modesto", "El Paso", "Miami", "Detroit", "Hartford", "Columbia", "Trenton"],
  who: ["my sister", "two coworkers", "the kids", "my grandfather", "a client", "my roommate", "my softball team", "a neighbour", "my husband", "my wife", "an old friend", "my book club"],
  when: ["one rainy Tuesday", "after a game", "on my lunch break", "late one night", "before a flight", "on a birthday", "during a snowstorm", "on a road trip", "after church", "on payday"],
};
const SHAPES: ((s: Record<keyof typeof W, string>, y: number) => string)[] = [
  (s, y) => `${s.when} in ${y} I had ${s.drink} at a ${s.place} in ${s.city} with ${s.who}.`,
  (s, y) => `Bought ${s.drink} at the ${s.place} near downtown ${s.city}, ${s.when}, ${y}. Went with ${s.who}.`,
  (s, y) => `My claim: ${s.drink}, ${s.place}, ${s.city}. It was ${s.when} around ${y} and ${s.who} came too.`,
  (s, y) => `${s.who} and I stopped at a ${s.place} in ${s.city} ${s.when} (${y}) and I ordered ${s.drink}.`,
  (s, y) => `In ${s.city} back in ${y}, ${s.when}, I got ${s.drink} with dinner at a ${s.place}; ${s.who} paid the tip.`,
  (s, y) => `I remember ${s.drink} at a little ${s.place} in ${s.city}. ${s.when}, ${y}, with ${s.who}.`,
];
const story = () => pick(SHAPES)({ drink: pick(W.drink), place: pick(W.place), city: pick(W.city), who: pick(W.who), when: pick(W.when) }, int(2015, 2019));

const TEMPLATES = [
  "I purchased non-alcoholic beverages at sit-down restaurants regularly throughout the class period and I request my settlement payment under penalty of perjury",
  "Throughout the settlement period I regularly bought soft drinks and coffee with meals at restaurants near my home and I swear these purchases happened",
  "During the class period I frequently purchased beverages at restaurants in my state and I declare under penalty of perjury that this is true and correct",
];
/** A template crew copies one text and changes a word or two. */
const fromTemplate = (t: string) => {
  const w = t.split(" ");
  for (let k = int(0, 2); k > 0; k--) w[int(0, w.length - 1)] = pick(["often", "always", "many", "several", "local", "nearby", "true", "really"]);
  return `${w.join(" ")}${rand() < 0.5 ? "." : ` Thank you ${pick(FIRST)}.`}`;
};

let nextId = 0;
let nextDevice = 0;
let nextNet = 0;
const device = () => `dev-${(nextDevice++).toString(36)}-${int(1000, 9999)}`;
const network = () => {
  const n = nextNet++;
  return rand() < 0.5 ? `198.${18 + (n >> 16) % 2}.${(n >> 8) & 255}.${n & 255}` : `2001:db8:${(n & 0xffff).toString(16)}::${int(1, 999).toString(16)}`;
};
const home = () => {
  const [state, z] = pick(STATES);
  return { line: `${int(10, 9899)} ${pick(STREETS)} ${pick(SUFFIX)}`, zip: `${z}${String(int(1000, 9999))}`, state };
};
// Two different people never share an inbox: a collision would be an artificial false hold.
const usedEmails = new Set<string>();
const uniqueEmail = (make: () => string) => {
  for (;;) {
    const e = make();
    if (!usedEmails.has(e)) {
      usedEmails.add(e);
      return e;
    }
  }
};
const person = () => {
  const first = pick(FIRST);
  const last = pick(LAST);
  return { first, last, name: `${first} ${last}`, email: uniqueEmail(() => `${first.toLowerCase()}.${last.toLowerCase()}${int(1, 999)}@${pick(DOMAINS)}`) };
};

interface Row {
  id: string;
  kind: string;
  ring: string | null;
  truth: "fraud" | "honest";
  name: string;
  email: string;
  address_line: string;
  zip: string;
  state: string;
  ip: string;
  device_id: string;
  declaration: string;
  filed_at: string;
}
const rows: Row[] = [];
const T0 = Date.parse("2026-01-05T00:00:00Z");
const DAYS = 60;
const randomTime = () => T0 + Math.floor(rand() * DAYS * 86_400_000);
const add = (r: Omit<Row, "id">) => rows.push({ id: `r-${String(++nextId).padStart(5, "0")}`, ...r });

function burst(n: number, spreadMinutes: number) {
  const start = randomTime();
  return Array.from({ length: n }, () => new Date(start + Math.floor(rand() * spreadMinutes * 60_000)).toISOString());
}

// --- Fraud: about a third ---
let ringNo = 0;
const ring = (kind: string) => `${kind}-${++ringNo}`;
for (let i = 0; i < 40; i++) {
  // One phone or laptop behind many identities.
  const id = ring("device_farm");
  const d = device();
  const n = int(5, 15);
  const nets = [network(), network()];
  const times = burst(n, 180);
  for (let k = 0; k < n; k++) {
    const p = person();
    const h = home();
    add({ kind: "device_farm", ring: id, truth: "fraud", name: p.name, email: p.email, address_line: h.line, zip: h.zip, state: h.state, ip: pick(nets), device_id: d, declaration: story(), filed_at: times[k] as string });
  }
}
for (let i = 0; i < 30; i++) {
  // Copied words, everything else different (bots behind proxies).
  const id = ring("template_crew");
  const t = pick(TEMPLATES);
  const n = int(5, 25);
  const times = burst(n, 24 * 60);
  for (let k = 0; k < n; k++) {
    const p = person();
    const h = home();
    add({ kind: "template_crew", ring: id, truth: "fraud", name: p.name, email: p.email, address_line: h.line, zip: h.zip, state: h.state, ip: network(), device_id: device(), declaration: fromTemplate(t), filed_at: times[k] as string });
  }
}
for (let i = 0; i < 40; i++) {
  // One Gmail inbox under many names, by dots and plus-tags.
  const id = ring("inbox_ring");
  const base = `${pick(FIRST).toLowerCase()}${pick(LAST).toLowerCase()}${int(10, 99)}`;
  const n = int(3, 8);
  const times = burst(n, 3 * 24 * 60);
  for (let k = 0; k < n; k++) {
    const p = person();
    const h = home();
    const dotted = base.split("").map((c, j) => (j > 0 && rand() < 0.15 ? `.${c}` : c)).join("");
    const local = rand() < 0.5 ? `${dotted}+${pick(["claim", "c2", "x", "acme", "pay"])}${k}` : dotted;
    add({ kind: "inbox_ring", ring: id, truth: "fraud", name: p.name, email: `${rand() < 0.3 ? local.toUpperCase() : local}@gmail.com`, address_line: h.line, zip: h.zip, state: h.state, ip: network(), device_id: device(), declaration: story(), filed_at: times[k] as string });
  }
}
for (let i = 0; i < 30; i++) {
  // Many identities at one building, own devices, inboxes and words: only weak links, by design undetectable here.
  const id = ring("address_mill");
  const h = home();
  const net = network();
  const n = int(5, 15);
  const times = burst(n, 7 * 24 * 60);
  for (let k = 0; k < n; k++) {
    const p = person();
    add({ kind: "address_mill", ring: id, truth: "fraud", name: p.name, email: p.email, address_line: `${h.line} ${pick(["Apt", "Unit", "#"])} ${int(1, 40)}`, zip: h.zip, state: h.state, ip: rand() < 0.7 ? net : network(), device_id: device(), declaration: story(), filed_at: times[k] as string });
  }
}
for (let i = 0; i < 40; i++) {
  // Shares little: one device between two members, the rest only a network.
  const id = ring("quiet_ring");
  const d = device();
  const net = network();
  const n = int(4, 8);
  const times = burst(n, 6 * 60);
  for (let k = 0; k < n; k++) {
    const p = person();
    const h = home();
    add({ kind: "quiet_ring", ring: id, truth: "fraud", name: p.name, email: p.email, address_line: h.line, zip: h.zip, state: h.state, ip: net, device_id: k < 2 ? d : device(), declaration: story(), filed_at: times[k] as string });
  }
}

// --- Honest ---
const fraudCount = rows.length;
for (let i = 0; i < 200; i++) {
  // A household: one building, one router, own inboxes and words; a quarter share one family device.
  const h = home();
  const net = network();
  const family = pick(LAST);
  const shared = rand() < 0.25 ? device() : null;
  const n = int(2, 5);
  for (let k = 0; k < n; k++) {
    const first = pick(FIRST);
    add({
      kind: "household", ring: null, truth: "honest", name: `${first} ${family}`, email: uniqueEmail(() => `${first.toLowerCase()}.${family.toLowerCase()}${int(1, 999)}@${pick(DOMAINS)}`),
      address_line: rand() < 0.5 ? h.line : `${h.line} ${pick(["Apt", "Unit"])} ${int(1, 4)}`, zip: h.zip, state: h.state, ip: net, device_id: shared && k < 2 ? shared : device(), declaration: story(), filed_at: new Date(randomTime()).toISOString(),
    });
  }
}
for (let i = 0; i < 6; i++) {
  // A dorm: one building and one campus network for 40 students, each with their own device.
  const h = home();
  const net = network();
  for (let k = 0; k < 40; k++) {
    const p = person();
    add({ kind: "campus", ring: null, truth: "honest", name: p.name, email: p.email, address_line: `${h.line} Room ${int(100, 499)}`, zip: h.zip, state: h.state, ip: net, device_id: device(), declaration: story(), filed_at: new Date(randomTime()).toISOString() });
  }
}
for (let i = 0; i < 5; i++) {
  // A café's network: 30 strangers.
  const net = network();
  for (let k = 0; k < 30; k++) {
    const p = person();
    const h = home();
    add({ kind: "shared_network", ring: null, truth: "honest", name: p.name, email: p.email, address_line: h.line, zip: h.zip, state: h.state, ip: net, device_id: device(), declaration: story(), filed_at: new Date(randomTime()).toISOString() });
  }
}
for (let i = 0; i < 25; i++) {
  // Two strangers who happen to write almost the same short sentence.
  const s = `I bought ${pick(W.drink)} at a ${pick(W.place)} in ${pick(W.city)} and I would like my share please`;
  for (let k = 0; k < 2; k++) {
    const p = person();
    const h = home();
    add({ kind: "coincidence", ring: null, truth: "honest", name: p.name, email: p.email, address_line: h.line, zip: h.zip, state: h.state, ip: network(), device_id: device(), declaration: k === 0 ? s : `${s} thanks`, filed_at: new Date(randomTime()).toISOString() });
  }
}
while (rows.length < 5000) {
  const p = person();
  const h = home();
  add({ kind: "solo", ring: null, truth: "honest", name: p.name, email: p.email, address_line: h.line, zip: h.zip, state: h.state, ip: network(), device_id: device(), declaration: story(), filed_at: new Date(randomTime()).toISOString() });
}

mkdirSync(OUT, { recursive: true });
writeFileSync(new URL("manifest.jsonl", OUT), `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`);
const kinds = new Map<string, number>();
for (const r of rows) kinds.set(r.kind, (kinds.get(r.kind) ?? 0) + 1);
console.log(`${rows.length} claimants (${fraudCount} in rings): ${[...kinds].map(([k, n]) => `${k} ${n}`).join(", ")}`);
