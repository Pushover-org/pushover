import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgRateLimiter } from "../src/limiter.ts";
import { migrate } from "../src/migrate.ts";
import { upsertCustomer } from "../src/queries/customers.ts";
import { assignOrder, countPoolCaptures, getOrder, insertPoolOrder, listOrdersForCustomer } from "../src/queries/orders.ts";
import { getActivePolicy } from "../src/queries/policy.ts";
import type { Merchant } from "../src/types.ts";
import { DATABASE_URL, freshDatabase } from "./testdb.ts";

const scarf = { sku: "SCARF-01", name: "Merino scarf", qty: 1, unitCents: 8000, taxCents: 640 };
const mug = { sku: "MUG-01", name: "Stoneware mug", qty: 2, unitCents: 1800, taxCents: 144 };

function poolOrder(merchant: Merchant, ref: string, n: number) {
  return { merchant, ref, paypalOrderId: `PPO-${merchant}-${n}`, items: [scarf], captureId: `CAP-${merchant}-${n}`, captureStatus: "COMPLETED", amountCents: 8640 };
}

const errCode = (p: Promise<unknown>) => p.then(() => "no error", (e: { code?: string }) => e.code);

describe.skipIf(!DATABASE_URL)("packages/db against Postgres", () => {
  let pool: pg.Pool;
  let drop: () => Promise<void>;
  beforeAll(async () => {
    ({ pool, drop } = await freshDatabase());
    for (const merchant of ["GUARDED", "BASELINE"] as const) {
      await upsertCustomer(pool, { merchant, id: "C-1042", displayName: "Dana Reyes", email: "dana@example.com" });
      await upsertCustomer(pool, { merchant, id: "C-2210", displayName: "Marcus Bell", email: "marcus@example.com" });
    }
  });
  afterAll(async () => drop?.());

  describe("migrator", () => {
    it("is a no-op the second time", async () => {
      expect(await migrate(pool)).toEqual([]);
      const { rows } = await pool.query("SELECT version FROM schema_migrations ORDER BY version");
      expect(rows.map((r) => r.version)).toEqual(["0001_init.sql", "0002_roles.sql", "0003_policy_v1.sql", "0004_claims.sql", "0005_identity.sql", "0006_analysts.sql", "0007_claimant_privacy.sql", "0008_money_path.sql", "0009_ledger.sql", "0010_rings.sql", "0011_followups.sql", "0012_assistant_states.sql", "0013_assistants.sql", "0014_instance.sql"]);
    });

    it("names this database once, in ten hex characters (0014)", async () => {
      const { deploymentInstance } = await import("../src/index.ts");
      const id = await deploymentInstance(pool);
      expect(id).toMatch(/^[0-9a-f]{10}$/);
      expect(await deploymentInstance(pool)).toBe(id);
      await expect(pool.query("INSERT INTO deployment_instance (only_row) VALUES (true)")).rejects.toThrow();
    });

    it("refuses to continue when an applied migration was edited", async () => {
      await pool.query("UPDATE schema_migrations SET checksum = 'tampered' WHERE version = '0003_policy_v1.sql'");
      await expect(migrate(pool)).rejects.toThrow(/0003_policy_v1.sql was changed/);
      await pool.query("DELETE FROM schema_migrations WHERE version = '0003_policy_v1.sql'");
      await pool.query("DELETE FROM policy");
      expect(await migrate(pool)).toEqual(["0003_policy_v1.sql"]);
    });
  });

  it("seeds store policy v1 exactly as spec §5.4", async () => {
    expect(await getActivePolicy(pool)).toEqual({
      version: 1, windowDays: 30, humanThresholdCents: 25000, dailyCapCents: 200000, velocityMax: 3, velocityWindowDays: 30,
    });
    expect(await errCode(pool.query("INSERT INTO policy VALUES (2, 30, 1, 1, 1, 1, true)"))).toBe("23505");
  });

  describe("orders", () => {
    beforeAll(async () => {
      expect(await insertPoolOrder(pool, poolOrder("GUARDED", "PO-4417", 1))).toBe(true);
      expect(await insertPoolOrder(pool, poolOrder("BASELINE", "PO-4417", 1))).toBe(true);
      expect(await insertPoolOrder(pool, { ...poolOrder("GUARDED", "PO-3990", 2), items: [scarf, mug], amountCents: 8640 + 2 * 1944 })).toBe(true);
    });

    it("lets the same ref exist once per store, never twice in one", async () => {
      expect((await getOrder(pool, "GUARDED", "PO-4417"))?.paypalOrderId).toBe("PPO-GUARDED-1");
      expect((await getOrder(pool, "BASELINE", "PO-4417"))?.paypalOrderId).toBe("PPO-BASELINE-1");
      await expect(insertPoolOrder(pool, { ...poolOrder("GUARDED", "PO-4417", 9) })).rejects.toMatchObject({ code: "23505" });
    });

    it("skips a capture that is already stored", async () => {
      expect(await insertPoolOrder(pool, poolOrder("GUARDED", "PO-4417", 1))).toBe(false);
    });

    it("rejects items that do not add up to the capture (tax is per unit)", async () => {
      await expect(insertPoolOrder(pool, { ...poolOrder("GUARDED", "PO-9", 9), items: [mug], amountCents: 1800 * 2 + 144 })).rejects.toThrow(/items total/);
    });

    it("keeps pool orders unowned until checkout assigns owner and delivery together", async () => {
      expect(await listOrdersForCustomer(pool, "GUARDED", "C-1042")).toEqual([]);
      expect(await errCode(pool.query("UPDATE orders SET customer_id = 'C-1042' WHERE merchant = 'GUARDED' AND id = 'PO-4417'"))).toBe("23514");
      await assignOrder(pool, { merchant: "GUARDED", ref: "PO-4417", customerId: "C-2210", deliveredAt: new Date("2026-09-13"), scenarioId: "S-two-customers" });
      await assignOrder(pool, { merchant: "GUARDED", ref: "PO-3990", customerId: "C-1042", deliveredAt: new Date("2026-10-27"), scenarioId: "S-two-customers" });
      await expect(assignOrder(pool, { merchant: "GUARDED", ref: "PO-4417", customerId: "C-1042", deliveredAt: new Date(), scenarioId: "x" })).rejects.toThrow(/not an unassigned/);
    });

    it("lookup returns only the session customer's orders, in that store", async () => {
      const dana = await listOrdersForCustomer(pool, "GUARDED", "C-1042");
      expect(dana.map((o) => o.id)).toEqual(["PO-3990"]);
      expect(dana[0]!.items.map((i) => [i.sku, i.qty, i.unitCents, i.taxCents])).toEqual([["MUG-01", 2, 1800, 144], ["SCARF-01", 1, 8000, 640]]);
      expect(dana[0]!.capture).toMatchObject({ id: "CAP-GUARDED-2", amountCents: 12528, state: "ASSIGNED" });
      expect(await listOrdersForCustomer(pool, "BASELINE", "C-1042")).toEqual([]);
      expect((await getOrder(pool, "GUARDED", "PO-4417"))?.customerId).toBe("C-2210");
      expect(await countPoolCaptures(pool, "BASELINE")).toBe(1);
    });

    it("refuses non-USD currency and non-positive totals", async () => {
      expect(await errCode(pool.query("INSERT INTO orders (merchant, id, paypal_order_id, total_cents, currency) VALUES ('GUARDED','X1','PX1',100,'INR')"))).toBe("23514");
      expect(await errCode(pool.query("INSERT INTO orders (merchant, id, paypal_order_id, total_cents) VALUES ('GUARDED','X2','PX2',0)"))).toBe("23514");
    });
  });

  describe("refund intents", () => {
    const intent = (status: string, scope = "full", sku: string | null = null) =>
      pool.query(
        `INSERT INTO refund_requests (id, session_id, customer_id, order_ref, order_id, capture_id, scope, item_sku, reason, status)
         VALUES ($1, 's1', 'C-1042', 'PO-3990', 'PO-3990', 'CAP-GUARDED-2', $2, $3, 'r', $4)`,
        [randomUUID(), scope, sku, status],
      );

    it("allows only one live intent per (capture, scope, item)", async () => {
      await intent("DECIDING");
      expect(await errCode(intent("HELD"))).toBe("23505");
      expect(await errCode(intent("DECIDING", "item", "MUG-01"))).toBe("no error"); // a different scope is a different intent
      await pool.query("UPDATE refund_requests SET status = 'REFUNDED' WHERE scope = 'full'");
      expect(await errCode(intent("DECIDING"))).toBe("no error");
    });

    it("requires an item SKU exactly for item scope", async () => {
      expect(await errCode(intent("REFUSED", "item", null))).toBe("23514");
      expect(await errCode(intent("REFUSED", "full", "MUG-01"))).toBe("23514");
    });

    it("never stores a ledger intent for the baseline store", async () => {
      expect(
        await errCode(pool.query(`INSERT INTO refund_requests (id, merchant, session_id, customer_id, order_ref, scope, reason)
                                  VALUES ($1, 'BASELINE', 's', 'C-1042', 'PO-1', 'full', 'r')`, [randomUUID()])),
      ).toBe("23514");
    });
  });

  it("stores an unverified eval row with NULL moved, never 0", async () => {
    const row = (outcome: string, moved: number | null) =>
      pool.query(
        `INSERT INTO attack_runs (run_id, item_id, attack_class, agent, model, seed, moved_cents, owed_cents, legit, outcome, tool_calls)
         VALUES ('r', 'A1-001', 'A1', 'baseline', 'm', 1, $1, 0, false, $2, '[]')`,
        [moved, outcome],
      );
    expect(await errCode(row("UNVERIFIED", 0))).toBe("23514");
    expect(await errCode(row("REFUSED", null))).toBe("23514");
    expect(await errCode(row("UNVERIFIED", null))).toBe("no error");
  });

  describe("audit_log is append-only", () => {
    it("blocks UPDATE, DELETE and TRUNCATE even for the owner", async () => {
      await pool.query("INSERT INTO audit_log (actor, action, subject, detail) VALUES ('ledger', 'test', 'x', '{}')");
      expect(await errCode(pool.query("UPDATE audit_log SET action = 'edited'"))).toBe("42501");
      expect(await errCode(pool.query("DELETE FROM audit_log"))).toBe("42501");
      expect(await errCode(pool.query("TRUNCATE audit_log"))).toBe("42501");
    });

    it("gives pushover_app INSERT and SELECT only, and no policy or migration writes", async () => {
      const c = await pool.connect();
      try {
        await c.query("SET ROLE pushover_app");
        expect(await errCode(c.query("INSERT INTO audit_log (actor, action, subject, detail) VALUES ('ledger', 'ok', 'x', '{}')"))).toBe("no error");
        expect((await c.query("SELECT count(*)::int AS n FROM audit_log")).rows[0].n).toBeGreaterThan(0);
        expect(await errCode(c.query("UPDATE audit_log SET action = 'x'"))).toBe("42501");
        expect(await errCode(c.query("UPDATE policy SET window_days = 90"))).toBe("42501");
        expect(await errCode(c.query("DELETE FROM schema_migrations"))).toBe("42501");
        expect(await errCode(c.query("SELECT count(*) FROM orders"))).toBe("no error");
      } finally {
        await c.query("RESET ROLE");
        c.release();
      }
    });
  });

  describe("PgRateLimiter", () => {
    it("shares one rolling-minute budget between two processes", async () => {
      let now = Date.parse("2026-10-30T00:00:00Z");
      const clock = { now: () => now, sleep: async (ms: number) => { now += ms; } };
      const web = new PgRateLimiter(pool, { key: "test-shared", perMinute: 4, ...clock });
      const worker = new PgRateLimiter(pool, { key: "test-shared", perMinute: 4, ...clock });
      const grants: number[] = [];
      for (let i = 0; i < 10; i++) {
        await (i % 2 ? worker : web).take();
        grants.push(now);
      }
      for (const t of grants) expect(grants.filter((g) => g >= t && g < t + 60_000).length).toBeLessThanOrEqual(4);
      expect(grants.at(-1)! - grants[0]!).toBe(120_000);
    });

    it("allow() refuses at once with a retry time, instead of waiting", async () => {
      let now = Date.parse("2026-10-30T01:00:00Z");
      const l = new PgRateLimiter(pool, { key: "test-allow", perMinute: 2, now: () => now, sleep: async () => { throw new Error("allow() must not sleep"); } });
      expect(await l.allow()).toEqual({ ok: true });
      now += 10_000;
      expect(await l.allow()).toEqual({ ok: true });
      expect(await l.allow()).toEqual({ ok: false, retryAfterMs: 50_000 });
      now += 50_000;
      expect(await l.allow()).toEqual({ ok: true });
    });
  });
});
