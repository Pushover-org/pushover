import { listGroups, latestInvestigation } from "@proofofclaim/db";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BulkDecisionButtons, DetectButton } from "@/components/app/RingActions.tsx";
import { requireAnalyst } from "@/lib/server/auth.ts";
import { pool, settlement } from "@/lib/server/data.ts";
import s from "./groups.module.css";

export const metadata: Metadata = { title: "Groups" };
export const dynamic = "force-dynamic";

const REC = { CLEAR: "AI: clear", DENY_GROUP: "AI: deny group", PERSON_DECIDES: "AI: no recommendation" } as const;

/** Groups of linked claims (plan item P26). Held is not denied: a person clears or denies each. */
export default async function Groups({ params }: { params: Promise<{ settlement: string }> }) {
  const { settlement: id } = await params;
  await requireAnalyst(`/admin/${id}/groups`);
  const S = await settlement(id);
  if (!S) notFound();
  const groups = await listGroups(pool(), S.id, { activeOnly: true });
  const inv = await Promise.all(groups.map((g) => latestInvestigation(pool(), g.id)));

  return (
    <div className={s.page}>
      <header className={s.head}>
        <div>
          <p className="label">
            <a href={`/admin/${S.id}`}>Claims desk</a> · groups
          </p>
          <h1 className="display">
            {groups.length} {groups.length === 1 ? "group" : "groups"} of linked claims, <em>held for a person.</em>
          </h1>
          <p className={s.lede}>
            A group forms only around claims that share a device, one inbox or near-identical words. A shared home, dorm or café network alone never makes one; it only
            counts towards joining such a core. Held is not denied: a person clears or denies each group, and the AI investigator only recommends.
          </p>
        </div>
        <div className={s.headActions}>
          <a className="pill pill--quiet" href={`/admin/${S.id}/groups/timeline`}>
            Timeline
          </a>
          <DetectButton settlementId={S.id} />
        </div>
      </header>
      {groups.some((g) => g.status === "HELD") ? (
        <div className={s.bulk}>
          <p>
            {groups.filter((g) => g.status === "HELD").length} held. Payouts wait until every held group is decided. Following the AI&apos;s recommendations in bulk is
            still your decision, recorded group by group.
          </p>
          <BulkDecisionButtons
            settlementId={S.id}
            toClear={groups.filter((g, i) => g.status === "HELD" && inv[i]?.recommendation === "CLEAR").length}
            toDeny={groups.filter((g, i) => g.status === "HELD" && inv[i]?.recommendation === "DENY_GROUP").length}
          />
        </div>
      ) : null}
      {groups.length === 0 ? <p className={s.empty}>No groups among the claims.</p> : null}
      <ul className={s.list}>
        {groups.map((g, i) => {
          const r = inv[i];
          const strong = (["device", "inbox", "story"] as const).filter((k) => (g.signals[k] ?? 0) > 0);
          return (
            <li key={g.id}>
              <a href={`/admin/${S.id}/groups/${g.id}`} className={s.card}>
                <span className={`num ${s.size}`}>{g.members.length}</span>
                <span className={s.what}>
                  <b>
                    {g.sharedSignals} shared signals among {g.members.length} claims
                  </b>
                  <small>
                    core: {strong.map((k) => `${g.signals[k]} ${k}`).join(", ")}
                    {(g.signals["network"] ?? 0) + (g.signals["building"] ?? 0) > 0 ? ` · also ${g.signals["network"] ?? 0} network, ${g.signals["building"] ?? 0} building` : ""}
                  </small>
                </span>
                <span className={s.status} data-s={g.status}>
                  {g.status === "HELD" ? "Held" : g.status === "CLEARED" ? "Cleared" : "Denied"}
                </span>
                <span className={s.rec} data-r={r?.status === "INVALID" || r?.status === "REFUSED" ? "rejected" : (r?.recommendation ?? "none")}>
                  {r ? (r.status === "INVALID" || r.status === "REFUSED" ? "AI answer rejected" : r.answers ? REC[r.recommendation] : "AI not asked") : "AI not asked"}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
