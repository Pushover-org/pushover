/**
 * Anything that can hand out permission to make one PayPal request.
 * The in-memory limiter below covers one process; a Postgres-backed one
 * (rate_buckets table, spec §4.7.1) will share the budget across web and worker.
 */
export interface RateLimiter {
  take(): Promise<void>;
}

export interface SlidingWindowOptions {
  /** Requests allowed in any rolling 60 s window. */
  perMinute: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const WINDOW_MS = 60_000;

/**
 * At most `perMinute` requests in ANY rolling 60 s window.
 *
 * Not a classic token bucket: a bucket with capacity N refilling N/min can let
 * through 2N requests inside one minute (a full burst, then the refill). With
 * N = 40 that is 80, over the sandbox's 50/min limit, which earns a 5 minute
 * block (spec §3.4). A sliding window cannot exceed N.
 */
export class SlidingWindowLimiter implements RateLimiter {
  private readonly perMinute: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly granted: number[] = [];
  private queue: Promise<void> = Promise.resolve();

  constructor(o: SlidingWindowOptions) {
    if (!Number.isInteger(o.perMinute) || o.perMinute < 1) throw new Error("perMinute must be a positive integer");
    this.perMinute = o.perMinute;
    this.now = o.now ?? Date.now;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  take(): Promise<void> {
    // FIFO: each caller waits for the one before it.
    const turn = this.queue.then(() => this.acquire());
    this.queue = turn.catch(() => undefined);
    return turn;
  }

  private async acquire(): Promise<void> {
    for (;;) {
      const now = this.now();
      let oldest = this.granted[0];
      while (oldest !== undefined && oldest <= now - WINDOW_MS) {
        this.granted.shift();
        oldest = this.granted[0];
      }
      if (oldest === undefined || this.granted.length < this.perMinute) {
        this.granted.push(now);
        return;
      }
      await this.sleep(oldest + WINDOW_MS - now);
    }
  }
}
