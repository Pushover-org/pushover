import { openProposal, planCyPres, planDigest, planDistribution, REOFFER_DAYS, type CyPresPlan, type PlanSummary } from "@proofofclaim/desk";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ApproveButton, ProposeButton, ReadBackButton, WithdrawButton } from "@/components/app/MoneyActions.tsx";
import { PayoutGrid } from "@/components/app/PayoutGrid.tsx";
import { dollars } from "@/lib/labels.ts";
import { requireAnalyst } from "@/lib/server/auth.ts";
import { desk } from "@/lib/server/data.ts";
import { DEMO_DAILY_CAP_CENTS, money } from "@/lib/server/money.ts";
import s from "./money.module.css";

export const metadata: Metadata = { title: "Money" };
export const dynamic = "force-dynamic";

export default async function MoneyPage({ params }: { params: Promise<{ settlement: string }> }) {
  const { settlement: id } = await params;
  const me = await requireAnalyst(`/admin/${id}/money`);
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
  const open = await openProposal(d.pool, S.id, "CLAIMS");
  const cy = await planCyPres(d);
  const cyOpen = await openProposal(d.pool, S.id, "CY_PRES");
  const cyOpenPlan = cyOpen?.plan as CyPresPlan | undefined;
  const cyExpired = cyOpen !== null && cyOpen.expiresAt.getTime() <= Date.now();
  const sentItems = m.rows.filter((r) => r.claimId !== null && r.paypalItemId !== null).length;
  const expired = open !== null && open.expiresAt.getTime() <= Date.now();
  const proposed = open?.plan as PlanSummary | undefined;
  // Shown before anyone presses: approval refuses a plan that no longer hashes the same.
  const stale = open !== null && plan !== null && !planDigest(S.id, plan).hash.equals(open.planHash);
  const at = (d8: Date) => d8.toISOString().replace("T", " ").slice(0, 16);

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
            {plan && plan.waitingVerification > 0 ? (
              <li>
                <b className="num">{plan.waitingVerification}</b> approved but held: their PayPal account isn&apos;t verified, so they&apos;re paid once the claimant logs
                in verified
              </li>
            ) : null}
            {plan && plan.deferred > 0 ? (
              <li>
                <b className="num">{plan.deferred}</b> more approved claims wait for the next round: today&apos;s sandbox limit is reached
              </li>
            ) : null}
            <li>
              Sandbox limit for this public demo: <b className="num">{dollars(DEMO_DAILY_CAP_CENTS, 0)}</b> of play money a day; <b className="num">{dollars(room)}</b> left today, so
              this round pays from that much
            </li>
          </ul>
        </div>
        <div className={s.approval}>
          <p className="label">Two people, every time</p>
          {open && !expired ? (
            <>
              <p className={s.proposal}>
                <b>{open.proposedBy.name}</b> proposed round {proposed?.round ?? "?"} at <span className="num">{at(open.proposedAt)}</span> UTC:{" "}
                <b className="num">{proposed?.items.length ?? 0}</b> payments, <b className="num">{dollars(open.totalCents)}</b>.
              </p>
              {stale ? <p className={s.stale}>Claims changed since this was proposed. Approving will refuse and send nothing; propose the round again.</p> : null}
              {open.proposedBy.id === me.id ? (
                <p className={s.wait}>Waiting for a supervisor other than you to approve.</p>
              ) : me.role === "supervisor" ? (
                <ApproveButton settlementId={S.id} proposalId={open.id} label={`Hold to approve and send ${dollars(open.totalCents)}`} />
              ) : (
                <p className={s.wait}>Waiting for a supervisor to approve. Analysts can propose; only a supervisor who didn&apos;t propose can send.</p>
              )}
              {open.proposedBy.id === me.id || me.role === "supervisor" ? <WithdrawButton settlementId={S.id} proposalId={open.id} /> : null}
            </>
          ) : (
            <>
              <p className={s.wait}>
                {expired ? "The last proposal expired unapproved. " : ""}You propose the round; a supervisor other than you approves it before PayPal is called.
              </p>
              <ProposeButton settlementId={S.id} label={`Propose paying ${dollars(total)}`} disabled={payable.length === 0} />
            </>
          )}
          <p className={s.you}>
            You: {me.name} ({me.role})
          </p>
        </div>
      </section>

      <section className={s.flow} aria-labelledby="where">
        <div>
          <p className="label" id="where">
            Where the money went
          </p>
          <ol className={s.steps}>
            <li>
              <b className="num">{dollars(m.paidCents)}</b> paid and confirmed by PayPal. Of {sentItems} payouts read back,{" "}
              <b className="num">{m.history["CONFIRMED"] ?? 0}</b> already show in PayPal&apos;s own transaction history; {m.history["WAITING"] ?? 0} are waiting for it
              (it runs hours behind){m.history["NEVER_CAUGHT_UP"] ? `, and ${m.history["NEVER_CAUGHT_UP"]} never caught up` : ""}.
            </li>
            <li>
              <b className="num">{dollars(m.unclaimedCents)}</b> waiting for claimants to accept it in PayPal. Unaccepted money comes back to the fund after 30 days.
            </li>
            <li>
              <b className="num">{dollars(m.awaitingReofferCents)}</b> came back and can be sent again: the claimant fixes their PayPal account and asks from their private
              link, for {Number(process.env["REOFFER_DAYS"] ?? REOFFER_DAYS)} days.
            </li>
            <li>
              <b className="num">{dollars(m.cyPresEligibleCents)}</b> came back and wasn&apos;t asked for in time: it goes to {S.cyPres.name}, the nonprofit the court chose
              (cy-près). <b className="num">{dollars(m.cyPresCents)}</b> sent so far.
            </li>
          </ol>
          <p className={s.note}>
            Undelivered money only ever goes back to the fund or to the court&apos;s nonprofit. {m.webhooks.verified} PayPal webhook events verified and stored (
            {m.webhooks.processed} turned into read-backs); a webhook never moves a claim by itself.
          </p>
        </div>
        <div className={s.approval}>
          <p className="label">Cy-près, two people</p>
          {cyOpen && !cyExpired ? (
            <>
              <p className={s.proposal}>
                <b>{cyOpen.proposedBy.name}</b> proposed sending <b className="num">{dollars(cyOpen.totalCents)}</b> from {cyOpenPlan?.items.length ?? 0} returned payments to{" "}
                {cyOpenPlan?.recipient.name ?? S.cyPres.name}.
              </p>
              {cyOpen.proposedBy.id === me.id ? (
                <p className={s.wait}>Waiting for a supervisor other than you to approve.</p>
              ) : me.role === "supervisor" ? (
                <ApproveButton settlementId={S.id} proposalId={cyOpen.id} kind="CY_PRES" label={`Hold to send ${dollars(cyOpen.totalCents)} to ${S.cyPres.name}`} />
              ) : (
                <p className={s.wait}>Waiting for a supervisor to approve.</p>
              )}
              {cyOpen.proposedBy.id === me.id || me.role === "supervisor" ? <WithdrawButton settlementId={S.id} proposalId={cyOpen.id} /> : null}
            </>
          ) : (
            <>
              <p className={s.wait}>
                {cy.totalCents > 0
                  ? `${dollars(cy.totalCents)} from ${cy.items.length} returned ${cy.items.length === 1 ? "payment is" : "payments are"} past the re-offer window.`
                  : "No returned money is past its re-offer window yet."}
              </p>
              <ProposeButton settlementId={S.id} kind="CY_PRES" label={`Propose sending ${dollars(cy.totalCents)} to cy-près`} disabled={cy.totalCents === 0} />
            </>
          )}
        </div>
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
