import { listGroups } from "@proofofclaim/db";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DeskStudio, type DeskRow } from "@/components/app/DeskStudio.tsx";
import { requireAnalyst } from "@/lib/server/auth.ts";
import { asFiledCents, claimViews, pool, settlement } from "@/lib/server/data.ts";
import s from "./ask.module.css";

export const metadata: Metadata = { title: "Ask the desk" };
export const dynamic = "force-dynamic";

const DECISION = { APPROVE: "approved", DENY: "denied", NEED_MORE: "asked for more", REVIEW: "with a person" } as const;

/** Plan item C13: the claims in AG Studio, with a read-only agent that answers questions about them. */
export default async function Ask({ params }: { params: Promise<{ settlement: string }> }) {
  const { settlement: id } = await params;
  await requireAnalyst(`/admin/${id}/ask`);
  const S = await settlement(id);
  if (!S) notFound();
  const [views, groups] = await Promise.all([claimViews(S.id), listGroups(pool(), S.id, { activeOnly: true })]);
  const { rows: when } = await pool().query<{ claim_id: string; at: Date }>(
    "SELECT DISTINCT ON (claim_id) claim_id, created_at AS at FROM decisions WHERE claim_id = ANY($1) ORDER BY claim_id, id DESC",
    [views.map((v) => v.id)],
  );
  const decidedAt = new Map(when.map((r) => [r.claim_id, r.at.toISOString().slice(0, 10)]));
  const groupOf = new Map(groups.flatMap((g) => g.members.map((m) => [m, `Group ${g.id} (${g.status.toLowerCase()})`] as const)));
  // No names, emails, addresses or PayPal identifiers: only what the desk decided and why.
  const rows: DeskRow[] = views.map((v) => ({
    claim: `#${v.seq}`,
    filedOn: v.submittedAt.slice(0, 10),
    proof: v.tier === "proof" ? "receipt" : "no receipt",
    state: v.state,
    decision: v.outcome ? DECISION[v.outcome] : "not decided",
    decidedOn: decidedAt.get(v.id) ?? null,
    decidedBy: v.decidedBy === null ? "" : v.decidedBy === "system" ? "the rules" : "a person",
    reason: v.reason ?? "",
    askedUsd: asFiledCents(v, S) / 100,
    approvedUsd: v.outcome === "APPROVE" ? (v.entitlementCents ?? 0) / 100 : 0,
    modelSaid: v.modelSaid ?? "",
    linkedGroup: groupOf.get(v.id) ?? "",
    merchant: v.merchant ?? "",
    receiptTotalUsd: v.totalCents === null ? null : v.totalCents / 100,
  }));

  return (
    <div className={s.page}>
      <header>
        <p className="label">
          <a href={`/admin/${S.id}`}>Claims desk</a> · ask
        </p>
        <h1 className="display">
          Ask the desk. <em>It can read, not decide.</em>
        </h1>
        <p className={s.lede}>
          The {rows.length} claims in AG Studio, without names, emails or PayPal accounts. The agent answers questions with Studio&apos;s reading tools only: it can query the
          claims and look at this dashboard, but it has no way to approve, deny, hold or pay anything. Try asking it to.
        </p>
      </header>
      <div className={s.studio}>
        <DeskStudio rows={rows} settlementName={S.name} licenseKey={process.env.AG_STUDIO_LICENSE_KEY ?? null} />
      </div>
    </div>
  );
}
