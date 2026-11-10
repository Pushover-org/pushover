import { REASONS, type ReasonCode } from "@proofofclaim/claims";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReviewActions } from "@/components/app/ReviewActions.tsx";
import { Stamp } from "@/components/app/Stamp.tsx";
import { dollars, GROUP_LABEL } from "@/lib/labels.ts";
import { asFiledCents, claimDetail, demoTruth, settlement } from "@/lib/server/data.ts";
import s from "./claim.module.css";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return { title: `Claim ${(await params).id}` };
}

const reasonText = (r: string | null) => (r && r in REASONS ? REASONS[r as ReasonCode] : (r ?? ""));
const RESULT = { PASS: "Pass", FAIL: "Fail", UNKNOWN: "Can't tell" } as const;

export default async function ClaimPage({ params }: { params: Promise<{ settlement: string; id: string }> }) {
  const { settlement: sid, id } = await params;
  const [S, d, truth] = await Promise.all([settlement(sid), claimDetail(id), demoTruth()]);
  if (!S || !d || d.claim.settlementId !== S.id) notFound();
  const c = d.claim;
  const f = d.findings;
  const t = truth.get(c.id);
  const modelApproves = f?.model_recommendation === "approve";
  const rulesApprove = c.outcome === "APPROVE";

  return (
    <article className={s.page}>
      <a className={s.back} href={`/admin/${S.id}`}>
        ← Claims desk
      </a>

      <header className={s.head}>
        <div className={s.who}>
          <p className="label">
            Claim <span className="num">{c.id}</span> · filed {new Date(c.submittedAt).toISOString().slice(0, 10)} · {c.tier === "proof" ? "with a receipt" : "without a receipt"}
          </p>
          <h1 className="display">{c.name}</h1>
          <p className={s.addr}>
            {d.addressLine}, {c.state} {d.zip} · {c.email}
            {c.paypalVerified !== null ? <span className={s.pp}>{c.paypalVerified ? "PayPal account verified" : "PayPal account not verified"}</span> : null}
          </p>
        </div>
        <div className={s.verdict}>
          <Stamp outcome={c.outcome} size="lg" />
          <p>{reasonText(c.reason)}</p>
          <p className={s.amount}>
            {c.outcome === "APPROVE" ? (
              <>
                Entitled to <b className="num">{dollars(c.entitlementCents)}</b>
                {c.units ? ` for ${c.units} of ${c.unitsClaimed} drinks claimed` : ""}
              </>
            ) : (
              <>
                Asked for <s className="num">{dollars(asFiledCents(c, S))}</s>
              </>
            )}
          </p>
          {t ? (
            <p className={s.truth} data-truth={t.truth}>
              Label: {GROUP_LABEL[t.group] ?? t.group}. {t.why}
            </p>
          ) : null}
        </div>
      </header>

      {c.outcome === "REVIEW" ? <ReviewActions settlementId={S.id} claimId={c.id} /> : null}

      <div className={s.body}>
        <section className={s.evidence} aria-label="Evidence">
          {c.hasEvidence ? (
            <figure className={s.photo}>
              <div className={s.photoFrame}>
                <img src={`/api/evidence/${c.id}`} alt={`Receipt filed with claim ${c.id}`} />
                {f?.visual_anomalies
                  .filter((a) => a.box)
                  .map((a, i) => {
                    const [x, y, w, h] = a.box ?? [0, 0, 0, 0];
                    return (
                      <span key={i} className={s.box} style={{ left: `${(x ?? 0) * 100}%`, top: `${(y ?? 0) * 100}%`, width: `${(w ?? 0) * 100}%`, height: `${(h ?? 0) * 100}%` }} title={`${a.kind}: ${a.where}`}>
                        <i>{a.kind.replace("_", " ")}</i>
                      </span>
                    );
                  })}
              </div>
              <figcaption>
                {f?.visual_anomalies.length ? `${f.visual_anomalies.length} visual ${f.visual_anomalies.length === 1 ? "oddity" : "oddities"} reported` : "No visual oddities reported"}
              </figcaption>
            </figure>
          ) : (
            <div className={s.noReceipt}>
              <span className="label">No receipt</span>
              <p>This claim was filed at the flat no-receipt tier, so only identity, geography and cluster checks apply.</p>
            </div>
          )}
          <div className={s.declaration}>
            <span className="label">Sworn declaration</span>
            <blockquote>&ldquo;{d.declaration}&rdquo;</blockquote>
          </div>
        </section>

        <section className={s.side}>
          {f ? (
            <div className={s.vs}>
              <div className={s.vsCol} data-side="model">
                <span className="label">Model said</span>
                <strong data-agree={modelApproves === rulesApprove}>{f.model_recommendation}</strong>
                <p>Logged, never used. The examiner&apos;s confidence in its reading: {f.confidence}.</p>
              </div>
              <div className={s.vsCol} data-side="rules">
                <span className="label">Rules said</span>
                <Stamp outcome={c.outcome} />
                <p>
                  Decision table v1{c.rule !== null ? `, rule ${c.rule}` : ""}. {c.decidedBy?.startsWith("analyst:") ? "Then a person reviewed it." : ""}
                </p>
              </div>
            </div>
          ) : null}

          <div className={s.panel}>
            <h2 className="label">Checks, in code</h2>
            <table className={s.checks}>
              <tbody>
                {d.checks.map((k) => (
                  <tr key={k.id} data-r={k.result}>
                    <td className="num">{k.id}</td>
                    <td>{k.name}</td>
                    <td>
                      <span className={s.result}>{RESULT[k.result]}</span>
                    </td>
                    <td className={s.detail}>{k.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {f ? (
            <div className={s.panel}>
              <h2 className="label">What the receipt says</h2>
              <dl className={s.kv}>
                <div>
                  <dt>Store</dt>
                  <dd>{f.merchant_name ?? "—"}</dd>
                </div>
                <div>
                  <dt>Address</dt>
                  <dd>{f.merchant_address ?? "—"}</dd>
                </div>
                <div>
                  <dt>Date</dt>
                  <dd className="num">{f.purchase_date ?? "—"}</dd>
                </div>
              </dl>
              <table className={s.lines}>
                <tbody>
                  {f.line_items.map((l, i) => (
                    <tr key={i} data-match={l.matches_product_id !== null}>
                      <td>
                        {l.qty && l.qty !== 1 && !l.description.startsWith(`${l.qty} `) ? `${l.qty} × ` : ""}
                        {l.description}
                        {l.matches_product_id ? <span className={s.qual}>qualifies</span> : null}
                      </td>
                      <td className="num">{dollars(l.line_total_cents)}</td>
                    </tr>
                  ))}
                  <tr className={s.sum}>
                    <td>Subtotal</td>
                    <td className="num">{dollars(f.subtotal_cents)}</td>
                  </tr>
                  <tr className={s.sum}>
                    <td>Tax</td>
                    <td className="num">{dollars(f.tax_cents)}</td>
                  </tr>
                  <tr className={s.total}>
                    <td>Total</td>
                    <td className="num">{dollars(f.total_cents)}</td>
                  </tr>
                </tbody>
              </table>
              <p className={s.note}>
                Read by <span className="num">{d.examiner?.model}</span>. Code recomputes every number above; the reading is evidence, not instructions.
              </p>
            </div>
          ) : d.examiner && d.examiner.status !== "OK" ? (
            <div className={s.panel}>
              <h2 className="label">Reading</h2>
              <p>The examiner&apos;s reading came back {d.examiner.status.toLowerCase().replace("_", " ")}, so the rules sent this claim to a person.</p>
            </div>
          ) : null}

          <div className={s.panel}>
            <h2 className="label">Record (append-only)</h2>
            <ol className={s.history}>
              {d.history.map((h) => (
                <li key={h.id}>
                  <span className="num">{new Date(h.at).toISOString().replace("T", " ").slice(0, 16)}</span>
                  <b>{h.outcome}</b> {h.reason}
                  <span className={s.by}>{h.decidedBy === "system" ? `system, rule ${h.rule}` : h.decidedBy.replace("analyst:", "analyst ")}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </div>
    </article>
  );
}
