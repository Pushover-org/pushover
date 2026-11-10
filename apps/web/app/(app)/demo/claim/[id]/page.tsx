import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClaimDossier } from "@/components/app/ClaimDossier.tsx";
import { claimDetail, DEMO_SETTLEMENT, demoTruth, settlement } from "@/lib/server/data.ts";
import s from "./public.module.css";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return { title: `Demo claim ${(await params).id}` };
}

/**
 * A labelled claim from the demo corpus, open to anyone: its people are fictional and its receipts
 * are a public dataset and our own renders. Claims filed by real people never appear here.
 */
export default async function DemoClaim({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [S, d, truth] = await Promise.all([settlement(DEMO_SETTLEMENT), claimDetail(id), demoTruth()]);
  const t = truth.get(id);
  if (!S || !d || !t || d.claim.settlementId !== S.id || d.claim.paypalVerified !== null) notFound();
  return (
    <ClaimDossier
      S={S}
      d={d}
      t={t}
      back={{ href: "/demo", label: "Live demo" }}
      actions={
        <p className={s.note}>
          A read-only view of a labelled demo claim. Analysts review held claims on the <a href={`/admin/${S.id}`}>claims desk</a>, which needs a login.
        </p>
      }
    />
  );
}
