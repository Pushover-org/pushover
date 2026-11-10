import { claimIdByPseudonym } from "@proofofclaim/db";
import { pseudonymOf } from "@proofofclaim/desk";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ClaimForm } from "@/components/app/ClaimForm.tsx";
import { dollars } from "@/lib/labels.ts";
import { identityKeys, pool, settlement } from "@/lib/server/data.ts";
import { IDENTITY_COOKIE, openIdentity } from "@/lib/server/paypal-login.ts";
import s from "./claim.module.css";

export const metadata: Metadata = { title: "File a claim" };
export const dynamic = "force-dynamic";

const LOGIN_ERROR: Record<string, string> = {
  expired: "That login link expired. Please log in again.",
  cancelled: "You cancelled the PayPal login. You need it to file a claim.",
  failed: "PayPal didn't confirm your account. Please try again.",
};

export default async function Claim({ params, searchParams }: { params: Promise<{ settlement: string }>; searchParams: Promise<{ login?: string }> }) {
  const [{ settlement: id }, { login }] = await Promise.all([params, searchParams]);
  const S = await settlement(id);
  if (!S) notFound();
  const me = openIdentity((await cookies()).get(IDENTITY_COOKIE)?.value);
  const keys = identityKeys();
  // One PayPal account files one claim here: a returning claimant gets their link, not a form that would be refused.
  const filed = me && keys ? await claimIdByPseudonym(pool(), S.id, pseudonymOf(keys, S.id, me.payerId)) : null;
  const first = me?.name.split(" ")[0];
  const closesAt = S.filing ? new Date(S.filing.closesAt) : null;
  const closed = closesAt !== null && closesAt.getTime() < Date.now();

  return (
    <div className={s.page}>
      <section className={s.intro}>
        <p className="label">{S.name}</p>
        <h1 className="display">
          Claim your <em>share.</em>
        </h1>
        <p className={s.lede}>
          If you bought a non-alcoholic drink at a restaurant in one of the class states between {S.classPeriod.start.slice(0, 4)} and {S.classPeriod.end.slice(0, 4)}, you can
          claim. It takes about two minutes, and you see the decision straight away.
        </p>
        <dl className={s.terms}>
          <div>
            <dt>With a receipt</dt>
            <dd>
              <b className="num">{dollars(S.tiers.proof.unitCents, 0)}</b> a drink, up to {S.tiers.proof.maxUnits}
            </dd>
          </div>
          <div>
            <dt>Without a receipt</dt>
            <dd>
              <b className="num">{dollars(S.tiers.noProof.flatCents, 0)}</b> flat
            </dd>
          </div>
          {closesAt ? (
            <div>
              <dt>Filing {closed ? "closed" : "closes"}</dt>
              <dd className="num">{closesAt.toISOString().slice(0, 10)}</dd>
            </div>
          ) : null}
          <div>
            <dt>Class states</dt>
            <dd className="num">{S.geography.states.join(" · ")}</dd>
          </div>
        </dl>
        <div className={s.how}>
          <p className="label">What happens to your claim</p>
          <ol>
            <li>You log in with PayPal, so the payment can only go to your own account. One account, one claim.</li>
            <li>An AI reads your receipt and reports what it shows. It doesn&apos;t decide.</li>
            <li>Twelve checks and a published rule table decide. If something is unclear, a person looks, or we ask you for one more document.</li>
            <li>When the court approves the distribution, PayPal pays you directly.</li>
          </ol>
        </div>
      </section>

      <section className={s.formCard} aria-label="Your claim">
        <div className={s.step} data-done={!!me}>
          <span className={`num ${s.stepNo}`}>1</span>
          <div className={s.stepBody}>
            <h2>Log in with PayPal</h2>
            {me ? (
              <div className={s.who}>
                <p>
                  Signed in as <b>{me.name || me.email}</b>
                  {me.verified ? <span className={s.ok}>verified account</span> : <span className={s.warn}>not verified yet: an approved claim is paid once it is</span>}
                </p>
                <form action={`/api/paypal/logout?settlement=${S.id}`} method="post">
                  <button className={s.link}>Use a different account</button>
                </form>
              </div>
            ) : (
              <>
                <p className={s.muted}>Your payment goes to the PayPal account you log in with. We never see your password, and we keep no PayPal token.</p>
                {login && LOGIN_ERROR[login] ? (
                  <p role="alert" className={s.err}>
                    {LOGIN_ERROR[login]}
                  </p>
                ) : null}
                <a className={s.paypal} href={`/api/paypal/login?settlement=${S.id}`}>
                  Log in with PayPal
                </a>
                <p className={s.hint}>
                  Judging the demo? Use a sandbox buyer from the README, such as <span className="num">po-buyer1-3h8w@personal.example.com</span>. It&apos;s play money.
                </p>
              </>
            )}
          </div>
        </div>

        <div className={s.step} data-locked={!me}>
          <span className={`num ${s.stepNo}`}>2</span>
          <div className={s.stepBody}>
            <h2>{first ? `Your claim, ${first}` : "Your claim"}</h2>
            {closed ? (
              <p className={s.muted}>Filing for this settlement closed on {closesAt?.toISOString().slice(0, 10)}. No new claims are taken.</p>
            ) : me && filed ? (
              <div className={s.filed}>
                <p>
                  This PayPal account has already filed a claim in this settlement. Each account files once. Your private status link was shown when you filed;
                  here&apos;s a new one (the old link stops working).
                </p>
                <form action={`/api/claims/status-link?settlement=${S.id}`} method="post">
                  <button className="pill pill--green">Show my claim&apos;s status</button>
                </form>
              </div>
            ) : me ? (
              <ClaimForm
                settlementId={S.id}
                states={[...S.geography.states]}
                maxUnits={S.tiers.proof.maxUnits}
                unitCents={S.tiers.proof.unitCents}
                flatCents={S.tiers.noProof.flatCents}
                prefill={{ name: me.name, addressLine: me.address?.line ?? "", city: me.address?.city ?? "", state: me.address?.state ?? "", zip: me.address?.zip ?? "" }}
              />
            ) : (
              <p className={s.muted}>Log in first. Then tell us what you bought and, if you have one, add a photo of the receipt.</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
