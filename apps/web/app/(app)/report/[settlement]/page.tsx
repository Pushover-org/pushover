import { DECISION_VERSION } from "@proofofclaim/claims";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReportGrid } from "@/components/app/ReportGrid.tsx";
import { dollars, OUTCOME_LABEL } from "@/lib/labels.ts";
import { settlement } from "@/lib/server/data.ts";
import { money } from "@/lib/server/money.ts";
import { reportRows } from "@/lib/server/report.ts";
import s from "./report.module.css";

export const metadata: Metadata = { title: "Court report" };
export const dynamic = "force-dynamic";

export default async function Report({ params }: { params: Promise<{ settlement: string }> }) {
  const { settlement: id } = await params;
  const S = await settlement(id);
  if (!S) notFound();
  const [rows, m] = await Promise.all([reportRows(S.id), money(S.id, S.fundCents)]);
  const count = (o: string) => rows.filter((r) => r.decision === o).length;
  const byPerson = rows.filter((r) => r.decidedBy === "analyst").length;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <article className={s.doc}>
      <header className={s.caption}>
        <p className="label">Claims administrator&apos;s report · as of {today}</p>
        <h1 className="display">
          In re <em>{S.name.replace(" (fictional demo)", "")}</em>
        </h1>
        <p className={s.fict}>A fictional settlement for demonstration. No real company, court or class is involved.</p>
        <a className="pill pill--quiet" href={`/api/report/${S.id}`} download>
          Download CSV
        </a>
      </header>

      <section className={s.grid2}>
        <div className={s.block}>
          <h2 className="label">1 · Claims received and decided</h2>
          <dl className={s.counts}>
            <div>
              <dt>Received</dt>
              <dd className="num">{rows.length}</dd>
            </div>
            {(["APPROVE", "DENY", "REVIEW", "NEED_MORE"] as const).map((o) => (
              <div key={o} data-o={o}>
                <dt>{OUTCOME_LABEL[o]}</dt>
                <dd className="num">{count(o)}</dd>
              </div>
            ))}
          </dl>
          <p>
            Every decision was made by decision table <span className="num">{DECISION_VERSION}</span> from deterministic checks, or by a person reviewing a claim the table held (
            {byPerson} so far). An AI read the evidence and reported findings; it decided nothing and moved no money. Each reason below is the table&apos;s own wording.
          </p>
        </div>
        <div className={s.block}>
          <h2 className="label">2 · The fund</h2>
          <table className={s.fund}>
            <tbody>
              <tr>
                <td>Settlement fund</td>
                <td className="num">{dollars(m.fundCents)}</td>
              </tr>
              <tr>
                <td>Paid to claimants (confirmed by PayPal)</td>
                <td className="num">{dollars(m.paidCents)}</td>
              </tr>
              <tr>
                <td>Unclaimed, returning after 30 days</td>
                <td className="num">{dollars(m.unclaimedCents)}</td>
              </tr>
              <tr>
                <td>In flight or unconfirmed</td>
                <td className="num">{dollars(m.inFlightCents + m.unverifiedCents)}</td>
              </tr>
              <tr>
                <td>Came back from PayPal: claimants can ask again, then it goes to cy-près</td>
                <td className="num">{dollars(m.returnedCents)}</td>
              </tr>
              <tr>
                <td>Sent to {S.cyPres.name}</td>
                <td className="num">{dollars(m.cyPresCents)}</td>
              </tr>
              <tr>
                <td>PayPal fees</td>
                <td className="num">{dollars(m.feesCents)}</td>
              </tr>
              <tr className={s.total}>
                <td>Held in the fund</td>
                <td className="num">{dollars(m.heldCents)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className={s.block}>
        <h2 className="label">3 · Every claim</h2>
        <p>Claimants are shown by initials and state only. Amounts are entitlements before the pro-rata share; the payout column shows what PayPal reported.</p>
        <ReportGrid rows={rows} />
      </section>
    </article>
  );
}
