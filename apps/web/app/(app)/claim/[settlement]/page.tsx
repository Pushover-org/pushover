import { claimIdByPseudonym } from "@proofofclaim/db";
import { pseudonymOf } from "@proofofclaim/desk";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ClaimForm } from "@/components/app/ClaimForm.tsx";
import { LangSwitch } from "@/components/app/LangSwitch.tsx";
import { dollars } from "@/lib/labels.ts";
import { identityKeys, pool, settlement } from "@/lib/server/data.ts";
import { claimantLang } from "@/lib/server/lang.ts";
import { IDENTITY_COOKIE, openIdentity } from "@/lib/server/paypal-login.ts";
import s from "./claim.module.css";

export const metadata: Metadata = { title: "File a claim" };
export const dynamic = "force-dynamic";

const LOGIN_ERROR = { expired: "claim.loginExpired", cancelled: "claim.loginCancelled", failed: "claim.loginFailed" } as const;

/** The claim page (plan items P1, C11, C12): phone-first, in English, Spanish or Hindi. */
export default async function Claim({ params, searchParams }: { params: Promise<{ settlement: string }>; searchParams: Promise<{ login?: string; lang?: string }> }) {
  const [{ settlement: id }, { login, lang: asked }] = await Promise.all([params, searchParams]);
  const S = await settlement(id);
  if (!S) notFound();
  const me = openIdentity((await cookies()).get(IDENTITY_COOKIE)?.value);
  const keys = identityKeys();
  // One PayPal account files one claim here: a returning claimant gets their link, not a form that would be refused.
  const filed = me && keys ? await claimIdByPseudonym(pool(), S.id, pseudonymOf(keys, S.id, me.payerId)) : null;
  const first = me?.name.split(" ")[0];
  const closesAt = S.filing ? new Date(S.filing.closesAt) : null;
  const closed = closesAt !== null && closesAt.getTime() < Date.now();
  const { lang, t } = await claimantLang(asked);
  const loginError = login && login in LOGIN_ERROR ? t(LOGIN_ERROR[login as keyof typeof LOGIN_ERROR]) : null;
  const [judgeBefore, judgeAfter] = t("claim.judgeHint").split("{email}");
  // The amount stays bold wherever a language puts it in the sentence.
  const bold = (text: string, amount: string) => {
    const [a, b] = text.split("{amount}");
    return (
      <>
        {a}
        <b className="num">{amount}</b>
        {b}
      </>
    );
  };

  return (
    <div className={s.page} lang={lang}>
      <section className={s.intro}>
        <div className={s.topline}>
          <p className="label">{S.name}</p>
          <LangSwitch lang={lang} label={t("lang.choose")} />
        </div>
        <h1 className="display">
          {t("claim.title")} <em>{t("claim.titleEm")}</em>
        </h1>
        <p className={s.lede}>{t("claim.lede", { from: S.classPeriod.start.slice(0, 4), to: S.classPeriod.end.slice(0, 4) })}</p>
        <dl className={s.terms}>
          <div>
            <dt>{t("claim.withReceipt")}</dt>
            <dd>{bold(t("claim.perDrink", { max: S.tiers.proof.maxUnits }), dollars(S.tiers.proof.unitCents, 0))}</dd>
          </div>
          <div>
            <dt>{t("claim.withoutReceipt")}</dt>
            <dd>{bold(t("claim.flat"), dollars(S.tiers.noProof.flatCents, 0))}</dd>
          </div>
          {closesAt ? (
            <div>
              <dt>{closed ? t("claim.filingClosed") : t("claim.filingCloses")}</dt>
              <dd className="num">{closesAt.toISOString().slice(0, 10)}</dd>
            </div>
          ) : null}
          <div>
            <dt>{t("claim.classStates")}</dt>
            <dd className="num">{S.geography.states.join(" · ")}</dd>
          </div>
        </dl>
        <div className={s.how}>
          <p className="label">{t("claim.howTitle")}</p>
          <ol>
            <li>{t("claim.how1")}</li>
            <li>{t("claim.how2")}</li>
            <li>{t("claim.how3")}</li>
            <li>{t("claim.how4")}</li>
          </ol>
        </div>
      </section>

      <section className={s.formCard} aria-label={t("claim.formLabel")}>
        <div className={s.step} data-done={!!me}>
          <span className={`num ${s.stepNo}`} aria-hidden>
            1
          </span>
          <div className={s.stepBody}>
            <h2>{t("claim.step1")}</h2>
            {me ? (
              <div className={s.who}>
                <p>
                  {t("claim.signedInAs", { who: me.name || me.email })}
                  {me.verified ? <span className={s.ok}>{t("claim.verified")}</span> : <span className={s.warn}>{t("claim.notVerified")}</span>}
                </p>
                <form action={`/api/paypal/logout?settlement=${S.id}`} method="post">
                  <button className={s.link}>{t("claim.otherAccount")}</button>
                </form>
              </div>
            ) : (
              <>
                <p className={s.muted}>{t("claim.loginWhy")}</p>
                {loginError ? (
                  <p role="alert" className={s.err}>
                    {loginError}
                  </p>
                ) : null}
                <a className={s.paypal} href={`/api/paypal/login?settlement=${S.id}`}>
                  {t("claim.loginButton")}
                </a>
                <p className={s.hint}>
                  {judgeBefore}
                  <span className="num">po-buyer1-3h8w@personal.example.com</span>
                  {judgeAfter}
                </p>
              </>
            )}
          </div>
        </div>

        <div className={s.step} data-locked={!me}>
          <span className={`num ${s.stepNo}`} aria-hidden>
            2
          </span>
          <div className={s.stepBody}>
            <h2>{first ? t("claim.step2Named", { name: first }) : t("claim.step2")}</h2>
            {closed ? (
              <p className={s.muted}>{t("claim.closedNote", { date: closesAt?.toISOString().slice(0, 10) ?? "" })}</p>
            ) : me && filed ? (
              <div className={s.filed}>
                <p>{t("claim.alreadyFiled")}</p>
                <form action={`/api/claims/status-link?settlement=${S.id}`} method="post">
                  <button className="pill pill--green">{t("claim.showStatus")}</button>
                </form>
              </div>
            ) : me ? (
              <ClaimForm
                lang={lang}
                settlementId={S.id}
                states={[...S.geography.states]}
                maxUnits={S.tiers.proof.maxUnits}
                unitCents={S.tiers.proof.unitCents}
                flatCents={S.tiers.noProof.flatCents}
                prefill={{ name: me.name, addressLine: me.address?.line ?? "", city: me.address?.city ?? "", state: me.address?.state ?? "", zip: me.address?.zip ?? "" }}
              />
            ) : (
              <p className={s.muted}>{t("claim.loginFirst")}</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
