"use client";
import { useState, useTransition } from "react";
import { distributeNow, readBackNow, type ActionResult } from "@/app/(app)/admin/money-actions.ts";
import { HoldButton } from "./HoldButton.tsx";
import s from "./MoneyActions.module.css";

export function DistributeButton({ settlementId, label, disabled }: { settlementId: string; label: string; disabled: boolean }) {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<ActionResult | null>(null);
  return (
    <div className={s.wrap}>
      <HoldButton label={pending ? "Sending to PayPal…" : label} disabled={disabled || pending} onConfirm={() => start(async () => setRes(await distributeNow(settlementId)))} />
      {res?.error ? <p role="alert" className={s.err}>{res.error}</p> : null}
      {res?.message ? <p role="status" className={s.ok}>{res.message}</p> : null}
    </div>
  );
}

export function ReadBackButton({ settlementId, batchId }: { settlementId: string; batchId: number }) {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<ActionResult | null>(null);
  return (
    <span className={s.inline}>
      <button className="pill pill--quiet" disabled={pending} onClick={() => start(async () => setRes(await readBackNow(settlementId, batchId)))}>
        {pending ? "Reading…" : "Read back from PayPal"}
      </button>
      {res ? <span className={res.error ? s.err : s.ok}>{res.error ?? res.message}</span> : null}
    </span>
  );
}
