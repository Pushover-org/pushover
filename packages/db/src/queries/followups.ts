// Appeals and requested documents sent after filing (migration 0011; plan items P9, C9, B3).
import type { Queryable } from "../pool.ts";
import type { ClaimState } from "./claims.ts";

export interface Followup {
  id: number;
  claimId: string;
  kind: "APPEAL" | "DOCUMENT";
  fromStatus: ClaimState;
  message: string | null;
  evidenceId: number | null;
  at: Date;
  /** An appeal is open until a person decides the claim, or a group it is held in, after it. A document is never open. */
  open: boolean;
}

interface Row {
  id: string; claim_id: string; kind: Followup["kind"]; from_status: ClaimState; message: string | null; evidence_id: string | null; created_at: Date; open: boolean;
}
const from = (r: Row): Followup => ({
  id: Number(r.id), claimId: r.claim_id, kind: r.kind, fromStatus: r.from_status, message: r.message, evidenceId: r.evidence_id === null ? null : Number(r.evidence_id), at: r.created_at, open: r.open,
});

// Answered by a person: a newer analyst decision on the claim, or a group holding it decided since.
const SELECT = `SELECT f.id, f.claim_id, f.kind, f.from_status, f.message, f.evidence_id, f.created_at,
  (f.kind = 'APPEAL'
    AND NOT EXISTS (SELECT 1 FROM decisions d WHERE d.claim_id = f.claim_id AND d.decided_by LIKE 'analyst:%' AND d.created_at > f.created_at)
    AND NOT EXISTS (SELECT 1 FROM ring_groups g WHERE g.members ? f.claim_id AND g.decided_at > f.created_at)) AS open
  FROM claim_followups f`;

export async function insertFollowup(db: Queryable, f: { claimId: string; kind: Followup["kind"]; fromStatus: ClaimState; message: string | null; evidenceId: number | null }): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    "INSERT INTO claim_followups (claim_id, kind, from_status, message, evidence_id) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [f.claimId, f.kind, f.fromStatus, f.message, f.evidenceId],
  );
  return Number((rows[0] as { id: string }).id);
}

export async function followupsOf(db: Queryable, claimId: string): Promise<Followup[]> {
  const { rows } = await db.query<Row>(`${SELECT} WHERE f.claim_id = $1 ORDER BY f.id`, [claimId]);
  return rows.map(from);
}

/** Claims in a settlement with an appeal still waiting for a person. */
export async function openAppeals(db: Queryable, settlementId: string): Promise<Followup[]> {
  const { rows } = await db.query<Row>(`SELECT * FROM (${SELECT} JOIN claims c ON c.id = f.claim_id WHERE c.settlement_id = $1) x WHERE x.open ORDER BY x.id`, [settlementId]);
  return rows.map(from);
}

/**
 * The documents the checks read: the one filed, and any the rules asked for. A document sent with an
 * appeal is for the person deciding the appeal, so the checks never pick it up.
 */
export async function checkedEvidence(db: Queryable, claimId: string): Promise<{ id: number; contentType: string; bytes: Buffer; sha256: string; phash: string | null }[]> {
  const { rows } = await db.query<{ id: string; content_type: string; bytes: Buffer; sha256: string; phash: string | null }>(
    `SELECT e.id, e.content_type, e.bytes, e.sha256, e.phash FROM claim_evidence e
     WHERE e.claim_id = $1 AND NOT EXISTS (SELECT 1 FROM claim_followups f WHERE f.evidence_id = e.id AND f.kind = 'APPEAL') ORDER BY e.id`,
    [claimId],
  );
  return rows.map((r) => ({ id: Number(r.id), contentType: r.content_type, bytes: r.bytes, sha256: r.sha256, phash: r.phash }));
}
