// Fraud-ring groups and investigations (migration 0010). Detection lives in packages/checks and
// the investigator in packages/examiner; this file stores and reads.
import type { PoolClient, Queryable } from "../pool.ts";
import { appendAudit } from "./claims.ts";

export interface RingClaimRow {
  claimId: string;
  seq: number;
  deviceKey: string | null;
  inboxKey: string | null;
  buildingKey: string | null;
  networkKey: string | null;
  declaration: string;
  filedAt: Date;
  email: string;
  addressLine: string;
  zip: string;
  tier: "proof" | "no_proof";
  unitsClaimed: number;
  state: string;
  status: string;
}

export async function ringClaims(db: Queryable, settlementId: string): Promise<RingClaimRow[]> {
  const { rows } = await db.query<{
    id: string; seq: string; device_key: string | null; inbox_key: string | null; building_key: string | null; ip_key: string | null; declaration: string; submitted_at: Date;
    payout_email: string; address_line: string; zip: string; tier: "proof" | "no_proof"; units_claimed: number; state: string; status: string;
  }>(
    `SELECT id, seq, device_key, inbox_key, building_key, ip_key, declaration, submitted_at, payout_email, address_line, zip, tier, units_claimed, state, status
     FROM claims WHERE settlement_id = $1 ORDER BY seq`,
    [settlementId],
  );
  return rows.map((r) => ({
    claimId: r.id, seq: Number(r.seq), deviceKey: r.device_key, inboxKey: r.inbox_key, buildingKey: r.building_key, networkKey: r.ip_key, declaration: r.declaration,
    filedAt: r.submitted_at, email: r.payout_email, addressLine: r.address_line, zip: r.zip, tier: r.tier, unitsClaimed: r.units_claimed, state: r.state, status: r.status,
  }));
}

/** Fills in signal keys a claim doesn't have yet (claims filed before migration 0010). */
export async function setSignalKeys(db: Queryable, claimId: string, k: { inboxKey: string | null; buildingKey: string | null }): Promise<void> {
  await db.query("UPDATE claims SET inbox_key = COALESCE(inbox_key, $2), building_key = COALESCE(building_key, $3) WHERE id = $1", [claimId, k.inboxKey, k.buildingKey]);
}

export interface StoredGroup {
  id: number;
  signature: string;
  members: string[];
  core: string[];
  signals: Record<string, number>;
  sharedSignals: number;
  active: boolean;
  status: "HELD" | "CLEARED" | "DENIED";
  decidedBy: string | null;
  foundAt: Date;
}

interface GroupRow {
  id: string; signature: string; members: string[]; core: string[]; signals: Record<string, number>; shared_signals: number; active: boolean;
  status: StoredGroup["status"]; decided_by: string | null; found_at: Date;
}
const fromGroup = (r: GroupRow): StoredGroup => ({
  id: Number(r.id), signature: r.signature, members: r.members, core: r.core, signals: r.signals, sharedSignals: r.shared_signals, active: r.active, status: r.status,
  decidedBy: r.decided_by, foundAt: r.found_at,
});

/**
 * Makes the stored groups match what detection found now: new memberships are added, existing
 * ones kept (with their decisions), and groups whose membership no longer exists go inactive.
 */
export async function syncGroups(
  c: PoolClient,
  settlementId: string,
  found: { signature: string; members: string[]; core: string[]; signals: Record<string, number>; sharedSignals: number }[],
): Promise<{ added: number; retired: number }> {
  let added = 0;
  for (const g of found) {
    const res = await c.query(
      `INSERT INTO ring_groups (settlement_id, signature, members, core, signals, shared_signals) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (settlement_id, signature) DO UPDATE SET active = true RETURNING (xmax = 0) AS inserted`,
      [settlementId, g.signature, JSON.stringify(g.members), JSON.stringify(g.core), JSON.stringify(g.signals), g.sharedSignals],
    );
    if ((res.rows[0] as { inserted: boolean } | undefined)?.inserted) added++;
  }
  const retired = await c.query("UPDATE ring_groups SET active = false WHERE settlement_id = $1 AND active AND NOT (signature = ANY($2))", [settlementId, found.map((g) => g.signature)]);
  if (added || retired.rowCount) await appendAudit(c, { actor: "system", action: "rings_detected", subject: settlementId, detail: { groups: found.length, added, retired: retired.rowCount ?? 0 } });
  return { added, retired: retired.rowCount ?? 0 };
}

export async function listGroups(db: Queryable, settlementId: string, opt: { activeOnly?: boolean } = {}): Promise<StoredGroup[]> {
  const { rows } = await db.query<GroupRow>(
    `SELECT * FROM ring_groups WHERE settlement_id = $1 ${opt.activeOnly ? "AND active" : ""} ORDER BY active DESC, jsonb_array_length(members) DESC, id`,
    [settlementId],
  );
  return rows.map(fromGroup);
}

export async function getGroup(db: Queryable, id: number): Promise<(StoredGroup & { settlementId: string }) | null> {
  const { rows } = await db.query<GroupRow & { settlement_id: string }>("SELECT * FROM ring_groups WHERE id = $1", [id]);
  return rows[0] ? { ...fromGroup(rows[0]), settlementId: rows[0].settlement_id } : null;
}

export interface StoredInvestigation {
  id: number;
  groupId: number;
  factsSha256: string;
  facts: unknown;
  labels: Record<string, string>;
  model: string;
  status: "OK" | "REPLAYED" | "INVALID" | "REFUSED" | "NOT_RUN";
  answers: { probability_coordinated: number; pattern: string; strength: number } | null;
  recommendation: "CLEAR" | "DENY_GROUP" | "PERSON_DECIDES";
  error: string | null;
  costUsd: number;
  createdAt: Date;
}

export async function insertInvestigation(db: Queryable, a: Omit<StoredInvestigation, "id" | "createdAt">): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO investigations (group_id, facts_sha256, facts, labels, model, status, answers, recommendation, error, cost_usd)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [a.groupId, a.factsSha256, JSON.stringify(a.facts), JSON.stringify(a.labels), a.model, a.status, a.answers ? JSON.stringify(a.answers) : null, a.recommendation, a.error, a.costUsd],
  );
  return Number((rows[0] as { id: string }).id);
}

export async function latestInvestigation(db: Queryable, groupId: number): Promise<StoredInvestigation | null> {
  const { rows } = await db.query<{
    id: string; group_id: string; facts_sha256: string; facts: unknown; labels: Record<string, string>; model: string; status: StoredInvestigation["status"];
    answers: StoredInvestigation["answers"]; recommendation: StoredInvestigation["recommendation"]; error: string | null; cost_usd: string; created_at: Date;
  }>("SELECT * FROM investigations WHERE group_id = $1 ORDER BY id DESC LIMIT 1", [groupId]);
  const r = rows[0];
  return r
    ? {
      id: Number(r.id), groupId: Number(r.group_id), factsSha256: r.facts_sha256, facts: r.facts, labels: r.labels, model: r.model, status: r.status, answers: r.answers,
      recommendation: r.recommendation, error: r.error, costUsd: Number(r.cost_usd), createdAt: r.created_at,
    }
    : null;
}
