import { describe, expect, it } from "vitest";
import { score, type ScoredClaim } from "./scoreboard.ts";

const claim = (id: string, over: Partial<ScoredClaim>): ScoredClaim => ({
  id,
  truth: "honest",
  tier: "proof",
  modelSaid: "approve",
  asFiledCents: 4500,
  system: { outcome: "APPROVE", entitlementCents: 4500 },
  outcome: "APPROVE",
  entitlementCents: 4500,
  group: null,
  ...over,
});

const row = (sb: ReturnType<typeof score>, key: string) => {
  const r = sb.rows.find((x) => x.key === key);
  if (!r) throw new Error(`no row ${key}`);
  return r;
};

describe("the scoreboard", () => {
  // f1: a lone fake the rules deny. f2, f3: a ring, held as a group; the rules approved f2.
  // h1: honest, approved. h2: honest, the rules sent it to review and a person denied it.
  // h3: honest, caught in the ring's group (a false hold). n1: unlabelled-as-either (doesn't qualify).
  const claims = [
    claim("f1", {
      truth: "fraud",
      modelSaid: "deny",
      system: { outcome: "DENY", entitlementCents: null },
      outcome: "DENY",
      entitlementCents: null,
    }),
    claim("f2", { truth: "fraud", modelSaid: "approve", group: "HELD" }),
    claim("f3", {
      truth: "fraud",
      tier: "no_proof",
      modelSaid: null,
      asFiledCents: 1000,
      system: { outcome: "REVIEW", entitlementCents: null },
      outcome: "REVIEW",
      group: "HELD",
    }),
    claim("h1", {}),
    claim("h2", {
      modelSaid: "deny",
      system: { outcome: "REVIEW", entitlementCents: null },
      outcome: "DENY",
      entitlementCents: null,
    }),
    claim("h3", { group: "HELD" }),
    claim("n1", {
      truth: "not_eligible",
      system: { outcome: "DENY", entitlementCents: null },
      outcome: "DENY",
    }),
  ];
  const sb = score(claims);

  it("counts the labels", () => {
    expect([sb.labelled, sb.fraud, sb.honest]).toEqual([7, 3, 3]);
  });

  it("paying everyone pays every fake as filed and no honest claimant waits", () => {
    expect(row(sb, "everyone")).toMatchObject({
      fraudPaidCents: 4500 + 4500 + 1000,
      honestDenied: 0,
      honestWaiting: 0,
    });
  });

  it("the examiner alone denies what it recommended denying, and pays claims without a receipt", () => {
    expect(row(sb, "examiner")).toMatchObject({
      fraudPaidCents: 4500 + 1000,
      honestDenied: 1,
      honestWaiting: 0,
    });
  });

  it("checking the person alone pays the lone fake and holds the whole group, honest member included", () => {
    expect(row(sb, "rings")).toMatchObject({
      fraudPaidCents: 4500,
      honestDenied: 0,
      honestWaiting: 1,
    });
  });

  it("the rules use only the system's decision, ignoring groups and people", () => {
    expect(row(sb, "rules")).toMatchObject({
      fraudPaidCents: 4500,
      honestDenied: 0,
      honestWaiting: 1,
    });
  });

  it("the rules with people's decisions: held groups wait, a person's denial counts", () => {
    expect(row(sb, "now")).toMatchObject({
      fraudPaidCents: 0,
      honestDenied: 1,
      honestWaiting: 1,
    });
  });

  it("a cleared group pays by its decisions; a denied group denies every member", () => {
    const cleared = score(
      claims.map((c) => (c.group ? { ...c, group: "CLEARED" as const } : c)),
    );
    expect(row(cleared, "now")).toMatchObject({
      fraudPaidCents: 4500,
      honestDenied: 1,
      honestWaiting: 0,
    });
    const denied = score(
      claims.map((c) => (c.group ? { ...c, group: "DENIED" as const } : c)),
    );
    expect(row(denied, "now")).toMatchObject({
      fraudPaidCents: 0,
      honestDenied: 2,
      honestWaiting: 0,
    });
  });

  it("lone fakes: fraud outside any group, and what the proof checks did with them", () => {
    expect(sb.lone).toEqual({
      fraud: 1,
      askedCents: 4500,
      stoppedByChecks: 1,
      paidCents: 0,
    });
  });
});
