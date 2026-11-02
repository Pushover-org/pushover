"use client";
import { useState, useTransition } from "react";
import { review } from "@/app/(app)/admin/actions.ts";
import s from "./ReviewActions.module.css";

/** A person decides a claim the rules held. Each choice is a new decision on the record. */
export function ReviewActions({ settlementId, claimId }: { settlementId: string; claimId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const act = (o: "APPROVE" | "DENY") =>
    start(async () => {
      const r = await review(settlementId, claimId, o);
      setError(r.error);
    });
  return (
    <div className={s.bar} role="group" aria-label="Review this claim">
      <div>
        <strong>A person decides this one.</strong>
        <p>The rules held it because a check failed or couldn&apos;t tell. Look at the evidence and the checks, then decide. Your decision is added to the record; nothing is overwritten.</p>
        {error ? (
          <p role="alert" className={s.err}>
            {error}
          </p>
        ) : null}
      </div>
      <div className={s.btns}>
        <button className="pill pill--quiet" disabled={pending} onClick={() => act("DENY")}>
          Deny
        </button>
        <button className="pill pill--green" disabled={pending} onClick={() => act("APPROVE")}>
          {pending ? "Recording…" : "Approve"}
        </button>
      </div>
    </div>
  );
}
