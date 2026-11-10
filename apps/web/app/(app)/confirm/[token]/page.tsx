import { filingToConfirm, settlementOfConfirmLink } from "@proofofclaim/desk";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { LangSwitch } from "@/components/app/LangSwitch.tsx";
import { Stamp } from "@/components/app/Stamp.tsx";
import type { MessageKey } from "@/lib/i18n.ts";
import { US_STATE_NAMES } from "@/lib/states.ts";
import { desk, pool } from "@/lib/server/data.ts";
import { claimantLang } from "@/lib/server/lang.ts";
import { IDENTITY_COOKIE, openIdentity } from "@/lib/server/paypal-login.ts";
import s from "./confirm.module.css";

// The link is the key to this page, as with the status page: keep it out of search engines and logs.
export const metadata: Metadata = { title: "Is this claim yours?", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

const ERRORS = ["link_expired", "already_filed", "not_sworn", "login", "unavailable"] as const;
const LOGIN_ERRORS = { expired: "claim.loginExpired", cancelled: "claim.loginCancelled", failed: "claim.loginFailed" } as const;

/**
 * Where an assistant's filing becomes a person's claim (plan items P13, P11). The person sees what
 * was filed in their name and by which assistant, logs in with PayPal, and swears to it, or closes it.
 * Until then it is shown as waiting, never as done.
 */
export default async function Confirm({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string; login?: string; lang?: string }> }) {
  const [{ token }, q] = await Promise.all([params, searchParams]);
  const { lang, t } = await claimantLang(q.lang);

  if (token === "closed") return <Gone lang={lang} t={t} title={t("confirm.closedTitle")} detail={t("confirm.closedDetail")} />;
  const settlementId = await settlementOfConfirmLink(pool(), token);
  const D = settlementId ? await desk(settlementId) : null;
  const f = D ? await filingToConfirm(D, token) : null;
  if (!D || !f) return <Gone lang={lang} t={t} title={t("confirm.goneTitle")} detail={t("confirm.goneDetail")} />;

  const S = D.settlement;
  const me = openIdentity((await cookies()).get(IDENTITY_COOKIE)?.value);
  const error = ERRORS.find((e) => e === q.error);
  const loginError = q.login && q.login in LOGIN_ERRORS ? t(LOGIN_ERRORS[q.login as keyof typeof LOGIN_ERRORS]) : null;
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const langField = <input type="hidden" name="lang" value={lang} />;

  return (
    <div className={s.page} lang={lang}>
      <div className={s.top}>
        <LangSwitch lang={lang} label={t("lang.choose")} />
      </div>
      <article className={s.sheet}>
        <p className={`label ${s.meta}`}>
          {S.name} · {t("confirm.label")}
        </p>
        <div className={s.stamp}>
          <Stamp outcome="REVIEW" size="lg" label={t("confirm.stamp")} />
        </div>
        <h1 className="display">{t("confirm.title")}</h1>
        <p className={s.lede}>{t("confirm.lede", { agent: f.agentName, date: day(f.agentFiledAt) })}</p>
        <p className={s.lapses}>{t("confirm.lapses", { date: day(f.lapsesAt) })}</p>

        <section className={s.filed} aria-labelledby="filed-title">
          <h2 id="filed-title" className="label">
            {t("confirm.whatFiled")}
          </h2>
          <dl>
            <div>
              <dt>{t("confirm.name")}</dt>
              <dd>{f.name}</dd>
            </div>
            <div>
              <dt>{t("confirm.address")}</dt>
              <dd>
                {f.addressLine}, {f.city ? `${f.city}, ` : ""}
                {US_STATE_NAMES[f.state] ?? f.state} <span className="num">{f.zip}</span>
              </dd>
            </div>
            <div>
              <dt>{t("confirm.kind")}</dt>
              <dd>{f.tier === "proof" ? t("confirm.withReceipt", { units: f.unitsClaimed }) : t("confirm.withoutReceipt")}</dd>
            </div>
            {f.hasReceipt ? (
              <div>
                <dt>{t("confirm.receipt")}</dt>
                <dd>{t("confirm.receiptAttached")}</dd>
              </div>
            ) : null}
            <div className={s.words}>
              <dt>{t("confirm.words")}</dt>
              <dd>
                <blockquote>{f.declaration}</blockquote>
              </dd>
            </div>
          </dl>
        </section>

        {error ? (
          <p role="alert" className={s.err}>
            {t(`confirm.err.${error}` as MessageKey)}
          </p>
        ) : null}

        <ol className={s.steps}>
          <li className={s.step} data-done={!!me}>
            <span className={`num ${s.stepNo}`} aria-hidden>
              1
            </span>
            <div className={s.stepBody}>
              <h2>{t("confirm.step1")}</h2>
              {me ? (
                <div className={s.who}>
                  <p>
                    {t("confirm.signedInAs", { who: me.name || me.email })}
                    {me.verified ? <span className={s.ok}>{t("claim.verified")}</span> : <span className={s.warn}>{t("claim.notVerified")}</span>}
                  </p>
                  <form action={`/api/paypal/logout?settlement=${S.id}&confirm=${token}`} method="post">
                    <button className={s.link}>{t("confirm.otherAccount")}</button>
                  </form>
                </div>
              ) : (
                <>
                  <p className={s.muted}>{t("confirm.loginWhy")}</p>
                  {loginError ? (
                    <p role="alert" className={s.err}>
                      {loginError}
                    </p>
                  ) : null}
                  <a className={s.paypal} href={`/api/paypal/login?settlement=${S.id}&confirm=${token}`}>
                    {t("claim.loginButton")}
                  </a>
                </>
              )}
            </div>
          </li>
          <li className={s.step} data-locked={!me}>
            <span className={`num ${s.stepNo}`} aria-hidden>
              2
            </span>
            <div className={s.stepBody}>
              <h2>{t("confirm.step2")}</h2>
              <form action="/api/claims/confirm" method="post" className={s.confirm}>
                <input type="hidden" name="token" value={token} />
                <input type="hidden" name="action" value="confirm" />
                {langField}
                <label className={s.sworn}>
                  <input type="checkbox" name="sworn" value="yes" required disabled={!me} />
                  <span>{t("confirm.sworn")}</span>
                </label>
                <button className="pill pill--green" disabled={!me} aria-disabled={!me}>
                  {t("confirm.mine")}
                </button>
                <p className={s.hint}>{t("confirm.after")}</p>
              </form>
            </div>
          </li>
        </ol>

        <section className={s.notMine} aria-labelledby="not-mine-title">
          <h2 id="not-mine-title">{t("confirm.notMineTitle")}</h2>
          <p>{t("confirm.notMineHint")}</p>
          <form action="/api/claims/confirm" method="post">
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="action" value="disown" />
            {langField}
            <button className="pill pill--danger">{t("confirm.notMine")}</button>
          </form>
        </section>
      </article>
    </div>
  );
}

function Gone({ lang, t, title, detail }: { lang: string; t: (k: MessageKey) => string; title: string; detail: string }) {
  return (
    <div className={s.page} lang={lang}>
      <article className={s.sheet}>
        <h1 className="display">{title}</h1>
        <p className={s.lede}>{detail}</p>
        <a className="pill pill--quiet" href="/settlements">
          {t("confirm.fileYourself")}
        </a>
      </article>
    </div>
  );
}
