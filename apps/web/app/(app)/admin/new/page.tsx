import type { Metadata } from "next";
import { NewSettlementForm } from "@/components/app/NewSettlementForm.tsx";
import { requireAnalyst } from "@/lib/server/auth.ts";
import { US_STATE_NAMES } from "@/lib/states.ts";
import s from "./new.module.css";

export const metadata: Metadata = { title: "Open a settlement" };
export const dynamic = "force-dynamic";

/** Plan item P18: a supervisor opens a fictional sandbox settlement. */
export default async function NewSettlement() {
  const me = await requireAnalyst("/admin/new");
  return (
    <div className={s.page}>
      <header>
        <p className="label">
          <a href="/settlements">Settlements</a> · open one
        </p>
        <h1 className="display">Open a settlement</h1>
        <p className={s.lede}>
          Everything a claim is checked and paid against: the fund, the class period, what qualifies, where, the two payment tiers, who gets money that can&apos;t be
          delivered, and when filing closes. Settlements here are fictional and paid with sandbox play money.
        </p>
      </header>
      {me.role === "supervisor" ? (
        <NewSettlementForm states={Object.entries(US_STATE_NAMES)} />
      ) : (
        <p className={s.note}>Only a supervisor can open a settlement. You&apos;re logged in as an analyst.</p>
      )}
    </div>
  );
}
