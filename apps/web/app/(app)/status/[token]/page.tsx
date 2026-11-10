import { CHECK_IDS, DOCUMENT_REQUEST, REASONS, type CheckId } from "@proofofclaim/claims";
import { moneyBack, type ClaimState } from "@proofofclaim/db";
import { claimByStatusToken, followupOptions, MAX_REOFFERS, REOFFER_DAYS } from "@proofofclaim/desk";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LangSwitch } from "@/components/app/LangSwitch.tsx";
import { Stamp } from "@/components/app/Stamp.tsx";
import { claimantState, expectedAmount } from "@/lib/claim-status.ts";
import type { MessageKey } from "@/lib/i18n.ts";
import { plainReasons } from "@/lib/plain-reasons.ts";
import { claimDetail, desk, pool, settlement } from "@/lib/server/data.ts";
import { claimantLang } from "@/lib/server/lang.ts";
import s from "./status.module.css";

// The link is the key to this page: keep it out of search engines and other sites' logs.
export const metadata: Metadata = { title: "Your claim", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

const ERRORS = ["not_image", "too_big", "no_file", "not_waiting", "too_short", "too_long", "already_open", "not_now"] as const;

/**
 * A claimant's private status page (plan items P6, C3, P9, B3, C12). Reachable only with the random
 * link given when they filed (or again after logging in with PayPal), and it shows nothing personal:
 * no name, address, email or PayPal details, so a forwarded link exposes only the claim's progress.
 */
export default async function Status({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ reoffer?: string; sent?: string; error?: string; lang?: string; confirmed?: string }> }) {
  const [{ token }, q] = await Promise.all([params, searchParams]);
  const id = await claimByStatusToken({ pool: pool() }, token);
  const d = id ? await claimDetail(id) : null;
  const S = d ? await settlement(d.claim.settlementId) : null;
  const D = d ? await desk(d.claim.settlementId) : null;
  if (!d || !S || !D) notFound();
  const { lang, t } = await claimantLang(q.lang);
  const c = d.claim;
  const opts = await followupOptions(D, c.id);
  const state = claimantState(c.status as ClaimState, c.paypalVerified, opts.heldInGroup);
  const decided = c.outcome !== null;
  const failed = d.checks.filter((k) => k.result === "FAIL");
  const unknown = d.checks.filter((k) => k.result === "UNKNOWN");
  const requestFor = c.outcome === "NEED_MORE" ? unknown.map((k) => k.id).find((k) => k in DOCUMENT_REQUEST) : undefined;
  // C4: a payment that came back can be asked for again, once the account is fixed, within the window.
  const back = c.status === "RETURNED" || c.status === "FAILED" ? await moneyBack(pool(), c.id) : null;
  const days = Number(process.env["REOFFER_DAYS"] ?? REOFFER_DAYS);
  const until = back?.at ? new Date(back.at.getTime() + days * 86_400_000) : null;
  const canAsk = back !== null && back.reoffers < MAX_REOFFERS && (until === null || until.getTime() > Date.now());
  const money = expectedAmount({ tier: c.tier, entitlementCents: c.entitlementCents, units: c.units, approved: c.outcome === "APPROVE" }, S.tiers, t);
  const reasons = plainReasons({
    outcome: c.outcome, tier: c.tier, unitsClaimed: c.unitsClaimed, claimantState: c.state, findings: d.findings, settlement: S, canAppeal: opts.canAppeal, canSendDocument: opts.canSendDocument,
    checks: d.checks.map((k) => ({ id: k.id, result: k.result })),
  });
  const waitingForClose = S.filing?.decideAfterClose && (c.status === "SUBMITTED" || c.status === "EXAMINED") && new Date(S.filing.closesAt).getTime() > Date.now();
  const error = ERRORS.find((e) => e === q.error);
  const checkName = (id: CheckId) => (CHECK_IDS.includes(id) ? t(`check.${id}` as MessageKey) : id);
  const action = `/api/claims/followup?token=${encodeURIComponent(token)}`;

  return (
    <div className={s.page} lang={lang}>
      <div className={s.top}>
        <LangSwitch lang={lang} label={t("lang.choose")} />
      </div>
      <div className={s.sheet}>
        <p className={`label ${s.meta}`}>
          {S.name} · {t("status.claim")} <span className="num">{c.id}</span>
        </p>
        <div className={s.stamp}>
          {(() => {
            const o = state === "GROUP_HELD" ? "REVIEW" : c.outcome;
            return <Stamp outcome={o} size="lg" label={t(`stamp.${o ?? "PENDING"}` as MessageKey)} />;
          })()}
        </div>
        <h1 className="display">{t(`state.${state}.title` as MessageKey)}</h1>
        <p className={s.next}>{waitingForClose ? t("state.decideAfterClose", { date: S.filing?.closesAt.slice(0, 10) ?? "" }) : t(`state.${state}.detail` as MessageKey)}</p>
        {decided ? <p className={s.reason}>{c.reason && c.reason in REASONS ? t(`reason.${c.reason}` as MessageKey) : c.reason}</p> : null}
        {requestFor ? <p className={s.request}>{t("status.pleaseSend", { request: t(`request.${requestFor}` as MessageKey) })}</p> : null}

        {q.confirmed === "1" ? <p className={s.notice} role="status">{t("status.confirmed")}</p> : null}
        {q.sent === "document" ? <p className={s.notice} role="status">{t("doc.sent")}</p> : null}
        {q.sent === "appeal" ? <p className={s.notice} role="status">{t("appeal.sent")}</p> : null}
        {error ? (
          <p className={s.error} role="alert">
            {t("followup.error", { error: t(`followup.err.${error}` as MessageKey) })}
          </p>
        ) : null}
        {q.reoffer === "asked" ? <p className={s.request}>{t("status.reofferDone")}</p> : null}
        {q.reoffer === "refused" ? <p className={s.request}>{t("status.reofferRefused")}</p> : null}

        {reasons.length > 0 ? (
          <section className={s.why} aria-labelledby="why-title">
            <h2 id="why-title" className="label">
              {t("why.title")}
            </h2>
            <ul>
              {reasons.map((r) => (
                <li key={r.id} data-r={r.result}>
                  <b>{checkName(r.id)}</b>
                  <span>{t(r.why, r.params)}</span>
                  {r.fix ? <small>{t(r.fix)}</small> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {opts.canSendDocument ? (
          <form action={action} method="post" encType="multipart/form-data" className={s.followup}>
            <input type="hidden" name="kind" value="document" />
            <h2>{t("doc.title")}</h2>
            {requestFor ? <p>{t(`request.${requestFor}` as MessageKey)}</p> : null}
            <label className={s.file}>
              <span>{t("doc.file")}</span>
              <input type="file" name="file" accept="image/jpeg,image/png,image/webp,image/gif" capture="environment" required />
            </label>
            <p className={s.hint}>{t("doc.hint")}</p>
            <button className="pill pill--green">{t("doc.button")}</button>
          </form>
        ) : null}

        {opts.openAppeal ? <p className={s.notice}>{t("appeal.open")}</p> : null}
        {opts.canAppeal ? (
          <details className={s.followup} open={c.status === "DENY" || state === "GROUP_HELD" || error !== undefined}>
            <summary>
              <h2>{t("appeal.title")}</h2>
            </summary>
            <form action={action} method="post" encType="multipart/form-data">
              <input type="hidden" name="kind" value="appeal" />
              <p>{t("appeal.lede")}</p>
              <label className={s.file}>
                <span>{t("appeal.message")}</span>
                <textarea name="message" rows={4} minLength={10} maxLength={2000} required placeholder={t("appeal.placeholder")} />
              </label>
              <p className={s.hint}>{t("appeal.hint")}</p>
              <label className={s.file}>
                <span>{t("appeal.file")}</span>
                <input type="file" name="file" accept="image/jpeg,image/png,image/webp,image/gif" capture="environment" />
              </label>
              <button className="pill pill--green">{t("appeal.button")}</button>
            </form>
          </details>
        ) : null}

        {canAsk ? (
          <form action={`/api/claims/reoffer?token=${encodeURIComponent(token)}`} method="post" className={s.reoffer}>
            <p>{t("status.reofferAsk", { until: until ? t("status.reofferBy", { date: until.toISOString().slice(0, 10) }) : "" })}</p>
            <button className="pill pill--green">{t("status.reofferButton")}</button>
          </form>
        ) : null}

        <div className={s.amount}>
          <span className="label">{c.outcome === "APPROVE" ? t("status.yourClaim") : t("status.canPay")}</span>
          <b className="num">{money.amount}</b>
          <p>{money.basis}</p>
        </div>

        {d.checks.length > 0 ? (
          <div className={s.checks}>
            <p className="label">{t("status.checksTitle")}</p>
            <ul>
              {d.checks.map((k) => (
                <li key={k.id} data-r={k.result}>
                  <span className={s.dot} aria-hidden />
                  {checkName(k.id)}
                  <span className="sr-only">: {k.result === "PASS" ? t("status.passed") : k.result === "FAIL" ? t("status.failed") : t("status.unknown")}</span>
                </li>
              ))}
            </ul>
            <p className={s.legend}>{failed.length === 0 && unknown.length === 0 ? t("status.allPassed") : t("status.someFailed", { failed: failed.length, unknown: unknown.length })}</p>
          </div>
        ) : null}

        <p className={s.pay}>{t("status.private")}</p>
      </div>
      <a className="pill pill--quiet" href={`/claim/${S.id}`}>
        {t("status.back")}
      </a>
    </div>
  );
}
