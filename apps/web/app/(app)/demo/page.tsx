import { REASONS, type ReasonCode } from "@proofofclaim/claims";
import type { Metadata } from "next";
import { CountUp } from "@/components/app/CountUp.tsx";
import { Stamp } from "@/components/app/Stamp.tsx";
import { dollars, GROUP_LABEL, REASON_SHORT } from "@/lib/labels.ts";
import { asFiledCents, claimViews, CORPUS_SIZE, DEMO_SETTLEMENT, demoTruth, settlement, tally, type ClaimView } from "@/lib/server/data.ts";
import s from "./demo.module.css";

export const metadata: Metadata = { title: "Live demo" };
export const dynamic = "force-dynamic";

const reasonText = (r: string | null) => (r && r in REASONS ? REASONS[r as ReasonCode] : (r ?? ""));

export default async function Demo() {
  const S = await settlement(DEMO_SETTLEMENT);
  if (!S) return <Empty />;
  const [views, truth] = await Promise.all([claimViews(S.id), demoTruth()]);
  if (views.length === 0) return <Empty />;
  const t = tally(views, S, views.length / CORPUS_SIZE);
  const label = (v: ClaimView) => truth.get(v.id);

  const fraud = views.filter((v) => label(v)?.truth === "fraud");
  const askedByFraud = fraud.reduce((a, v) => a + asFiledCents(v, S), 0);
  const paidToFraud = fraud.filter((v) => v.outcome === "APPROVE").reduce((a, v) => a + (v.entitlementCents ?? 0), 0);
  const stopped = views.filter((v) => v.modelSaid === "approve" && (v.outcome === "DENY" || v.outcome === "REVIEW"));
  const overruled = stopped.filter((v) => label(v)?.truth !== "honest");
  const honestStopped = stopped.length - overruled.length;

  const pick = (f: (v: ClaimView) => boolean) => views.find(f) ?? null;
  const spotlights = [
    { title: "A real receipt, approved", v: pick((v) => v.outcome === "APPROVE" && v.hasEvidence && label(v)?.group === "H1" && v.confidence === "high") },
    { title: "A fake with an impossible tax, denied", v: pick((v) => v.reason === "TAX_IMPLAUSIBLE") },
    { title: "A bot farm, held for a person", v: [...views].filter((v) => v.reason === "TEMPLATE_CLUSTER").sort((a, b) => (b.cluster ?? 0) - (a.cluster ?? 0))[0] ?? null },
  ];

  return (
    <div className={s.page}>
      <header className={s.head}>
        <p className="label">
          <span className={s.live} /> Live · every decision below was made by the code that decides a new claim
        </p>
        <h1 className={`display ${s.h1}`}>
          {views.length} claims came in. <em>Here&apos;s what the rules did.</em>
        </h1>
        <p className={s.lede}>
          A fictional settlement loaded with the development and pilot claims from our labelled set: real receipts from a public dataset, rendered fakes, bot-written
          declarations and repeat identities. Each claim shows the label we gave it, so you can check the desk&apos;s work.
        </p>
      </header>

      <section className={s.tally} aria-label="Decisions so far">
        {(["APPROVE", "DENY", "REVIEW", "NEED_MORE"] as const).map((o) => (
          <a key={o} className={s.count} data-o={o} href={`/admin/${S.id}?outcome=${o}`}>
            <CountUp value={t.byOutcome[o]} className={`num ${s.countNum}`} />
            <Stamp outcome={o} />
          </a>
        ))}
      </section>

      <section className={s.money}>
        <div className={s.check}>
          <span className="label">Average check per approved claim</span>
          <CountUp value={t.averageCheckCents} money className={`num ${s.checkNum}`} />
          <p>
            If every claim were paid as filed: <b className="num">{dollars(t.payEveryoneCheckCents)}</b>. Fund scaled to this demo&apos;s share of the {CORPUS_SIZE}-claim
            set, after PayPal&apos;s $0.25 a payout and the admin reserve.
          </p>
        </div>
        <div className={s.fraud}>
          <span className="label">Labelled fraud</span>
          <div className={s.fraudRow}>
            <div>
              <span className={`num ${s.asked}`}>{dollars(askedByFraud, 0)}</span>
              <small>asked for by {fraud.length} fraudulent claims</small>
            </div>
            <span className={s.arrow} aria-hidden>
              →
            </span>
            <div>
              <span className={`num ${s.paid}`}>{dollars(paidToFraud, 0)}</span>
              <small>approved to pay</small>
            </div>
          </div>
          <p>
            {dollars(t.heldCents, 0)} more is held for a person to review. The bot claims that got through each look like one honest person; that is why live claims now
            start with Log in with PayPal.
          </p>
        </div>
      </section>

      <section aria-labelledby="spot" className={s.spotWrap}>
        <h2 id="spot" className="label">
          Three claims, one click each
        </h2>
        <div className={s.spots}>
          {spotlights.map(({ title, v }) =>
            v ? (
              <a key={title} className={s.spot} href={`/admin/${S.id}/claim/${v.id}`}>
                <div className={s.spotMedia}>
                  {v.hasEvidence ? (
                    <img src={`/api/evidence/${v.id}`} alt={`The evidence filed with claim ${v.id}`} loading="lazy" />
                  ) : (
                    <blockquote>
                      <span className="label">Declaration · cluster of {v.cluster ?? "?"}</span>
                      <DeclarationPeek id={v.id} />
                    </blockquote>
                  )}
                  <span className={s.spotStamp}>
                    <Stamp outcome={v.outcome} size="lg" />
                  </span>
                </div>
                <div className={s.spotBody}>
                  <span className="label">
                    {v.id} · {GROUP_LABEL[label(v)?.group ?? ""] ?? "unlabelled"}
                  </span>
                  <h3>{title}</h3>
                  <p>{reasonText(v.reason)}</p>
                  <span className={s.more}>Open in the claims desk →</span>
                </div>
              </a>
            ) : null,
          )}
        </div>
      </section>

      <section className={s.overrule}>
        <div>
          <p className="label">Model said, rules said</p>
          <h2 className="display">
            The examiner recommended approving <em>{overruled.length}</em> bad claims the rules stopped.
          </h2>
          <p>
            Its recommendation is logged, never used. The rules also stopped {honestStopped} labelled-honest {honestStopped === 1 ? "claim" : "claims"} it would have approved; open
            the claims desk to see each one and why.
          </p>
        </div>
        <ul>
          {overruled.slice(0, 8).map((v) => (
            <li key={v.id}>
              <a href={`/admin/${S.id}/claim/${v.id}`}>
                <span className="num">{v.id}</span>
                <span className={s.said}>Model: approve</span>
                <Stamp outcome={v.outcome} />
                <span className={s.why}>{REASON_SHORT[v.reason ?? ""] ?? v.reason}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className={s.next}>
        <a className={s.nextCard} href={`/claim/${S.id}`}>
          <span className="label">Your turn</span>
          <h3>File a claim yourself</h3>
          <p>Upload a receipt or file without one, and watch the rules decide in seconds.</p>
        </a>
        <a className={s.nextCard} href={`/admin/${S.id}`}>
          <span className="label">For the analyst</span>
          <h3>Open the claims desk</h3>
          <p>Every claim, every check, the review queue, and the Distribute button.</p>
        </a>
        <a className={s.nextCard} href={`/report/${S.id}`}>
          <span className="label">For the court</span>
          <h3>Read the court report</h3>
          <p>Every decision, reason and amount, with personal details masked. CSV included.</p>
        </a>
      </section>
    </div>
  );
}

async function DeclarationPeek({ id }: { id: string }) {
  const { pool } = await import("@/lib/server/data.ts");
  const { rows } = await pool().query<{ declaration: string }>("SELECT declaration FROM claims WHERE id = $1", [id]);
  return <p>&ldquo;{rows[0]?.declaration}&rdquo;</p>;
}

function Empty() {
  return (
    <div className={s.page}>
      <h1 className={`display ${s.h1}`}>The demo settlement isn&apos;t loaded yet.</h1>
      <p className={s.lede}>
        Run <code>pnpm demo:seed</code> against this database, then reload.
      </p>
    </div>
  );
}
