import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { dollars } from "@/lib/labels.ts";
import { requireAnalyst } from "@/lib/server/auth.ts";
import { settlement } from "@/lib/server/data.ts";
import { scoreboard } from "@/lib/server/scoreboard.ts";
import s from "./scoreboard.module.css";

export const metadata: Metadata = { title: "Scoreboard" };
export const dynamic = "force-dynamic";

/** Plan items P21, C6: each approach against the labels, live. */
export default async function Scoreboard({
  params,
}: {
  params: Promise<{ settlement: string }>;
}) {
  const { settlement: id } = await params;
  await requireAnalyst(`/admin/${id}/scoreboard`);
  const S = await settlement(id);
  if (!S) notFound();
  const sb = await scoreboard(S);
  return (
    <div className={s.page}>
      <header>
        <p className="label">
          <a href={`/admin/${S.id}`}>Claims desk</a> · scoreboard
        </p>
        <h1 className="display">
          Against the labels, <em>as you decide.</em>
        </h1>
      </header>
      {!sb ? (
        <p className={s.note}>
          This settlement&apos;s claims carry no ground-truth labels, so
          there&apos;s nothing to score against. The demo settlement has them.
        </p>
      ) : (
        <>
          <p className={s.lede}>
            {sb.labelled} labelled claims: {sb.fraud} fraud and {sb.honest}{" "}
            honest (the rest don&apos;t qualify). Each row is what that approach
            would do with the same claims. It reads the current decisions, so
            the last row moves as you decide claims and groups.
          </p>
          <div className={s.scroll}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Approach</th>
                  <th>Paid to fraud</th>
                  <th>Honest denied</th>
                  <th>Honest waiting for a person</th>
                </tr>
              </thead>
              <tbody>
                {sb.rows.map((r) => (
                  <tr key={r.key} data-k={r.key}>
                    <td>
                      <b>{r.label}</b>
                      <small>{r.note}</small>
                    </td>
                    <td className="num">{dollars(r.fraudPaidCents)}</td>
                    <td className="num">
                      {r.honestDenied} of {sb.honest}
                    </td>
                    <td className="num">
                      {r.honestWaiting} of {sb.honest}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <section className={s.lone}>
            <p className="label">Lone fakes</p>
            <h2 className="display">
              {sb.lone.fraud} fraudulent claims have no group around them.
            </h2>
            <p>
              They share no device, inbox, wording or building with anyone, so
              checking the person alone pays every one (
              {dollars(sb.lone.askedCents)} asked). The proof checks stopped{" "}
              <b className="num">{sb.lone.stoppedByChecks}</b> of them;{" "}
              {dollars(sb.lone.paidCents)} of them is approved now.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
