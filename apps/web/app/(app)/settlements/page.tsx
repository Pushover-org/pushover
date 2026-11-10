import { parseSettlement, type Settlement } from "@proofofclaim/claims";
import type { Metadata } from "next";
import { dollars } from "@/lib/labels.ts";
import { pool } from "@/lib/server/data.ts";
import s from "./settlements.module.css";

export const metadata: Metadata = { title: "Settlements" };
export const dynamic = "force-dynamic";

/** Every settlement on this desk (plan item P17): file in an open one, check a paid one's ledger. */
export default async function Settlements() {
  const { rows } = await pool().query<{ config: unknown; claims: number; decided: number; paid_cents: string | null; ledgers: number }>(
    `SELECT s.config,
            (SELECT count(*)::int FROM claims c WHERE c.settlement_id = s.id AND c.status NOT IN ('UNBOUND', 'LAPSED')) AS claims,
            (SELECT count(*)::int FROM claims c WHERE c.settlement_id = s.id AND c.status NOT IN ('UNBOUND', 'LAPSED', 'SUBMITTED', 'EXAMINED')) AS decided,
            (SELECT sum(i.amount_cents) FROM payout_items i JOIN payout_batches b ON b.id = i.batch_id WHERE b.settlement_id = s.id AND b.kind = 'CLAIMS' AND i.outcome = 'PAID') AS paid_cents,
            (SELECT count(*)::int FROM ledger_commitments l WHERE l.settlement_id = s.id) AS ledgers
     FROM settlements s ORDER BY s.created_at DESC NULLS LAST, s.id`,
  );
  const list = rows.flatMap((r) => {
    try {
      return [{ S: parseSettlement(r.config) as Settlement, claims: r.claims, decided: r.decided, paidCents: Number(r.paid_cents ?? 0), ledgers: r.ledgers }];
    } catch {
      return []; // a stored configuration this version can't read is not listed
    }
  });
  const now = Date.now();

  return (
    <div className={s.page}>
      <header>
        <p className="label">Settlements</p>
        <h1 className="display">
          {list.length} {list.length === 1 ? "settlement" : "settlements"} on this desk
        </h1>
        <p className={s.lede}>All are fictional and paid in PayPal&apos;s sandbox with play money. File a claim in an open one; read any one&apos;s court report and public ledger.</p>
      </header>
      <ul className={s.list}>
        {list.map(({ S, claims, decided, paidCents, ledgers }) => {
          const closes = S.filing ? new Date(S.filing.closesAt) : null;
          const open = !closes || closes.getTime() > now;
          return (
            <li key={S.id} className={s.card}>
              <div className={s.main}>
                <span className={s.state} data-open={open}>
                  {open ? (closes ? `Open until ${S.filing?.closesAt.slice(0, 10)}` : "Open") : `Closed ${S.filing?.closesAt.slice(0, 10)}`}
                </span>
                <h2>{S.name}</h2>
                <p>
                  Fund <b className="num">{dollars(S.fundCents, 0)}</b> · class period {S.classPeriod.start} to {S.classPeriod.end} · {S.geography.states.length} states · leftover money to{" "}
                  {S.cyPres.name}
                </p>
                <p className={s.counts}>
                  <span className="num">{claims}</span> claims, <span className="num">{decided}</span> decided, <span className="num">{dollars(paidCents)}</span> paid ·{" "}
                  <span className="num">{ledgers}</span> {ledgers === 1 ? "ledger" : "ledgers"} committed
                </p>
              </div>
              <div className={s.links}>
                {open ? (
                  <a className="pill pill--green" href={`/claim/${S.id}`}>
                    File a claim
                  </a>
                ) : null}
                <a className="pill pill--quiet" href={`/report/${S.id}`}>
                  Court report
                </a>
                <a className="pill pill--quiet" href={`/report/${S.id}/ledger`}>
                  Ledger
                </a>
              </div>
            </li>
          );
        })}
      </ul>
      <p className={s.foot}>
        Analysts open a new settlement from <a href="/admin/new">the desk</a> (supervisors only).
      </p>
    </div>
  );
}
