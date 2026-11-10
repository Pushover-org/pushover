import { listGroups, openAppeals } from "@proofofclaim/db";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClaimsGrid, type GridRow } from "@/components/app/ClaimsGrid.tsx";
import { dollars } from "@/lib/labels.ts";
import { requireAnalyst } from "@/lib/server/auth.ts";
import { asFiledCents, claimViews, demoTruth, pool, settlement } from "@/lib/server/data.ts";
import s from "../admin.module.css";

export const metadata: Metadata = { title: "Claims desk" };
export const dynamic = "force-dynamic";

export default async function Admin({ params, searchParams }: { params: Promise<{ settlement: string }>; searchParams: Promise<{ outcome?: string }> }) {
  const [{ settlement: id }, { outcome }] = await Promise.all([params, searchParams]);
  await requireAnalyst(`/admin/${id}`);
  const S = await settlement(id);
  if (!S) notFound();
  const [views, truth, groups] = await Promise.all([claimViews(S.id), demoTruth(), listGroups(pool(), S.id, { activeOnly: true })]);
  const groupOf = new Map(groups.flatMap((g) => g.members.map((m) => [m, { id: g.id, size: g.members.length, status: g.status, href: `/admin/${S.id}/groups/${g.id}` }] as const)));
  const appealed = new Set((await openAppeals(pool(), S.id)).map((f) => f.claimId));
  const rows: GridRow[] = views.map((v) => {
    const t = truth.get(v.id);
    return {
      id: v.id, seq: v.seq, tier: v.tier, name: v.name, state: v.state, outcome: v.outcome, reason: v.reason, entitlementCents: v.entitlementCents, asFiledCents: asFiledCents(v, S),
      hasEvidence: v.hasEvidence, failed: v.failed, unknown: v.unknown, modelSaid: v.modelSaid, cluster: v.cluster, decidedBy: v.decidedBy,
      label: t?.group ?? null, truth: t?.truth ?? null, paypalVerified: v.paypalVerified, paypal: v.paypalPseudonym?.slice(0, 10) ?? null, group: groupOf.get(v.id) ?? null,
      waiting: v.status === "REVIEW", appealed: appealed.has(v.id),
    };
  });
  const review = views.filter((v) => v.status === "REVIEW").length;

  return (
    <div className={s.page}>
      <header className={s.head}>
        <div>
          <p className="label">Claims desk · {S.name}</p>
          <h1 className={`display ${s.h1}`}>
            {review > 0 ? (
              <>
                <em>{review}</em> {review === 1 ? "claim needs" : "claims need"} a person.
              </>
            ) : (
              <>The review queue is clear.</>
            )}
          </h1>
        </div>
        <dl className={s.facts}>
          <div>
            <dt className="label">Fund</dt>
            <dd className="num">{dollars(S.fundCents, 0)}</dd>
          </div>
          <div>
            <dt className="label">Class period</dt>
            <dd className="num">
              {S.classPeriod.start.slice(0, 4)}–{S.classPeriod.end.slice(0, 4)}
            </dd>
          </div>
          <div>
            <dt className="label">With a receipt</dt>
            <dd className="num">
              {dollars(S.tiers.proof.unitCents, 0)} × up to {S.tiers.proof.maxUnits}
            </dd>
          </div>
          <div>
            <dt className="label">Without</dt>
            <dd className="num">{dollars(S.tiers.noProof.flatCents, 0)} flat</dd>
          </div>
          <div>
            <dt className="label">States</dt>
            <dd className="num">{S.geography.states.length}</dd>
          </div>
        </dl>
        <div className={s.headLinks}>
          <a className="pill pill--quiet" href={`/admin/${S.id}/groups`}>
            Linked groups
          </a>
          <a className="pill pill--quiet" href={`/admin/${S.id}/scoreboard`}>
            Scoreboard
          </a>
          <a className="pill pill--quiet" href={`/admin/${S.id}/ask`}>
            Ask the desk
          </a>
          <a className="pill pill--green" href={`/admin/${S.id}/money`}>
            Distribute & money
          </a>
        </div>
      </header>
      <ClaimsGrid rows={rows} settlementId={S.id} initial={outcome ?? (review > 0 ? "REVIEW" : "ALL")} />
    </div>
  );
}
