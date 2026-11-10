import { DOCUMENT_REQUEST, REASONS, type CheckId, type ReasonCode } from "@proofofclaim/claims";
import type { ClaimState } from "@proofofclaim/db";
import { claimByStatusToken } from "@proofofclaim/desk";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Stamp } from "@/components/app/Stamp.tsx";
import { CLAIMANT_STATE, claimantState, expectedAmount } from "@/lib/claim-status.ts";
import { claimDetail, pool, settlement } from "@/lib/server/data.ts";
import s from "./status.module.css";

// The link is the key to this page: keep it out of search engines and other sites' logs.
export const metadata: Metadata = { title: "Your claim", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

/**
 * A claimant's private status page (plan item P6). Reachable only with the random link given when
 * they filed (or again after logging in with PayPal), and it shows nothing personal: no name,
 * address, email or PayPal details, so a forwarded link exposes only the claim's progress.
 */
export default async function Status({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const id = await claimByStatusToken({ pool: pool() }, token);
  const d = id ? await claimDetail(id) : null;
  const S = d ? await settlement(d.claim.settlementId) : null;
  if (!d || !S) notFound();
  const c = d.claim;
  const state = claimantState(c.status as ClaimState, c.paypalVerified);
  const words = CLAIMANT_STATE[state];
  const decided = c.outcome !== null;
  const failed = d.checks.filter((k) => k.result === "FAIL");
  const unknown = d.checks.filter((k) => k.result === "UNKNOWN");
  const request = c.outcome === "NEED_MORE" ? unknown.map((k) => DOCUMENT_REQUEST[k.id as CheckId]).find(Boolean) : null;
  const money = expectedAmount({ tier: c.tier, entitlementCents: c.entitlementCents, units: c.units, approved: c.outcome === "APPROVE" }, S.tiers);

  return (
    <div className={s.page}>
      <div className={s.sheet}>
        <p className="label">
          {S.name} · claim <span className="num">{c.id}</span>
        </p>
        <div className={s.stamp}>
          <Stamp outcome={c.outcome} size="lg" />
        </div>
        <h1 className="display">{words.title}</h1>
        <p className={s.next}>{words.detail}</p>
        {decided ? <p className={s.reason}>{c.reason && c.reason in REASONS ? REASONS[c.reason as ReasonCode] : c.reason}</p> : null}
        {request ? <p className={s.request}>Please send: {request}</p> : null}

        <div className={s.amount}>
          <span className="label">{c.outcome === "APPROVE" ? "Your claim" : "What this claim can pay"}</span>
          <b className="num">{money.amount}</b>
          <p>{money.basis}</p>
        </div>

        {d.checks.length > 0 ? (
          <div className={s.checks}>
            <p className="label">The checks your claim went through</p>
            <ul>
              {d.checks.map((k) => (
                <li key={k.id} data-r={k.result}>
                  <span className={s.dot} aria-hidden />
                  {k.name}
                  <span className="sr-only">: {k.result === "PASS" ? "passed" : k.result === "FAIL" ? "failed" : "couldn't tell"}</span>
                </li>
              ))}
            </ul>
            <p className={s.legend}>
              {failed.length === 0 && unknown.length === 0 ? "Every check passed." : `${failed.length} failed, ${unknown.length} couldn't tell. "Couldn't tell" is never treated as a pass.`}
            </p>
          </div>
        ) : null}

        <p className={s.pay}>
          This page is your private link: bookmark it. It shows no name, address or PayPal details, but anyone with the link can see this claim&apos;s
          progress. Lost it? Log in with PayPal on the claim page again for a new one; the old link then stops working.
        </p>
      </div>
      <a className="pill pill--quiet" href={`/claim/${S.id}`}>
        Back to the claim page
      </a>
    </div>
  );
}
