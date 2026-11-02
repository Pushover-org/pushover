import { DOCUMENT_REQUEST, REASONS, type CheckId, type ReasonCode } from "@pushover/claims";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Stamp } from "@/components/app/Stamp.tsx";
import { dollars } from "@/lib/labels.ts";
import { claimDetail, pool } from "@/lib/server/data.ts";
import { IDENTITY_COOKIE, openIdentity } from "@/lib/server/paypal-login.ts";
import s from "./result.module.css";

export const metadata: Metadata = { title: "Your decision" };
export const dynamic = "force-dynamic";

const NEXT: Record<string, string> = {
  APPROVE: "When the court approves the distribution, PayPal pays you directly into the account you logged in with. If fewer valid claims come in than the fund can cover, everyone's share is the full amount; if more, every approved claim is reduced by the same proportion.",
  DENY: "The reason above is the whole reason: it comes from a published rule, not from an opinion, and it is on the court's record.",
  REVIEW: "A claims analyst will look at your evidence and decide. Nothing is wrong with your claim yet; the rules simply ask a person to check this kind of case.",
  NEED_MORE: "Nothing is decided against you. This demo doesn't take follow-up documents yet; in a live settlement you would add it here and the rules would decide again.",
};

export default async function Result({ params }: { params: Promise<{ settlement: string; id: string }> }) {
  const { settlement, id } = await params;
  const me = openIdentity((await cookies()).get(IDENTITY_COOKIE)?.value);
  const { rows } = await pool().query<{ paypal_payer_id: string | null }>("SELECT paypal_payer_id FROM claims WHERE id = $1 AND settlement_id = $2", [id, settlement]);
  // Only the claimant who filed it sees this page.
  if (!me || !rows[0] || rows[0].paypal_payer_id !== me.payerId) notFound();
  const d = await claimDetail(id);
  if (!d) notFound();
  const c = d.claim;
  const failed = d.checks.filter((k) => k.result === "FAIL");
  const unknown = d.checks.filter((k) => k.result === "UNKNOWN");
  const request = c.outcome === "NEED_MORE" ? unknown.map((k) => DOCUMENT_REQUEST[k.id as CheckId]).find(Boolean) : null;

  return (
    <div className={s.page}>
      <div className={s.sheet}>
        <p className="label">
          Claim <span className="num">{c.id}</span> · decided in seconds by the rules
        </p>
        <div className={s.stamp}>
          <Stamp outcome={c.outcome} size="lg" />
        </div>
        <h1 className="display">{c.outcome === "APPROVE" ? <>You&apos;re approved for <em>{dollars(c.entitlementCents)}</em>.</> : c.outcome === "DENY" ? "Your claim was denied." : c.outcome === "NEED_MORE" ? "We need one more document." : "A person will check your claim."}</h1>
        <p className={s.reason}>{c.reason && c.reason in REASONS ? REASONS[c.reason as ReasonCode] : c.reason}</p>
        {request ? <p className={s.request}>Please send: {request}</p> : null}
        <p className={s.next}>{NEXT[c.outcome ?? "REVIEW"]}</p>

        <div className={s.checks}>
          <p className="label">The checks your claim went through</p>
          <ul>
            {d.checks.map((k) => (
              <li key={k.id} data-r={k.result}>
                <span className={s.dot} aria-hidden />
                {k.name}
                <span className="sr-only">: {k.result}</span>
              </li>
            ))}
          </ul>
          <p className={s.legend}>
            {failed.length === 0 && unknown.length === 0 ? "Every check passed." : `${failed.length} failed, ${unknown.length} couldn't tell. Can't tell is never treated as a pass.`}
          </p>
        </div>
        <p className={s.pay}>Payment goes to your PayPal account{c.paypalVerified ? " (verified)" : ""}. We never see your password, and we keep no PayPal token.</p>
      </div>
      <a className="pill pill--quiet" href="/demo">
        Back to the live demo
      </a>
    </div>
  );
}
