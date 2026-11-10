import { commitmentsOf } from "@proofofclaim/db";
import type { Commitment } from "@proofofclaim/ledger";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LedgerVerifier } from "@/components/app/LedgerVerifier.tsx";
import { pool, settlement } from "@/lib/server/data.ts";
import { RULE_FILES } from "@/lib/server/rules.ts";
import s from "./ledger.module.css";

export const metadata: Metadata = { title: "Public ledger" };
export const dynamic = "force-dynamic";

const REPO = "https://github.com/Pushover-org/pushover/blob/main";
const short = (h: string) => `${h.slice(0, 12)}…${h.slice(-6)}`;

/**
 * The public ledger (plan items P42–P44). Before each payout, every decision and the rules in
 * force were fixed in a Merkle root, tied to a drand round that didn't exist yet. Anyone can check
 * it here, in their own browser, without trusting us.
 */
export default async function Ledger({ params }: { params: Promise<{ settlement: string }> }) {
  const { settlement: id } = await params;
  const S = await settlement(id);
  if (!S) notFound();
  const commitments = await commitmentsOf(pool(), S.id);
  const { rows: before } = await pool().query<{ id: string }>(
    "SELECT paypal_batch_id AS id FROM payout_batches WHERE settlement_id = $1 AND ledger_commitment_id IS NULL AND paypal_batch_id IS NOT NULL ORDER BY id",
    [S.id],
  );

  return (
    <article className={s.doc}>
      <header className={s.head}>
        <p className="label">
          <a href={`/report/${S.id}`}>Court report</a> · public ledger
        </p>
        <h1 className="display">
          The decisions were fixed <em>before</em> the money moved.
        </h1>
        <div className={s.how}>
          <p>
            Each time two people approve a payout, every decided claim becomes a leaf: its decision, rule and reason, the amount, and the SHA-256 of its evidence and of
            what the AI read from it. The Merkle root of those leaves is committed with a fingerprint of the rules in force and a drand round that doesn&apos;t exist yet.
            Every payout&apos;s note at PayPal carries the commitment&apos;s hash.
          </p>
          <p>
            So nobody could change a decision or a rule after the claims arrived without the root changing, and when drand publishes that round its randomness picks
            claims for a person to re-examine. Nobody, us included, could pick them in advance. Leaves hold claim IDs and hashes only, no personal data.
          </p>
        </div>
      </header>

      {before.length > 0 ? (
        <p className={s.empty}>
          Sent before the ledger existed, so not in one: PayPal batch{before.length === 1 ? "" : "es"} <span className="num">{before.map((b) => b.id).join(", ")}</span>.
        </p>
      ) : null}
      {commitments.length === 0 ? (
        <p className={s.empty}>No ledger has been committed yet: one is, each time two people approve a payout.</p>
      ) : (
        commitments.map((c) => {
          const k = c.commitment as Commitment;
          return (
            <section key={c.id} className={s.card} aria-labelledby={`c${c.id}`}>
              <h2 id={`c${c.id}`} className="label">
                {c.kind === "CLAIMS" ? "Payout" : "Cy-près"} round {c.round} · committed {c.committedAt.toISOString().replace("T", " ").slice(0, 19)} UTC
              </h2>
              <dl className={s.facts}>
                <div>
                  <dt>Merkle root of {k.leafCount} decisions</dt>
                  <dd className="num">{short(c.root)}</dd>
                </div>
                <div>
                  <dt>Commitment hash (in each PayPal note)</dt>
                  <dd className="num">{short(c.digest)}</dd>
                </div>
                <div>
                  <dt>drand quicknet round</dt>
                  <dd className="num">
                    <a href={`https://api.drand.sh/${k.drand.chain}/public/${c.drandRound}`} rel="noreferrer" target="_blank">
                      {c.drandRound}
                    </a>
                  </dd>
                </div>
                <div>
                  <dt>Audit sample</dt>
                  <dd className="num">{c.sample ? c.sample.join(", ") : "waits for the drand round"}</dd>
                </div>
              </dl>
              <details className={s.rules}>
                <summary>The rules in force, by hash (compare with the repository)</summary>
                <ul>
                  <li>
                    Decision table <a href={`${REPO}/${RULE_FILES.decisionTable}`}>{RULE_FILES.decisionTable}</a>: <span className="num">{k.rules.decisionTable}</span>
                  </li>
                  <li>
                    Tax table <a href={`${REPO}/${RULE_FILES.taxTable}`}>{RULE_FILES.taxTable}</a>: <span className="num">{k.rules.taxTable}</span>
                  </li>
                  <li>
                    This settlement&apos;s configuration: <span className="num">{k.rules.settlement}</span>
                  </li>
                </ul>
              </details>
              <LedgerVerifier url={`/api/ledger/${S.id}/${c.id}`} />
              <p className={s.raw}>
                Raw data: <a href={`/api/ledger/${S.id}/${c.id}`}>ledger JSON</a> (the commitment, every leaf, and PayPal&apos;s notes as read back).
              </p>
            </section>
          );
        })
      )}
    </article>
  );
}
