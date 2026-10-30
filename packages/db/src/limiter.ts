import type { Pool } from "./pool.ts";

export interface PgRateLimiterOptions {
  /** e.g. "paypal-sandbox": every process using the same key shares one budget. */
  key: string;
  perMinute: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * The sliding-window limiter from packages/paypal, kept in Postgres so the web and
 * worker services (which may share an egress IP, spec §4.7.1) never exceed the sandbox
 * limit together. Satisfies @pushover/paypal's RateLimiter interface.
 */
export class PgRateLimiter {
  private readonly pool: Pool;
  private readonly key: string;
  private readonly perMinute: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(pool: Pool, o: PgRateLimiterOptions) {
    if (!Number.isInteger(o.perMinute) || o.perMinute < 1) throw new Error("perMinute must be a positive integer");
    this.pool = pool;
    this.key = o.key;
    this.perMinute = o.perMinute;
    this.now = o.now ?? Date.now;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async take(): Promise<void> {
    for (;;) {
      const waitMs = await this.tryTake();
      if (waitMs === 0) return;
      await this.sleep(waitMs);
    }
  }

  /** 0 when granted, otherwise how long until the oldest grant leaves the window. */
  private async tryTake(): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO rate_buckets (key) VALUES ($1) ON CONFLICT (key) DO NOTHING", [this.key]);
      await client.query("SELECT 1 FROM rate_buckets WHERE key = $1 FOR UPDATE", [this.key]);
      const now = this.now();
      const windowStart = new Date(now - 60_000);
      await client.query("DELETE FROM rate_grants WHERE key = $1 AND at <= $2", [this.key, windowStart]);
      const { rows } = await client.query<{ n: number; oldest: Date | null }>(
        "SELECT count(*)::int AS n, min(at) AS oldest FROM rate_grants WHERE key = $1",
        [this.key],
      );
      const { n, oldest } = rows[0] ?? { n: 0, oldest: null };
      if (n < this.perMinute) {
        await client.query("INSERT INTO rate_grants (key, at) VALUES ($1, $2)", [this.key, new Date(now)]);
        await client.query("UPDATE rate_buckets SET updated_at = now() WHERE key = $1", [this.key]);
        await client.query("COMMIT");
        return 0;
      }
      await client.query("COMMIT");
      return Math.max(1, (oldest?.getTime() ?? now) + 60_000 - now);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}
