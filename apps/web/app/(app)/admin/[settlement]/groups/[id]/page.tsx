import { getGroup, latestInvestigation } from "@proofofclaim/db";
import { memo, type GroupFacts, type InvestigationResult } from "@proofofclaim/examiner";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GroupDecisionButtons, InvestigateButton } from "@/components/app/RingActions.tsx";
import { Stamp } from "@/components/app/Stamp.tsx";
import type { Outcome } from "@/lib/pilot-shared.ts";
import { requireAnalyst } from "@/lib/server/auth.ts";
import { claimViews, pool, settlement } from "@/lib/server/data.ts";
import s from "../groups.module.css";
import g from "./group.module.css";

export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return { title: `Group ${(await params).id}` };
}

const KIND_WORDS = { device: "same device", inbox: "same inbox", story: "near-identical words", building: "same building", network: "same network" } as const;

/** One group (plan items P26, P29): who shares what, and what the investigator said. */
export default async function Group({ params }: { params: Promise<{ settlement: string; id: string }> }) {
  const { settlement: sid, id } = await params;
  await requireAnalyst(`/admin/${sid}/groups/${id}`);
  const S = await settlement(sid);
  const grp = Number.isSafeInteger(Number(id)) ? await getGroup(pool(), Number(id)) : null;
  if (!S || !grp || grp.settlementId !== S.id) notFound();
  const [views, inv] = await Promise.all([claimViews(S.id), latestInvestigation(pool(), grp.id)]);
  const members = views.filter((v) => grp.members.includes(v.id));
  const facts = inv?.facts as GroupFacts | undefined;
  const byLabel = inv?.labels ?? {};
  const toClaim = (label: string) => byLabel[label] ?? label;
  const rejected = inv?.status === "INVALID" || inv?.status === "REFUSED";
  const result: InvestigationResult | null = inv
    ? { status: inv.status, answers: inv.answers as InvestigationResult["answers"], recommendation: inv.recommendation, model: inv.model, factsSha256: inv.factsSha256, costUsd: inv.costUsd, error: inv.error }
    : null;

  return (
    <article className={s.page}>
      <a href={`/admin/${S.id}/groups`} className={g.back}>
        ← Groups
      </a>
      <header>
        <p className="label">
          Group {grp.id} · {grp.status === "HELD" ? "held for a person" : grp.status.toLowerCase()} {grp.active ? "" : "· membership has since changed"}
        </p>
        <h1 className="display">
          {grp.sharedSignals} shared signals among <em>{grp.members.length} claims</em>
        </h1>
      </header>

      {grp.status === "HELD" && grp.active ? (
        <section className={g.decide} aria-label="Decide this group">
          <p>
            <b>A person decides this group.</b> Clearing releases it and each claim stands on its own checks; denying records your denial on every claim not yet paid.
            Payouts wait until every held group is decided.
          </p>
          <GroupDecisionButtons settlementId={S.id} groupId={grp.id} members={grp.members.length} />
        </section>
      ) : grp.decidedBy ? (
        <p className={g.muted}>
          {grp.status === "CLEARED" ? "Cleared" : "Denied"} by {grp.decidedBy.replace("analyst:", "")}.
        </p>
      ) : null}

      <section className={g.cols}>
        <div className={g.panel}>
          <h2 className="label">What they share</h2>
          <table className={g.table}>
            <tbody>
              {(Object.keys(KIND_WORDS) as (keyof typeof KIND_WORDS)[]).map((k) => (
                <tr key={k} data-strong={k === "device" || k === "inbox" || k === "story"}>
                  <td>{KIND_WORDS[k]}</td>
                  <td className="num">{grp.signals[k] ?? 0} pairs</td>
                  <td>{k === "device" || k === "inbox" || k === "story" ? "strong: can form a group" : "weak: only counts towards joining one"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {facts ? (
            <ul className={g.links}>
              {facts.links.map((l, i) => (
                <li key={i}>
                  <span className="num">{toClaim(l.between[0])}</span> and <span className="num">{toClaim(l.between[1])}</span>: {KIND_WORDS[l.kind]}
                  {l.similarity !== undefined ? ` (${Math.round(l.similarity * 100)}%)` : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className={g.panel}>
          <h2 className="label">The AI investigator</h2>
          {rejected ? (
            <p className={g.banner} role="alert">
              The AI&apos;s answer was rejected and not used ({inv?.error ?? inv?.status.toLowerCase()}). A person decides on the evidence.
            </p>
          ) : null}
          {facts && result ? (
            <ul className={g.memo}>
              {memo(facts, result).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className={g.muted}>Not asked yet. It sees stand-in labels (Claim A, Claim B…) and facts computed by code, never names, emails, addresses or networks.</p>
          )}
          {inv ? (
            <p className={g.muted}>
              {inv.status === "REPLAYED" ? "Replayed from a recorded answer for exactly these facts" : `Asked ${inv.model}`} · {inv.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC
            </p>
          ) : null}
          <InvestigateButton settlementId={S.id} groupId={grp.id} again={!!inv} />
        </div>
      </section>

      <section className={g.panel}>
        <h2 className="label">The claims</h2>
        <table className={g.table}>
          <thead>
            <tr>
              <th>Claim</th>
              <th>Label shown to the AI</th>
              <th>Claimant</th>
              <th>State</th>
              <th>Decision</th>
              <th>In the core</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td className="num">
                  <a href={`/admin/${S.id}/claim/${m.id}`}>{m.id}</a>
                </td>
                <td>{Object.entries(byLabel).find(([, c]) => c === m.id)?.[0] ?? "—"}</td>
                <td>{m.name}</td>
                <td>{m.state}</td>
                <td>
                  <Stamp outcome={m.outcome as Outcome | null} />
                </td>
                <td>{grp.core.includes(m.id) ? "yes" : "joined by weak links"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </article>
  );
}
