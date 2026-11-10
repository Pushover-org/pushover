// Analysts, sessions and money proposals (migration 0006). Password hashing and the login rules
// live in packages/desk; this file only reads and writes rows.
import type { Pool, PoolClient, Queryable } from "../pool.ts";
import { appendAudit } from "./claims.ts";

export type AnalystRole = "analyst" | "supervisor";

export interface Analyst {
  id: number;
  email: string;
  name: string;
  role: AnalystRole;
}

interface AnalystRow {
  id: string;
  email: string;
  name: string;
  role: AnalystRole;
}
const toAnalyst = (r: AnalystRow): Analyst => ({ id: Number(r.id), email: r.email, name: r.name, role: r.role });

export async function insertAnalyst(db: Queryable, a: { email: string; name: string; role: AnalystRole; passwordHash: string }): Promise<Analyst> {
  const { rows } = await db.query<AnalystRow>(
    "INSERT INTO analysts (email, name, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role",
    [a.email, a.name, a.role, a.passwordHash],
  );
  return toAnalyst(rows[0] as AnalystRow);
}

/** Sets a new password and role for an existing analyst, or creates one. Used by the seed and the admin script. */
export async function upsertAnalyst(db: Queryable, a: { email: string; name: string; role: AnalystRole; passwordHash: string }): Promise<Analyst> {
  const { rows } = await db.query<AnalystRow>(
    `INSERT INTO analysts (email, name, role, password_hash) VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, password_hash = EXCLUDED.password_hash, disabled = false
     RETURNING id, email, name, role`,
    [a.email, a.name, a.role, a.passwordHash],
  );
  return toAnalyst(rows[0] as AnalystRow);
}

/** The enabled analyst with this email, with the stored hash. */
export async function analystForLogin(db: Queryable, email: string): Promise<(Analyst & { passwordHash: string }) | null> {
  const { rows } = await db.query<AnalystRow & { password_hash: string }>(
    "SELECT id, email, name, role, password_hash FROM analysts WHERE email = $1 AND NOT disabled",
    [email],
  );
  const r = rows[0];
  return r ? { ...toAnalyst(r), passwordHash: r.password_hash } : null;
}

export async function insertSession(db: Queryable, a: { tokenHash: Buffer; analystId: number; expiresAt: Date }): Promise<void> {
  await db.query("INSERT INTO analyst_sessions (token_hash, analyst_id, expires_at) VALUES ($1, $2, $3)", [a.tokenHash, a.analystId, a.expiresAt]);
}

/** The analyst behind a live session. Expired sessions and disabled analysts open nothing. */
export async function sessionAnalyst(db: Queryable, tokenHash: Buffer): Promise<Analyst | null> {
  const { rows } = await db.query<AnalystRow>(
    `SELECT a.id, a.email, a.name, a.role FROM analyst_sessions s JOIN analysts a ON a.id = s.analyst_id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND NOT a.disabled`,
    [tokenHash],
  );
  return rows[0] ? toAnalyst(rows[0]) : null;
}

export async function deleteSession(db: Queryable, tokenHash: Buffer): Promise<void> {
  await db.query("DELETE FROM analyst_sessions WHERE token_hash = $1", [tokenHash]);
}

/** Failed logins in the last `minutes`, for this email or from this network. Read from the audit log. */
export async function recentFailedLogins(db: Queryable, a: { email: string; network: string | null; minutes: number }): Promise<{ byEmail: number; byNetwork: number }> {
  const { rows } = await db.query<{ by_email: number; by_network: number }>(
    `SELECT count(*) FILTER (WHERE subject = $1)::int AS by_email,
            count(*) FILTER (WHERE $2::text IS NOT NULL AND detail->>'network' = $2)::int AS by_network
     FROM audit_log WHERE action = 'login_failed' AND at > now() - make_interval(mins => $3)`,
    [a.email, a.network, a.minutes],
  );
  return { byEmail: rows[0]?.by_email ?? 0, byNetwork: rows[0]?.by_network ?? 0 };
}

export type ProposalStatus = "PROPOSED" | "APPROVED" | "CANCELLED" | "SUPERSEDED";

export interface MoneyProposal {
  id: number;
  settlementId: string;
  kind: "CLAIMS" | "CY_PRES";
  planHash: Buffer;
  plan: unknown;
  totalCents: number;
  proposedBy: Analyst;
  proposedAt: Date;
  expiresAt: Date;
  status: ProposalStatus;
  decidedBy: Analyst | null;
  decidedAt: Date | null;
}

const PROPOSAL_SQL = `
SELECT p.id, p.settlement_id, p.kind, p.plan_hash, p.plan, p.total_cents, p.proposed_at, p.expires_at, p.status, p.decided_at,
       a.id AS a_id, a.email AS a_email, a.name AS a_name, a.role AS a_role,
       d.id AS d_id, d.email AS d_email, d.name AS d_name, d.role AS d_role
FROM money_proposals p JOIN analysts a ON a.id = p.proposed_by LEFT JOIN analysts d ON d.id = p.decided_by`;

interface ProposalRow {
  id: string; settlement_id: string; kind: "CLAIMS" | "CY_PRES"; plan_hash: Buffer; plan: unknown; total_cents: string; proposed_at: Date; expires_at: Date; status: ProposalStatus; decided_at: Date | null;
  a_id: string; a_email: string; a_name: string; a_role: AnalystRole; d_id: string | null; d_email: string | null; d_name: string | null; d_role: AnalystRole | null;
}

const toProposal = (r: ProposalRow): MoneyProposal => ({
  id: Number(r.id), settlementId: r.settlement_id, kind: r.kind, planHash: r.plan_hash, plan: r.plan, totalCents: Number(r.total_cents),
  proposedBy: toAnalyst({ id: r.a_id, email: r.a_email, name: r.a_name, role: r.a_role }), proposedAt: r.proposed_at, expiresAt: r.expires_at, status: r.status,
  decidedBy: r.d_id ? toAnalyst({ id: r.d_id, email: r.d_email ?? "", name: r.d_name ?? "", role: r.d_role ?? "analyst" }) : null, decidedAt: r.decided_at,
});

export async function getProposal(db: Queryable, id: number): Promise<MoneyProposal | null> {
  const { rows } = await db.query<ProposalRow>(`${PROPOSAL_SQL} WHERE p.id = $1`, [id]);
  return rows[0] ? toProposal(rows[0]) : null;
}

/** The open proposal for a settlement and kind, expired or not. */
export async function openProposal(db: Queryable, settlementId: string, kind: "CLAIMS" | "CY_PRES"): Promise<MoneyProposal | null> {
  const { rows } = await db.query<ProposalRow>(`${PROPOSAL_SQL} WHERE p.settlement_id = $1 AND p.kind = $2 AND p.status = 'PROPOSED'`, [settlementId, kind]);
  return rows[0] ? toProposal(rows[0]) : null;
}

/** Records a new proposal, superseding any open one for the same settlement and kind. */
export async function insertProposal(
  c: PoolClient,
  a: { settlementId: string; kind: "CLAIMS" | "CY_PRES"; planHash: Buffer; plan: unknown; totalCents: number; by: Analyst; ttlMinutes: number },
): Promise<number> {
  await c.query(
    "UPDATE money_proposals SET status = 'SUPERSEDED', decided_by = $3, decided_at = now() WHERE settlement_id = $1 AND kind = $2 AND status = 'PROPOSED'",
    [a.settlementId, a.kind, a.by.id],
  );
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO money_proposals (settlement_id, kind, plan_hash, plan, total_cents, proposed_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(mins => $7)) RETURNING id`,
    [a.settlementId, a.kind, a.planHash, JSON.stringify(a.plan), a.totalCents, a.by.id, a.ttlMinutes],
  );
  const id = Number((rows[0] as { id: string }).id);
  await appendAudit(c, { actor: `analyst:${a.by.email}`, action: "money_proposed", subject: a.settlementId, detail: { proposal_id: id, kind: a.kind, total_cents: a.totalCents, plan_hash: a.planHash.toString("hex") } });
  return id;
}

/**
 * Moves an open proposal to a final status. Returns false when it was no longer open (someone
 * else decided it first). The database refuses a self-approval, a non-supervisor and an expired one.
 */
export async function decideProposal(c: PoolClient, a: { id: number; status: "APPROVED" | "CANCELLED" | "SUPERSEDED"; by: Analyst }): Promise<boolean> {
  const res = await c.query("UPDATE money_proposals SET status = $2, decided_by = $3, decided_at = now() WHERE id = $1 AND status = 'PROPOSED'", [a.id, a.status, a.by.id]);
  if (res.rowCount !== 1) return false;
  await appendAudit(c, { actor: `analyst:${a.by.email}`, action: `money_${a.status.toLowerCase()}`, subject: String(a.id), detail: { proposal_id: a.id } });
  return true;
}

export async function analystCount(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM analysts WHERE NOT disabled");
  return rows[0]?.n ?? 0;
}
