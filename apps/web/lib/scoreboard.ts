// The scoreboard's arithmetic (plan items P21, C6), kept pure so it can be tested without a database.
// For each approach: what it pays to fraud, and how many honest claimants it denies or leaves waiting.

export type Verdict = "paid" | "denied" | "waiting";

export interface ScoredClaim {
  id: string;
  truth: "fraud" | "honest" | string;
  tier: "proof" | "no_proof";
  /** The examiner's own recommendation (logged, never used to decide). */
  modelSaid: "approve" | "deny" | null;
  asFiledCents: number;
  /** The latest decision by the rules alone. */
  system: { outcome: string; entitlementCents: number | null } | null;
  /** The latest decision of any kind, people included. */
  outcome: string | null;
  entitlementCents: number | null;
  /** The status of the linked group the claim is in, if any. */
  group: "HELD" | "CLEARED" | "DENIED" | null;
}

export interface ScoreRow {
  key: string;
  label: string;
  note: string;
  fraudPaidCents: number;
  honestDenied: number;
  honestWaiting: number;
}

export interface Scoreboard {
  labelled: number;
  fraud: number;
  honest: number;
  rows: ScoreRow[];
  /** C6: fraud with no linked group around it, which checking people alone can't see. */
  lone: {
    fraud: number;
    askedCents: number;
    stoppedByChecks: number;
    paidCents: number;
  };
}

const of = (o: string | null | undefined): Verdict =>
  o === "APPROVE" ? "paid" : o === "DENY" ? "denied" : "waiting";
const approvedCents = (
  outcome: string | null | undefined,
  cents: number | null,
) => (outcome === "APPROVE" ? (cents ?? 0) : 0);

const APPROACHES: {
  key: string;
  label: string;
  note: string;
  verdict: (c: ScoredClaim) => [Verdict, number];
}[] = [
  {
    key: "everyone",
    label: "Pay everyone as filed",
    note: "No checks at all.",
    verdict: (c) => ["paid", c.asFiledCents],
  },
  {
    key: "examiner",
    label: "The examiner's own recommendation",
    note: "Receipt claims as the AI recommended (logged, never used); claims without a receipt paid as filed.",
    verdict: (c) =>
      c.tier === "proof" && c.modelSaid === "deny"
        ? ["denied", 0]
        : ["paid", c.asFiledCents],
  },
  {
    key: "rings",
    label: "Checking the person only",
    note: "Everyone paid unless their claim is in a linked group (held for a person). No proof is checked.",
    verdict: (c) => (c.group ? ["waiting", 0] : ["paid", c.asFiledCents]),
  },
  {
    key: "rules",
    label: "The rules",
    note: "Decision table v1 on the checks, before any person acts.",
    verdict: (c) => [
      of(c.system?.outcome),
      approvedCents(c.system?.outcome, c.system?.entitlementCents ?? null),
    ],
  },
  {
    key: "now",
    label: "The rules with your decisions",
    note: "Every decision as it stands now, people included; a claim in a held group waits, one in a denied group is denied.",
    verdict: (c) =>
      c.group === "HELD"
        ? ["waiting", 0]
        : c.group === "DENIED"
          ? ["denied", 0]
          : [of(c.outcome), approvedCents(c.outcome, c.entitlementCents)],
  },
];

export function score(claims: ScoredClaim[]): Scoreboard {
  const fraud = claims.filter((c) => c.truth === "fraud");
  const honest = claims.filter((c) => c.truth === "honest");
  const rows = APPROACHES.map((a) => {
    const v = new Map(claims.map((c) => [c.id, a.verdict(c)]));
    return {
      key: a.key,
      label: a.label,
      note: a.note,
      fraudPaidCents: fraud.reduce(
        (t, c) =>
          t + (v.get(c.id)?.[0] === "paid" ? (v.get(c.id)?.[1] ?? 0) : 0),
        0,
      ),
      honestDenied: honest.filter((c) => v.get(c.id)?.[0] === "denied").length,
      honestWaiting: honest.filter((c) => v.get(c.id)?.[0] === "waiting")
        .length,
    };
  });
  const lone = fraud.filter((c) => c.group === null);
  return {
    labelled: claims.length,
    fraud: fraud.length,
    honest: honest.length,
    rows,
    lone: {
      fraud: lone.length,
      askedCents: lone.reduce((t, c) => t + c.asFiledCents, 0),
      stoppedByChecks: lone.filter((c) => c.outcome !== "APPROVE").length,
      paidCents: lone.reduce(
        (t, c) => t + approvedCents(c.outcome, c.entitlementCents),
        0,
      ),
    },
  };
}
