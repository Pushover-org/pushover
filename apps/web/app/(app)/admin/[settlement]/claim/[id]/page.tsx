import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClaimDossier } from "@/components/app/ClaimDossier.tsx";
import { ReviewActions } from "@/components/app/ReviewActions.tsx";
import { requireAnalyst } from "@/lib/server/auth.ts";
import { claimDetail, demoTruth, settlement } from "@/lib/server/data.ts";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return { title: `Claim ${(await params).id}` };
}

export default async function ClaimPage({ params }: { params: Promise<{ settlement: string; id: string }> }) {
  const { settlement: sid, id } = await params;
  await requireAnalyst(`/admin/${sid}/claim/${id}`);
  const [S, d, truth] = await Promise.all([settlement(sid), claimDetail(id), demoTruth()]);
  if (!S || !d || d.claim.settlementId !== S.id) notFound();
  return (
    <ClaimDossier
      S={S}
      d={d}
      t={truth.get(d.claim.id)}
      back={{ href: `/admin/${S.id}`, label: "Claims desk" }}
      actions={d.claim.outcome === "REVIEW" ? <ReviewActions settlementId={S.id} claimId={d.claim.id} /> : null}
    />
  );
}
