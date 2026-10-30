import pg from "pg";

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;
/** Anything that can run a query: the pool, or a client inside a transaction. */
export type Queryable = Pick<pg.Pool, "query">;

export function createPool(connectionString = process.env["DATABASE_URL"]): pg.Pool {
  if (!connectionString) throw new Error("missing environment variable DATABASE_URL");
  return new pg.Pool({ connectionString, max: 10 });
}

/** Runs fn in a transaction on one client; rolls back on any error. */
export async function withTransaction<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
