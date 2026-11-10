import { latestInvestigation, listGroups } from "@proofofclaim/db";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GroupTimeline } from "@/components/app/GroupTimeline.tsx";
import { requireAnalyst } from "@/lib/server/auth.ts";
import { claimViews, pool, settlement } from "@/lib/server/data.ts";
import s from "../groups.module.css";

export const metadata: Metadata = { title: "Group timeline" };
export const dynamic = "force-dynamic";

const STATUS = { HELD: "Held", CLEARED: "Cleared", DENIED: "Denied" } as const;

/** Plan item P24: when each linked group's claims were filed. A burst on one row is what a ring looks like. */
export default async function GroupTimelinePage({
  params,
}: {
  params: Promise<{ settlement: string }>;
}) {
  const { settlement: id } = await params;
  await requireAnalyst(`/admin/${id}/groups/timeline`);
  const S = await settlement(id);
  if (!S) notFound();
  const [groups, views] = await Promise.all([
    listGroups(pool(), S.id, { activeOnly: true }),
    claimViews(S.id),
  ]);
  const inv = await Promise.all(
    groups.map((g) => latestInvestigation(pool(), g.id)),
  );
  const p = (i: number) => inv[i]?.answers?.probability_coordinated ?? null;
  const order = groups
    .map((g, i) => ({ g, p: p(i) }))
    .sort(
      (a, b) =>
        Number(b.g.status === "HELD") - Number(a.g.status === "HELD") ||
        (b.p ?? -1) - (a.p ?? -1) ||
        a.g.id - b.g.id,
    );
  const byId = new Map(views.map((v) => [v.id, v]));
  const data = {
    settlementId: S.id,
    groups: order.map(({ g, p }) => ({
      id: g.id,
      size: g.members.length,
      status: STATUS[g.status],
      probability: p === null ? "not asked" : `${Math.round(p * 100)}%`,
    })),
    events: order.flatMap(({ g }) =>
      g.members.flatMap((m) => {
        const v = byId.get(m);
        return v
          ? [
              {
                claimId: v.id,
                groupId: g.id,
                seq: v.seq,
                filedAt: v.submittedAt,
                outcome: v.outcome,
              },
            ]
          : [];
      }),
    ),
  };

  return (
    <div className={s.page}>
      <header className={s.timelineHead}>
        <p className="label">
          <a href={`/admin/${S.id}`}>Claims desk</a> ·{" "}
          <a href={`/admin/${S.id}/groups`}>groups</a> · timeline
        </p>
        <h1 className="display">
          When each group <em>filed.</em>
        </h1>
        <p className={s.lede}>
          One row per linked group, held groups first, then by how likely the AI
          investigator thought the group was coordinated. Each mark is one claim
          at the moment it was filed; a tight burst on one row is what a ring
          usually looks like, and claims spread over weeks often a real
          household. Click a mark to open the claim.
        </p>
      </header>
      {data.groups.length === 0 ? (
        <p className={s.empty}>No groups among the claims.</p>
      ) : (
        <div className={s.timeline}>
          <GroupTimeline
            data={data}
            licenseKey={process.env.BRYNTUM_LICENSE_KEY ?? null}
          />
        </div>
      )}
    </div>
  );
}
