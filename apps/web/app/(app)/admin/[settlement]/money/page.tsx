import { planDistribution } from "@proofofclaim/desk";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DistributeButton, ReadBackButton } from "@/components/app/MoneyActions.tsx";
import { PayoutGrid } from "@/components/app/PayoutGrid.tsx";
import { dollars } from "@/lib/labels.ts";
import { desk } from "@/lib/server/data.ts";
import { DEMO_DAILY_CAP_CENTS, money } from "@/lib/server/money.ts";
import s from "./money.module.css";

export const metadata: Metadata = { title: "Money" };
export const dynamic = "force-dynamic";

export default async function MoneyPage({ params }: { params: Promise<{ settlement: string }> }) {
  const { settlement: id } = await params;
  const d = await desk(id);
  if (!d) notFound();
  const S = d.settlement;
  const m = await money(S.id, S.fundCents);
  const room = Math.max(0, DEMO_DAILY_CAP_CENTS - m.sentLast24hCents);
  const plan = room >= 100 ? await planDistribution(d, { capCents: room }) : null;
  const payable = plan?.allocation.payouts.filter((p) => p.payoutCents > 0) ?? [];
  const total = payable.reduce((t, p) => t + p.payoutCents, 0);
  const byId = plan?.payees.filter((p) => p.payerId && payable.some((x) => x.claimId === p.claimId)).length ?? 0;
  const batches = [...new Map(m.rows.map((r) => [r.batchId, r])).values()];

  const parts = [
    { k: "paid", label: "Paid", cents: m.paidCents },
    { k: "unclaimed", label: "Unclaimed (returns after 30 days)", cents: m.unclaimedCents },
    { k: "flight", label: "In flight", cents: m.inFlightCents },
    { k: "unverified", label: "Unconfirmed", cents: m.unverifiedCents },
    { k: "returned", label: "Returned or failed", cents: m.returnedCents },
    { k: "cypres", label: "Sent to charity", cents: m.cyPresCents },
    { k: "fees", label: "PayPal fees", cents: m.feesCents },
    { k: "held", label: "Held in the fund", cents: m.heldCents },
  ];

  return (
    <div className={s.page}>
      <header>
        <p className="label">Money · {S.name}</p>
        <h1 className={`display ${s.h1}`}>
          Every dollar of the fund, <em>accounted for.</em>
        </h1>
      </header>

      <section className={s.ledger} aria-label="Where the fund is">
        <div className={s.equation}>
          <span className={s.fund}>
            <small>Fund</small>
            <b className="num">{dollars(S.fundCents)}</b>
          </span>
          <span className={s.eq}>=</span>
          {parts.map((p, i) => (
            <span key={p.k} className={s.term} data-k={p.k}>
              {i > 0 ? <i>+</i> : null}
              <small>{p.label}</small>
              <b className="num">{dollars(p.cents)}</b>
            </span>
          ))}
        </div>
        <div className={s.bar} role="img" aria-label="The fund split into the parts above">
          {parts.map((p) => (p.cents > 0 ? <span key={p.k} data-k={p.k} style={{ flexGrow: p.cents }} title={`${p.label}: ${dollars(p.cents)}`} /> : null))}
        </div>
        <p className={s.note}>
          Payouts PayPal hasn&apos;t confirmed are shown as unconfirmed, never as paid.
          {m.feesUnknown > 0 ? ` ${m.feesUnknown} item fees are not reported yet; they are never assumed.` : ""}
        </p>
      </section>

      <section className={s.distribute}>
        <div>
          <p className="label">Distribute</p>
          <h2 className="display">{payable.length > 0 ? <>Pay {payable.length} approved claimants <em>{dollars(total)}</em>.</> : <>Nothing is waiting to be paid.</>}</h2>
          <p>
            Before any money moves, every approved claim is checked again against the whole settlement, so a bot cluster that formed after a claim was approved pulls it back
            to a person. Then one PayPal Payouts batch pays everyone, pro rata, in whole cents.
          </p>
          <ul className={s.facts}>
            <li>
              <b className="num">{byId}</b> paid straight to the PayPal account they logged in with
            </li>
            <li>
              <b className="num">{payable.length - byId}</b> paid by email (claims from the labelled set; their fictional addresses come back unclaimed)
            </li>
            <li>
              <b className="num">{dollars(plan?.allocation.reservedFeesCents ?? 0)}</b> reserved for PayPal&apos;s fees, $0.25 a payment
            </li>
            <li>
              Sandbox limit for this public demo: <b className="num">{dollars(DEMO_DAILY_CAP_CENTS, 0)}</b> of play money a day; <b className="num">{dollars(room)}</b> left today, so
              this round pays from that much
            </li>
          </ul>
        </div>
        <DistributeButton settlementId={S.id} label={`Hold to send ${dollars(total)}`} disabled={payable.length === 0} />
      </section>

      <section className={s.batches} aria-labelledby="batches">
        <div className={s.batchHead}>
          <h2 id="batches" className="label">
            Payout items, read back from PayPal
          </h2>
          <div className={s.batchBtns}>
            {batches.map((b) => (
              <span key={b.batchId} className={s.batchChip}>
                <span className="num">
                  {b.paypalBatchId ?? "not sent"} · round {b.round} · {b.batchStatus ?? "planned"}
                </span>
                {b.paypalBatchId ? <ReadBackButton settlementId={S.id} batchId={b.batchId} /> : null}
              </span>
            ))}
          </div>
        </div>
        {m.rows.length > 0 ? <PayoutGrid rows={m.rows} /> : <p className={s.empty}>No payouts yet. Distribute sends the first batch.</p>}
      </section>
    </div>
  );
}
