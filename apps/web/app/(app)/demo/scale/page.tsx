import { allocate, buildClaimBatches, MAX_ITEMS_PER_BATCH } from "@proofofclaim/distribute";
import type { Metadata } from "next";
import { dollars } from "@/lib/labels.ts";
import { DEMO_SETTLEMENT, FEE_PER_ITEM_CENTS, pool } from "@/lib/server/data.ts";
import s from "./scale.module.css";

export const metadata: Metadata = { title: "At scale (simulated)" };
export const dynamic = "force-dynamic";

/** A fixed, made-up settlement at scale (plan item P41). Nothing here is sent anywhere. */
const SIM = { claimants: 120_000, fundCents: 250_000_000, adminReserveCents: 12_500_000, seed: 20261112 };

/** Deterministic, so the page shows the same numbers on every load. */
function rng(seed: number) {
  let x = seed >>> 0;
  return () => ((x = (Math.imul(x ^ (x >>> 15), 2246822507) + 0x6d2b79f5) >>> 0) / 2 ** 32);
}

function simulate() {
  const r = rng(SIM.seed);
  // The demo's tiers: with a receipt $15 a drink, up to 5; without, $10 flat (about 40% of claims).
  const entitlements = Array.from({ length: SIM.claimants }, (_, i) => ({
    claimId: `sim-${String(i + 1).padStart(6, "0")}`,
    entitlementCents: r() < 0.4 ? 1000 : 1500 * (1 + Math.floor(r() * 5)),
  }));
  const started = performance.now();
  const allocation = allocate({ fundCents: SIM.fundCents, adminReserveCents: SIM.adminReserveCents, feePerItemCents: FEE_PER_ITEM_CENTS, entitlements });
  const payees = allocation.payouts.map((p) => ({ claimId: p.claimId, email: `${p.claimId}@simulated.invalid` }));
  const batches = buildClaimBatches({
    instance: "0000000000", settlementId: "simulated", round: 1, allocation, payees, emailSubject: "simulated", emailMessage: "simulated",
  });
  const ms = performance.now() - started;
  const paid = allocation.payouts.reduce((t, p) => t + p.payoutCents, 0);
  const asked = entitlements.reduce((t, e) => t + e.entitlementCents, 0);
  const sizes = allocation.payouts.map((p) => p.payoutCents).filter((c) => c > 0);
  return {
    allocation, batches, ms, paid, asked,
    smallest: sizes.reduce((m, c) => Math.min(m, c), Infinity), largest: sizes.reduce((m, c) => Math.max(m, c), 0),
    balances: paid + allocation.leftoverCents + allocation.reservedFeesCents + SIM.adminReserveCents === SIM.fundCents,
  };
}

interface RealRound {
  paypal_batch_id: string | null;
  round: number;
  kind: string;
  items: number;
  cents: string;
  created_at: Date;
}

export default async function Scale() {
  const sim = simulate();
  const { rows: real } = await pool()
    .query<RealRound>(
      `SELECT b.paypal_batch_id, b.round, b.kind, count(i.id)::int AS items, coalesce(sum(i.amount_cents), 0) AS cents, b.created_at
       FROM payout_batches b LEFT JOIN payout_items i ON i.batch_id = b.id WHERE b.settlement_id = $1 GROUP BY b.id ORDER BY b.id`,
      [DEMO_SETTLEMENT],
    )
    .catch(() => ({ rows: [] as RealRound[] }));

  return (
    <div className={s.page}>
      <header>
        <p className="label">The money path at scale</p>
        <h1 className="display">What one round looks like with {SIM.claimants.toLocaleString("en-US")} claimants.</h1>
        <p className={s.lede}>
          The demo settlement is small. Below, the same allocation and batching code that pays a real round runs on simulated claims, when this page loads. It is
          clearly marked, and nothing in it is sent to PayPal. The real sandbox rounds are listed separately underneath.
        </p>
      </header>

      <section className={s.card} aria-labelledby="sim">
        <p className={s.tag} data-kind="sim">
          Simulated · never sent to PayPal
        </p>
        <h2 id="sim">A made-up settlement: {dollars(SIM.fundCents, 0)} fund</h2>
        <dl className={s.grid}>
          <div>
            <dt>Claimants approved</dt>
            <dd className="num">{SIM.claimants.toLocaleString("en-US")}</dd>
          </div>
          <div>
            <dt>Asked for in all</dt>
            <dd className="num">{dollars(sim.asked, 0)}</dd>
          </div>
          <div>
            <dt>Shares {sim.allocation.scaled ? "scaled down pro rata" : "paid in full"}</dt>
            <dd className="num">{dollars(sim.paid)}</dd>
          </div>
          <div>
            <dt>Reserved for PayPal&apos;s fees</dt>
            <dd className="num">{dollars(sim.allocation.reservedFeesCents)}</dd>
          </div>
          <div>
            <dt>Administration reserve</dt>
            <dd className="num">{dollars(SIM.adminReserveCents)}</dd>
          </div>
          <div>
            <dt>Left over (cy-près candidate)</dt>
            <dd className="num">{dollars(sim.allocation.leftoverCents)}</dd>
          </div>
          <div>
            <dt>Smallest and largest payment</dt>
            <dd className="num">
              {dollars(sim.smallest)} · {dollars(sim.largest)}
            </dd>
          </div>
          <div>
            <dt>PayPal Payouts batches (at most {MAX_ITEMS_PER_BATCH.toLocaleString("en-US")} items each)</dt>
            <dd className="num">{sim.batches.length}</dd>
          </div>
        </dl>
        <p className={s.note}>
          Every cent is accounted for: payments + left over + fees + reserve {sim.balances ? "equal" : "do NOT equal"} the fund exactly, in whole cents. Computed on
          this server in {Math.round(sim.ms)} ms. Batch IDs would run {sim.batches[0]?.senderBatchId} to {sim.batches.at(-1)?.senderBatchId}.
        </p>
      </section>

      <section className={s.card} aria-labelledby="real">
        <p className={s.tag} data-kind="real">
          Real sandbox · play money
        </p>
        <h2 id="real">Rounds this deployment actually sent</h2>
        {real.length ? (
          <ul className={s.rounds}>
            {real.map((b) => (
              <li key={`${b.kind}-${b.round}-${b.paypal_batch_id ?? ""}`}>
                <code>{b.paypal_batch_id ?? "not accepted"}</code> · {b.kind === "CY_PRES" ? "cy-près" : `round ${b.round}`} · {b.items} {b.items === 1 ? "payment" : "payments"},{" "}
                {dollars(Number(b.cents))} · {b.created_at.toISOString().slice(0, 16).replace("T", " ")} UTC
              </li>
            ))}
          </ul>
        ) : (
          <p className={s.note}>None yet.</p>
        )}
        <p className={s.note}>
          Each is read back from PayPal item by item on the <a href={`/admin/${DEMO_SETTLEMENT}/money`}>money page</a> (analyst login) and totalled in the{" "}
          <a href={`/report/${DEMO_SETTLEMENT}`}>court report</a>. The public demo may send at most $50 of play money a day.
        </p>
      </section>
    </div>
  );
}
