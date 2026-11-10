// Server-only data access for the web app: one pool, the desk, and the read queries the screens
// use. Every number on a screen comes from the decisions, findings and checks stored here.
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { CHECK_NAMES, FindingsSchema, parseSettlement, type CheckResult, type Findings, type Settlement } from "@proofofclaim/claims";
import { loadTaxTable, PROVISIONAL_CONFIG } from "@proofofclaim/checks";
import { createPool, getSettlementConfig, type Pool } from "@proofofclaim/db";
import { identityKeysFromEnv, type Desk, type IdentityKeys } from "@proofofclaim/desk";
import { allocate } from "@proofofclaim/distribute";
import { CostGuard, examine } from "@proofofclaim/examiner";

export const DEMO_SETTLEMENT = "acme-restaurant-beverage";
/** Passed explicitly: the package default (a URL relative to its source) does not survive bundling. */
const TAX_TABLE = path.resolve(process.cwd(), "../../data/tax-rates.json");
/** PayPal's fee per payout item, as the sandbox charged it (docs/sandbox-findings.md). */
export const FEE_PER_ITEM_CENTS = 25;

const g = globalThis as unknown as { __pocPool?: Pool; __pocGuard?: CostGuard };

export function pool(): Pool {
  g.__pocPool ??= createPool();
  return g.__pocPool;
}

export async function settlement(id: string): Promise<Settlement | null> {
  const raw = await getSettlementConfig(pool(), id).catch(() => null);
  return raw ? parseSettlement(raw) : null;
}

/** The desk for one settlement. The examiner is used only when an API key is configured. */
export async function desk(id: string): Promise<Desk | null> {
  const s = await settlement(id);
  if (!s) return null;
  // A daily-sized cap for the public demo; restarting the server resets it.
  g.__pocGuard ??= new CostGuard(Number(process.env["DEMO_AI_BUDGET_USD"] ?? "1"), 0);
  const key = process.env["ANTHROPIC_API_KEY"];
  const client = key ? new Anthropic({ apiKey: key }) : null;
  const guard = g.__pocGuard;
  return {
    pool: pool(), settlement: s, table: loadTaxTable(TAX_TABLE), config: PROVISIONAL_CONFIG, networkSecret: process.env["NETWORK_SECRET"] ?? "demo-network-secret",
    read: client ? (input) => examine({ client, model: process.env["PUSHOVER_MODEL"] ?? "claude-haiku-5-5", guard }, input) : null,
    keys: identityKeys(),
  };
}

/**
 * The keys that seal and pseudonymise PayPal payer IDs. Required in production; elsewhere a missing
 * pair only stops PayPal-logged-in claims from being filed or paid, with an error naming the variable.
 */
export function identityKeys(): IdentityKeys | null {
  try {
    return identityKeysFromEnv();
  } catch (err) {
    if (process.env["NODE_ENV"] === "production") throw err;
    return null;
  }
}

export type Outcome = "APPROVE" | "DENY" | "NEED_MORE" | "REVIEW";

export interface ClaimView {
  id: string;
  seq: number;
  tier: "proof" | "no_proof";
  unitsClaimed: number;
  name: string;
  email: string;
  state: string;
  status: string;
  submittedAt: string;
  outcome: Outcome | null;
  reason: string | null;
  rule: number | null;
  units: number | null;
  entitlementCents: number | null;
  decidedBy: string | null;
  hasEvidence: boolean;
  merchant: string | null;
  purchaseDate: string | null;
  totalCents: number | null;
  confidence: string | null;
  modelSaid: "approve" | "deny" | null;
  failed: string[];
  unknown: string[];
  /** C7's cluster size, when the template check ran. */
  cluster: number | null;
  paypalVerified: boolean | null;
  /** The PayPal account's per-settlement pseudonym; the payer ID itself is never shown. */
  paypalPseudonym: string | null;
}

interface Row {
  id: string; seq: string; tier: "proof" | "no_proof"; units_claimed: number; claimant_name: string; payout_email: string; state: string; status: string; submitted_at: Date;
  outcome: Outcome | null; reason: string | null; rule: number | null; units: number | null; entitlement_cents: number | null; decided_by: string | null;
  has_evidence: boolean; findings: unknown; failed: string[] | null; unknown: string[] | null; c7: string | null; paypal_verified: boolean | null; paypal_pseudonym: string | null;
}

const CLAIMS_SQL = `
SELECT c.id, c.seq, c.tier, c.units_claimed, c.claimant_name, c.payout_email, c.state, c.status, c.submitted_at, c.paypal_verified, c.paypal_pseudonym,
       d.outcome, d.reason, d.rule, d.units, d.entitlement_cents, d.decided_by,
       EXISTS (SELECT 1 FROM claim_evidence e WHERE e.claim_id = c.id) AS has_evidence,
       f.findings,
       (SELECT array_agg(check_id ORDER BY check_id) FROM check_results r WHERE r.decision_id = sd.id AND r.result = 'FAIL') AS failed,
       (SELECT array_agg(check_id ORDER BY check_id) FROM check_results r WHERE r.decision_id = sd.id AND r.result = 'UNKNOWN') AS unknown,
       (SELECT detail FROM check_results r WHERE r.decision_id = sd.id AND r.check_id = 'C7') AS c7
FROM claims c
LEFT JOIN LATERAL (SELECT * FROM decisions x WHERE x.claim_id = c.id ORDER BY x.id DESC LIMIT 1) d ON true
LEFT JOIN LATERAL (SELECT * FROM decisions x WHERE x.claim_id = c.id AND x.decided_by = 'system' ORDER BY x.id DESC LIMIT 1) sd ON true
LEFT JOIN LATERAL (SELECT findings FROM findings x WHERE x.claim_id = c.id ORDER BY x.id DESC LIMIT 1) f ON true
WHERE c.settlement_id = $1`;

function toView(r: Row): ClaimView {
  const parsed = r.findings ? FindingsSchema.safeParse(r.findings) : null;
  const f: Findings | null = parsed?.success ? parsed.data : null;
  const cluster = r.c7 ? Number(/cluster of (\d+)/.exec(r.c7)?.[1] ?? NaN) : NaN;
  return {
    id: r.id, seq: Number(r.seq), tier: r.tier, unitsClaimed: r.units_claimed, name: r.claimant_name, email: r.payout_email, state: r.state, status: r.status,
    submittedAt: r.submitted_at.toISOString(), outcome: r.outcome, reason: r.reason, rule: r.rule, units: r.units, entitlementCents: r.entitlement_cents, decidedBy: r.decided_by,
    hasEvidence: r.has_evidence, merchant: f?.merchant_name ?? null, purchaseDate: f?.purchase_date ?? null, totalCents: f?.total_cents ?? null,
    confidence: f?.confidence ?? null, modelSaid: f?.model_recommendation ?? null, failed: r.failed ?? [], unknown: r.unknown ?? [],
    cluster: Number.isFinite(cluster) ? cluster : null, paypalVerified: r.paypal_verified, paypalPseudonym: r.paypal_pseudonym,
  };
}

export async function claimViews(settlementId: string): Promise<ClaimView[]> {
  const { rows } = await pool().query<Row>(`${CLAIMS_SQL} ORDER BY c.seq`, [settlementId]);
  return rows.map(toView);
}

export async function claimView(id: string): Promise<(ClaimView & { settlementId: string }) | null> {
  const { rows } = await pool().query<Row & { settlement_id: string }>(`${CLAIMS_SQL.replace("WHERE c.settlement_id = $1", "WHERE c.id = $1")}`.replace("SELECT c.id,", "SELECT c.settlement_id, c.id,"), [id]);
  const r = rows[0];
  return r ? { ...toView(r), settlementId: r.settlement_id } : null;
}

export interface ClaimDetail {
  claim: ClaimView & { settlementId: string };
  declaration: string;
  addressLine: string;
  zip: string;
  findings: Findings | null;
  examiner: { status: string; model: string } | null;
  checks: (CheckResult & { name: string })[];
  history: { id: number; outcome: string; reason: string; rule: number | null; decidedBy: string; at: string }[];
}

export async function claimDetail(id: string): Promise<ClaimDetail | null> {
  const claim = await claimView(id);
  if (!claim) return null;
  const db = pool();
  const [{ rows: base }, { rows: fx }, { rows: hist }] = await Promise.all([
    db.query<{ declaration: string; address_line: string; zip: string }>("SELECT declaration, address_line, zip FROM claims WHERE id = $1", [id]),
    db.query<{ status: string; model: string; findings: unknown }>("SELECT status, model, findings FROM findings WHERE claim_id = $1 ORDER BY id DESC LIMIT 1", [id]),
    db.query<{ id: string; outcome: string; reason: string; rule: number | null; decided_by: string; created_at: Date }>("SELECT id, outcome, reason, rule, decided_by, created_at FROM decisions WHERE claim_id = $1 ORDER BY id", [id]),
  ]);
  const systemDecision = [...hist].reverse().find((h) => h.decided_by === "system");
  const { rows: checks } = systemDecision
    ? await db.query<{ check_id: CheckResult["id"]; result: CheckResult["result"]; detail: string }>("SELECT check_id, result, detail FROM check_results WHERE decision_id = $1", [systemDecision.id])
    : { rows: [] };
  const parsed = fx[0]?.findings ? FindingsSchema.safeParse(fx[0].findings) : null;
  const order = (id: string) => Number(id.slice(1));
  return {
    claim, declaration: base[0]?.declaration ?? "", addressLine: base[0]?.address_line ?? "", zip: base[0]?.zip ?? "",
    findings: parsed?.success ? parsed.data : null, examiner: fx[0] ? { status: fx[0].status, model: fx[0].model } : null,
    checks: checks.map((c) => ({ id: c.check_id, result: c.result, detail: c.detail, name: CHECK_NAMES[c.check_id] })).sort((a, b) => order(a.id) - order(b.id)),
    history: hist.map((h) => ({ id: Number(h.id), outcome: h.outcome, reason: h.reason, rule: h.rule, decidedBy: h.decided_by, at: h.created_at.toISOString() })),
  };
}

export async function evidenceOf(claimId: string): Promise<{ contentType: string; bytes: Buffer } | null> {
  const { rows } = await pool().query<{ content_type: string; bytes: Buffer }>("SELECT content_type, bytes FROM claim_evidence WHERE claim_id = $1 ORDER BY id LIMIT 1", [claimId]);
  return rows[0] ? { contentType: rows[0].content_type, bytes: rows[0].bytes } : null;
}

export interface Tally {
  total: number;
  byOutcome: Record<Outcome | "PENDING", number>;
  /** Average check per approved claim when Distribute runs now, after fees and the reserve. */
  averageCheckCents: number;
  /** The same if every claim were paid as filed. */
  payEveryoneCheckCents: number;
  approvedCents: number;
  heldCents: number;
}

/** What each claim would cost if paid as filed (arm A). */
export const asFiledCents = (c: Pick<ClaimView, "tier" | "unitsClaimed">, s: Settlement) =>
  c.tier === "no_proof" ? s.tiers.noProof.flatCents : Math.min(c.unitsClaimed, s.tiers.proof.maxUnits) * s.tiers.proof.unitCents;

/** `share` scales the fund to the claims present, as the eval scales it for a slice (score.ts). */
export function tally(views: ClaimView[], s: Settlement, share = 1): Tally {
  const byOutcome: Tally["byOutcome"] = { APPROVE: 0, DENY: 0, NEED_MORE: 0, REVIEW: 0, PENDING: 0 };
  for (const v of views) byOutcome[v.outcome ?? "PENDING"]++;
  const approved = views.filter((v) => v.outcome === "APPROVE" && v.entitlementCents);
  const fund = { fundCents: Math.floor(s.fundCents * share), adminReserveCents: Math.floor(s.adminReserveCents * share), feePerItemCents: FEE_PER_ITEM_CENTS };
  const avg = (entitlements: { claimId: string; entitlementCents: number }[]) => {
    if (entitlements.length === 0) return 0;
    const a = allocate({ ...fund, entitlements });
    return Math.round(a.payouts.reduce((t, p) => t + p.payoutCents, 0) / entitlements.length);
  };
  return {
    total: views.length, byOutcome,
    averageCheckCents: avg(approved.map((v) => ({ claimId: v.id, entitlementCents: v.entitlementCents ?? 0 }))),
    payEveryoneCheckCents: avg(views.map((v) => ({ claimId: v.id, entitlementCents: asFiledCents(v, s) }))),
    approvedCents: approved.reduce((t, v) => t + (v.entitlementCents ?? 0), 0),
    heldCents: views.filter((v) => v.outcome === "REVIEW").reduce((t, v) => t + asFiledCents(v, s), 0),
  };
}

/** The demo's labelled ground truth (claims-v1 manifest), shown beside each decision so judges can check it. */
export interface Truth {
  group: string;
  truth: "honest" | "fraud" | "ineligible";
  expected: string;
  why: string;
}

let truthCache: Map<string, Truth> | null = null;
export async function demoTruth(): Promise<Map<string, Truth>> {
  if (truthCache) return truthCache;
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const file = path.resolve(process.cwd(), "../../packages/eval/corpus/claims-v1/manifest.jsonl");
  const m = new Map<string, Truth>();
  for (const l of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
    const c = JSON.parse(l) as { id: string; group: string; truth: Truth["truth"]; expected: { outcome: string }; why: string };
    m.set(c.id, { group: c.group, truth: c.truth, expected: c.expected.outcome, why: c.why });
  }
  truthCache = m;
  return m;
}

/** The labelled set has 157 claims; the demo's fund is scaled to its share, as in the eval. */
export const CORPUS_SIZE = 157;
