import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { findRings, normaliseBuilding, normaliseInbox, RING_CONFIG_V1, type RingClaim } from "../src/rings.ts";

let n = 0;
// Honest claimants write their own words: each story here is drawn from its own mix of words.
const W = {
  drink: ["iced tea", "lemonade", "a cola", "root beer", "hot cocoa", "an espresso", "cream soda", "orange juice", "ginger ale", "a milkshake", "sweet tea", "a latte", "mango lassi"],
  place: ["diner", "ballpark stand", "bakery", "drive-in", "ferry cafe", "pizza place", "taqueria", "hotel buffet", "noodle bar", "truck stop", "food court"],
  city: ["Austin", "Fresno", "Albany", "Buffalo", "Tampa", "Spokane", "Newark", "Laredo", "Flint", "Orlando", "Yonkers", "Tacoma", "Syracuse", "Modesto", "El Paso", "Miami", "Detroit"],
  who: ["my sister", "two coworkers", "the kids", "my grandfather", "a client", "my roommate", "nobody", "my softball team", "a neighbour"],
  when: ["one rainy Tuesday", "after a game", "on my lunch break", "late one night", "before a flight", "on a birthday", "during a snowstorm", "on a road trip"],
};
const pick = <T,>(xs: T[], k: number) => xs[k % xs.length] as T;
const story = (k: number) =>
  `${pick(W.when, k * 3)} I got ${pick(W.drink, k)} at a ${pick(W.place, k * 7)} in ${pick(W.city, k * 5)} with ${pick(W.who, k * 11)}, around ${2015 + (k % 5)}; ref ${k * 7919}`;
const claim = (over: Partial<RingClaim> = {}): RingClaim => {
  n++;
  return { claimId: `c${String(n).padStart(4, "0")}`, deviceKey: `dev${n}`, inboxKey: `inbox${n}`, buildingKey: `bld${n}`, networkKey: `net${n}`, declaration: story(n), filedAtMs: n * 60_000, ...over };
};

describe("normalising what people type", () => {
  it("an inbox: case, plus-tags, and Gmail's dots", () => {
    expect(normaliseInbox("Dana.Reyes+claims@GMail.com")).toBe("danareyes@gmail.com");
    expect(normaliseInbox("d.a.n.a.reyes@googlemail.com")).toBe("danareyes@gmail.com");
    expect(normaliseInbox("dana.reyes+x@example.org")).toBe("dana.reyes@example.org"); // dots only matter at Gmail
    expect(normaliseInbox("not an email")).toBeNull();
  });
  it("a building: units dropped, street words spelled out, the ZIP kept", () => {
    const a = normaliseBuilding("12 N Oak St Apt 4B", "95131");
    expect(a).toBe("12 north oak street 95131");
    expect(normaliseBuilding("12 North Oak Street #7", "95131-2201")).toBe(a);
    expect(normaliseBuilding("12 N. Oak St., Unit 3", "95131")).toBe(a);
    expect(normaliseBuilding("14 N Oak St", "95131")).not.toBe(a);
    expect(normaliseBuilding("12 N Oak St", "95132")).not.toBe(a);
    expect(normaliseBuilding("PO Box 12", "95131")).toBeNull();
  });
});

describe("rings form around a strong core", () => {
  it("a device farm: many claims from one device are one group", () => {
    const farm = Array.from({ length: 6 }, () => claim({ deviceKey: "farm-device" }));
    const groups = findRings([...farm, claim(), claim()]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.members).toEqual(farm.map((c) => c.claimId).sort());
    expect(groups[0]?.signals.device).toBe(15); // 6 choose 2
  });

  it("one inbox behind many names (after normalisation) is a group", () => {
    const g = findRings([claim({ inboxKey: "same" }), claim({ inboxKey: "same" }), claim()]);
    expect(g).toHaveLength(1);
    expect(g[0]?.signals.inbox).toBe(1);
  });

  it("a template crew: near-identical stories are a group, at any size", () => {
    const template = "I purchased several soft drinks at a restaurant during the class period and I request my payment under penalty of perjury";
    const crew = Array.from({ length: 40 }, (_, i) => claim({ declaration: `${template} ${i}` }));
    const g = findRings([...crew, ...Array.from({ length: 30 }, () => claim())]);
    expect(g).toHaveLength(1);
    expect(g[0]?.members).toHaveLength(40);
  });

  it("weak links join a claim to a core only through two or more core members", () => {
    const a = claim({ deviceKey: "d", networkKey: "net-x", buildingKey: "bld-y" });
    const b = claim({ deviceKey: "d", networkKey: "net-x", buildingKey: "bld-z" });
    const joins = claim({ networkKey: "net-x" }); // same network as both a and b
    const once = claim({ buildingKey: "bld-y" }); // shares a building with a only
    const g = findRings([a, b, joins, once]);
    expect(g[0]?.members).toEqual([a, b, joins].map((c) => c.claimId).sort());
    expect(g[0]?.core).toEqual([a, b].map((c) => c.claimId).sort());
  });

  it("an attached claim attaches nobody else (weak links don't chain)", () => {
    const a = claim({ deviceKey: "d", networkKey: "n1" });
    const b = claim({ deviceKey: "d", networkKey: "n1" });
    const c = claim({ networkKey: "n1", buildingKey: "b9" });
    const d = claim({ buildingKey: "b9" });
    const e = claim({ buildingKey: "b9" });
    const g = findRings([a, b, c, d, e]);
    expect(g).toHaveLength(1);
    expect(g[0]?.members).toEqual([a, b, c].map((x) => x.claimId).sort());
  });
});

describe("story links don't chain (rings v2)", () => {
  // Each sentence shares most of its words with the next, but the first and last share almost none.
  const chain = [
    "late one night I had iced tea at a diner in Austin with my sister around 2016",
    "late one night I had iced tea at a diner in Austin with my roommate around 2017",
    "on payday I had iced tea at a diner in Austin with my roommate around 2017",
    "on payday I had a latte at a bakery in Austin with my roommate around 2017",
    "on payday I had a latte at a bakery in Tampa with a client around 2018",
  ];
  it("a chain of look-alikes is not a group; v1 grouped it", () => {
    const claims = chain.map((declaration) => claim({ declaration }));
    expect(findRings(claims)).toEqual([]);
    expect(findRings(claims, RING_CONFIG_V1)).toHaveLength(1);
  });
  it("a lone look-alike pair (two strangers writing alike) is not a group", () => {
    const s = "I bought a lemonade at a taqueria in Laredo and I would like my share please";
    expect(findRings([claim({ declaration: s }), claim({ declaration: `${s} thanks` })])).toEqual([]);
  });
  it("a crew of three or more copying one text still is", () => {
    const t = "Throughout the settlement period I regularly bought soft drinks and coffee with meals at restaurants near my home";
    expect(findRings([0, 1, 2].map((i) => claim({ declaration: `${t} ${["ok", "yes", "thanks"][i]}` }))).map((g) => g.members.length)).toEqual([3]);
  });
});

describe("honest life doesn't make a group", () => {
  it("a household (one building, one router, own devices, own inboxes, own words) is not a group", () => {
    const home = Array.from({ length: 4 }, () => claim({ buildingKey: "home", networkKey: "home-wifi" }));
    expect(findRings(home)).toEqual([]);
  });

  it("a dorm or café: one network for hundreds of strangers is not a group", () => {
    const dorm = Array.from({ length: 300 }, () => claim({ networkKey: "campus-nat" }));
    expect(findRings(dorm)).toEqual([]);
  });

  it("property: claims sharing only networks and buildings never form a group", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ net: fc.integer({ min: 0, max: 3 }), bld: fc.integer({ min: 0, max: 3 }) }), { minLength: 0, maxLength: 80 }),
        (rows) => findRings(rows.map((r) => claim({ networkKey: `n${r.net}`, buildingKey: `b${r.bld}` }))).length === 0,
      ),
      { numRuns: 200 },
    );
  });
});

describe("group identity", () => {
  it("the same members give the same signature, whatever the input order", () => {
    const farm = Array.from({ length: 3 }, () => claim({ deviceKey: "z" }));
    expect(findRings([...farm].reverse())[0]?.signature).toBe(findRings(farm)[0]?.signature);
  });
  it("5,000 claims are grouped in well under a few seconds", () => {
    const many = Array.from({ length: 5000 }, (_, i) => claim(i % 50 === 0 ? { deviceKey: `farm${i % 7}` } : {}));
    const t0 = Date.now();
    findRings(many);
    expect(Date.now() - t0).toBeLessThan(4000);
  });
});
