// Ledger commitments (migration 0009). The ledger's maths lives in packages/ledger; this file only
// stores and reads commitments.
import type { PoolClient, Queryable } from "../pool.ts";
import { appendAudit } from "./claims.ts";

export interface StoredCommitment {
  id: number;
  settlementId: string;
  proposalId: number;
  kind: "CLAIMS" | "CY_PRES";
  round: number;
  root: string;
  digest: string;
  commitment: unknown;
  leaves: unknown[];
  drandRound: number;
  committedAt: Date;
  beacon: { round: number; randomness: string; signature: string } | null;
  sample: string[] | null;
}

interface Row {
  id: string; settlement_id: string; proposal_id: string; kind: "CLAIMS" | "CY_PRES"; round: number; root: Buffer; digest: Buffer; commitment: unknown; leaves: unknown[];
  drand_round: string; committed_at: Date; beacon: StoredCommitment["beacon"]; sample: string[] | null;
}
const from = (r: Row): StoredCommitment => ({
  id: Number(r.id), settlementId: r.settlement_id, proposalId: Number(r.proposal_id), kind: r.kind, round: r.round, root: r.root.toString("hex"), digest: r.digest.toString("hex"),
  commitment: r.commitment, leaves: r.leaves, drandRound: Number(r.drand_round), committedAt: r.committed_at, beacon: r.beacon, sample: r.sample,
});

export async function insertCommitment(
  c: PoolClient,
  a: { settlementId: string; proposalId: number; kind: "CLAIMS" | "CY_PRES"; round: number; root: string; digest: string; commitment: unknown; leaves: unknown[]; drandRound: number; by: string },
): Promise<number> {
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO ledger_commitments (settlement_id, proposal_id, kind, round, root, digest, commitment, leaves, drand_round)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [a.settlementId, a.proposalId, a.kind, a.round, Buffer.from(a.root, "hex"), Buffer.from(a.digest, "hex"), JSON.stringify(a.commitment), JSON.stringify(a.leaves), a.drandRound],
  );
  const id = Number((rows[0] as { id: string }).id);
  await appendAudit(c, { actor: a.by, action: "ledger_committed", subject: a.settlementId, detail: { commitment_id: id, root: a.root, digest: a.digest, drand_round: a.drandRound, leaves: a.leaves.length } });
  return id;
}

export async function getCommitment(db: Queryable, id: number): Promise<StoredCommitment | null> {
  const { rows } = await db.query<Row>("SELECT * FROM ledger_commitments WHERE id = $1", [id]);
  return rows[0] ? from(rows[0]) : null;
}

export async function commitmentsOf(db: Queryable, settlementId: string): Promise<StoredCommitment[]> {
  const { rows } = await db.query<Row>("SELECT * FROM ledger_commitments WHERE settlement_id = $1 ORDER BY id DESC", [settlementId]);
  return rows.map(from);
}

/** Commitments whose drand round should be out by now but whose beacon isn't recorded yet. */
export async function commitmentsAwaitingBeacon(db: Queryable, latestRound: number): Promise<{ id: number; drandRound: number }[]> {
  const { rows } = await db.query<{ id: string; drand_round: string }>("SELECT id, drand_round FROM ledger_commitments WHERE beacon IS NULL AND drand_round <= $1 ORDER BY id", [latestRound]);
  return rows.map((r) => ({ id: Number(r.id), drandRound: Number(r.drand_round) }));
}

/** Records the verified beacon and the sample it picked. Once only (the table refuses a second). */
export async function recordBeacon(db: Queryable, id: number, beacon: { round: number; randomness: string; signature: string }, sample: string[]): Promise<void> {
  await db.query("UPDATE ledger_commitments SET beacon = $2, sample = $3, beacon_checked_at = now() WHERE id = $1", [id, JSON.stringify(beacon), JSON.stringify(sample)]);
  await appendAudit(db, { actor: "worker", action: "ledger_beacon", subject: String(id), detail: { round: beacon.round, sample } });
}

/** PayPal's note on each payout of this commitment's batches, as last read back. */
export async function paypalNotesOf(db: Queryable, commitmentId: number): Promise<{ paypalBatchId: string | null; senderItemId: string; note: string | null }[]> {
  const { rows } = await db.query<{ paypal_batch_id: string | null; sender_item_id: string; paypal_note: string | null }>(
    "SELECT b.paypal_batch_id, i.sender_item_id, i.paypal_note FROM payout_items i JOIN payout_batches b ON b.id = i.batch_id WHERE b.ledger_commitment_id = $1 ORDER BY i.id",
    [commitmentId],
  );
  return rows.map((r) => ({ paypalBatchId: r.paypal_batch_id, senderItemId: r.sender_item_id, note: r.paypal_note }));
}
