import { describe, expect, it } from "vitest";
import { checkTemplate, checkVelocity, ipPrefixKey, jaccard, shingles, templateClusters } from "../src/clusters.ts";
import { checkIdentity, normaliseAddress, normaliseEmail, normaliseNameZip, type EarlierIdentity } from "../src/identity.ts";

const cfg = { shingle: 3, threshold: 0.5, minOthers: 3 };
const tmpl = (n: string) => `I purchased a beverage at a restaurant during the class period and I am entitled to compensation ${n}`;

describe("C7 template clusters", () => {
  it("shingles ignore case and punctuation", () => expect([...shingles("One, two THREE four", 3)]).toEqual(["one two three", "two three four"]));
  it("a short text is one shingle; empty is none", () => {
    expect([...shingles("hi there", 3)]).toEqual(["hi there"]);
    expect(shingles("  ...  ", 3).size).toBe(0);
  });
  it("jaccard: identical 1, disjoint 0, empty 0", () => {
    const a = shingles("a b c d", 3);
    expect(jaccard(a, a)).toBe(1);
    expect(jaccard(a, shingles("x y z q", 3))).toBe(0);
    expect(jaccard(a, new Set())).toBe(0);
  });
  it("catches every member of a cluster, the first ones too", () => {
    const decls = [1, 2, 3, 4].map((n) => ({ claimId: `b${n}`, text: tmpl(`x${n}`) }));
    decls.push({ claimId: "honest", text: "We had brunch downtown in March and my coffee was cold when it arrived at the table." });
    const sizes = templateClusters(decls, cfg);
    for (const id of ["b1", "b2", "b3", "b4"]) expect(checkTemplate(id, "text", sizes, cfg).result).toBe("FAIL");
    expect(checkTemplate("honest", "text", sizes, cfg).result).toBe("PASS");
  });
  it("similar-to-similar joins one cluster even if the two ends differ", () => {
    const sizes = templateClusters([
      { claimId: "a", text: "one two three four five six seven eight" },
      { claimId: "b", text: "two three four five six seven eight nine ten" },
      { claimId: "c", text: "four five six seven eight nine ten eleven twelve" },
    ], { ...cfg, threshold: 0.4 });
    expect(sizes.get("a")).toBe(3);
    expect(sizes.get("c")).toBe(3);
  });
  it("a cluster below the minimum passes; no text or failed lookup is UNKNOWN", () => {
    const sizes = templateClusters([{ claimId: "a", text: tmpl("1") }, { claimId: "b", text: tmpl("2") }], cfg);
    expect(checkTemplate("a", "t", sizes, cfg).result).toBe("PASS");
    expect(checkTemplate("a", null, sizes, cfg).result).toBe("UNKNOWN");
    expect(checkTemplate("a", "   ", sizes, cfg).result).toBe("UNKNOWN");
    expect(checkTemplate("a", "t", null, cfg).result).toBe("UNKNOWN");
    expect(checkTemplate("zz", "t", sizes, cfg).result).toBe("UNKNOWN");
  });
});

describe("C8 identity", () => {
  const me = { name: "Dana Reyes", email: "dana@example.com", addressLine: "12 Main Street Apt 4", zip: "90804" };
  const other = { name: "Sam Lee", email: "sam@example.com", addressLine: "9 Oak Ave", zip: "10001" };
  const e = (over: Partial<EarlierIdentity>): EarlierIdentity => ({ claimId: "c0", status: "APPROVED", ...other, ...over });
  it("normalises email aliases, street words and name order", () => {
    expect(normaliseEmail(" Dana+claim7@Example.COM ")).toBe("dana@example.com");
    expect(normaliseAddress("12 Main St., Apartment 4", "90804-1234")).toBe(normaliseAddress("12 main street apt 4", "90804"));
    expect(normaliseNameZip("Reyes, Dana", "90804")).toBe(normaliseNameZip("dana REYES", "90804"));
  });
  it.each([
    ["payout email", { email: "DANA+2@example.com" }],
    ["address", { addressLine: "12 Main St Apt 4", zip: "90804" }],
    ["name and ZIP", { name: "Reyes Dana", zip: "90804" }],
  ])("same %s as an approved claim fails", (_w, over) => {
    expect(checkIdentity("c1", me, [e(over)])).toMatchObject({ result: "FAIL", detail: expect.stringContaining("c0") });
  });
  it("a match still pending is UNKNOWN, so two copies cannot both pass", () => {
    expect(checkIdentity("c1", me, [e({ status: "PENDING", email: me.email })]).result).toBe("UNKNOWN");
  });
  it("approved beats pending whatever the order", () => {
    expect(checkIdentity("c1", me, [e({ claimId: "p", status: "PENDING", email: me.email }), e({ claimId: "a", email: me.email })]).result).toBe("FAIL");
  });
  it("a denied claim does not block", () => expect(checkIdentity("c1", me, [e({ status: "CLOSED", email: me.email })]).result).toBe("PASS"));
  it("no match passes, and a claim never matches itself", () => {
    expect(checkIdentity("c1", me, [e({})]).result).toBe("PASS");
    expect(checkIdentity("c0", me, [e({ email: me.email })]).result).toBe("PASS");
  });
  it("a failed lookup is UNKNOWN", () => {
    expect(checkIdentity("c1", null, []).result).toBe("UNKNOWN");
    expect(checkIdentity("c1", me, null).result).toBe("UNKNOWN");
  });
});

describe("C9 velocity", () => {
  const H = 3_600_000;
  const cfg9 = { maxClaims: 3, hours: 2 };
  const at = (id: string, h: number, ipKey: string | null = "net") => ({ claimId: id, ipKey, atMs: h * H });
  it("catches the first claim of a burst, not only the later ones", () => {
    const all = [at("a", 0), at("b", 0.5), at("c", 1), at("d", 1.5)];
    for (const id of ["a", "b", "c", "d"]) expect(checkVelocity(id, all, cfg9).result).toBe("FAIL");
  });
  it("exactly the maximum passes", () => expect(checkVelocity("a", [at("a", 0), at("b", 1), at("c", 2)], cfg9).result).toBe("PASS"));
  it("spread out, or on other networks, passes", () => {
    expect(checkVelocity("a", [at("a", 0), at("b", 3), at("c", 6), at("d", 9)], cfg9).result).toBe("PASS");
    expect(checkVelocity("a", [at("a", 0), at("b", 0, "x"), at("c", 0, "y"), at("d", 0, "z")], cfg9).result).toBe("PASS");
  });
  it("a claim outside the busy window is not blamed for it", () => {
    const all = [at("early", 0), at("b", 3), at("c", 3.1), at("d", 3.2), at("e", 3.3)];
    expect(checkVelocity("early", all, cfg9).result).toBe("PASS");
    expect(checkVelocity("e", all, cfg9).result).toBe("FAIL");
  });
  it("no network or a failed lookup is UNKNOWN", () => {
    expect(checkVelocity("a", [at("a", 0, null)], cfg9).result).toBe("UNKNOWN");
    expect(checkVelocity("a", null, cfg9).result).toBe("UNKNOWN");
    expect(checkVelocity("gone", [at("a", 0)], cfg9).result).toBe("UNKNOWN");
  });
  it("the key groups a /24 and never holds the raw address", () => {
    const k = ipPrefixKey("203.0.113.7", "s");
    expect(k).toBe(ipPrefixKey("203.0.113.200", "s"));
    expect(k).not.toBe(ipPrefixKey("203.0.114.7", "s"));
    expect(k).not.toBe(ipPrefixKey("203.0.113.7", "other-secret"));
    expect(k).not.toContain("203");
  });
  it("groups an IPv6 /48; junk gives null", () => {
    expect(ipPrefixKey("2001:db8:1:2::1", "s")).toBe(ipPrefixKey("2001:db8:1:ffff::9", "s"));
    expect(ipPrefixKey("2001:db8:1::", "s")).toBe(ipPrefixKey("2001:db8:1:2::", "s"));
    expect(ipPrefixKey("2001:db8:1::", "s")).not.toBe(ipPrefixKey("2001:db8:2::", "s"));
    for (const bad of ["999.1.1.1", "hello", ""]) expect(ipPrefixKey(bad, "s")).toBeNull();
  });
});
