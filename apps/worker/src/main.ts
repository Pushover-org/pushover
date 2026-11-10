// The worker (spec R11): keeps the money screens true without anyone pressing a button. Each
// pass turns verified webhooks into read-backs, reads back every batch PayPal hasn't settled,
// checks payouts against PayPal's own history, and moves returned money past its re-offer window
// to cy-près eligibility. It never sends money: that takes two people in the web app.
//   node --env-file-if-exists=.env.local apps/worker/src/main.ts [--once]
import { parseSettlement } from "@proofofclaim/claims";
import { loadTaxTable, PROVISIONAL_CONFIG } from "@proofofclaim/checks";
import { createPool, getSettlementConfig, PgRateLimiter } from "@proofofclaim/db";
import { decideAfterClose, identityKeysFromEnv, processWebhooks, recordBeacons, REOFFER_DAYS, workerTick, type Desk } from "@proofofclaim/desk";
import { paypalClientFromEnv } from "@proofofclaim/paypal";

const ONCE = process.argv.includes("--once");
const INTERVAL_MS = Number(process.env["WORKER_INTERVAL_SECONDS"] ?? "60") * 1000;
/** Any fixed number: only one worker may run passes at a time. */
const LOCK_KEY = 4_417_002;

const log = (msg: string, detail: Record<string, unknown> = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), worker: msg, ...detail }));

const pool = createPool();
// Shares the sandbox request budget with the web app through Postgres.
const pp = paypalClientFromEnv("guarded", new PgRateLimiter(pool, { key: "paypal-guarded", perMinute: Number(process.env["PAYPAL_RPM"] ?? "40") }));
const table = loadTaxTable();
const keys = (() => {
  try {
    return identityKeysFromEnv();
  } catch {
    return null; // reading back never needs them; paying does, and that happens in the web app
  }
})();

async function deskFor(settlementId: string): Promise<Desk | null> {
  const raw = await getSettlementConfig(pool, settlementId);
  if (!raw) return null;
  return {
    pool, settlement: parseSettlement(raw), table, config: PROVISIONAL_CONFIG, networkSecret: process.env["NETWORK_SECRET"] ?? "demo-network-secret",
    read: null, keys, reofferDays: Number(process.env["REOFFER_DAYS"] ?? REOFFER_DAYS),
  };
}

async function pass(): Promise<void> {
  const hooks = await processWebhooks(pool, pp, deskFor);
  if (hooks.readBacks + hooks.ignored > 0) log("webhooks", hooks);
  // Each ledger's drand round, once out: verified against quicknet's key, then its audit sample.
  const beacons = await recordBeacons(pool).catch((err: unknown) => (log("beacons failed", { error: err instanceof Error ? err.message : String(err) }), 0));
  if (beacons) log("beacons", { recorded: beacons });
  const { rows } = await pool.query<{ id: string }>("SELECT id FROM settlements ORDER BY id");
  for (const { id } of rows) {
    const desk = await deskFor(id);
    if (!desk) continue;
    try {
      // A decide-after-close settlement whose filing just closed: decide every waiting claim.
      const decided = await decideAfterClose(desk);
      if (decided) log("decided after close", { settlement: id, decided });
      const r = await workerTick(desk, pp);
      if (r.readBacks || r.expired || r.lapsed || Object.keys(r.history).length) log("tick", { settlement: id, ...r });
    } catch (err) {
      log("tick failed", { settlement: id, error: err instanceof Error ? err.message : String(err) });
    }
  }
}

const lock = await pool.connect();
const { rows: got } = await lock.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [LOCK_KEY]);
if (!got[0]?.ok) {
  log("another worker holds the lock; exiting");
  lock.release();
  await pool.end();
  process.exit(0);
}
log("started", { once: ONCE, intervalSeconds: INTERVAL_MS / 1000 });
let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => (stopping = true));
do {
  try {
    await pass();
  } catch (err) {
    log("pass failed", { error: err instanceof Error ? err.message : String(err) });
  }
  if (ONCE || stopping) break;
  await new Promise((r) => setTimeout(r, INTERVAL_MS));
} while (!stopping);
lock.release();
await pool.end();
log("stopped");
