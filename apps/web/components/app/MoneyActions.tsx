"use client";
import { useState, useTransition } from "react";
import { approveNow, cancelNow, proposeNow, readBackNow, type ActionResult } from "@/app/(app)/admin/money-actions.ts";
import { HoldButton } from "./HoldButton.tsx";
import s from "./MoneyActions.module.css";

function Result({ res }: { res: ActionResult | null }) {
  if (!res) return null;
  return res.error ? (
    <p role="alert" className={s.err}>
      {res.error}
    </p>
  ) : (
    <p role="status" className={s.ok}>
      {res.message}
    </p>
  );
}

/** Step one: an analyst records the exact round. Nothing is sent. */
export function ProposeButton({ settlementId, label, disabled }: { settlementId: string; label: string; disabled: boolean }) {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<ActionResult | null>(null);
  return (
    <div className={s.wrap}>
      <button className="pill pill--green" disabled={disabled || pending} onClick={() => start(async () => setRes(await proposeNow(settlementId)))}>
        {pending ? "Re-checking and planning…" : label}
      </button>
      <Result res={res} />
    </div>
  );
}

/** Step two: a different supervisor approves, and only then does PayPal get called. */
export function ApproveButton({ settlementId, proposalId, label }: { settlementId: string; proposalId: number; label: string }) {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<ActionResult | null>(null);
  return (
    <div className={s.wrap}>
      <HoldButton label={pending ? "Sending to PayPal…" : label} disabled={pending} onConfirm={() => start(async () => setRes(await approveNow(settlementId, proposalId)))} />
      <Result res={res} />
    </div>
  );
}

export function WithdrawButton({ settlementId, proposalId }: { settlementId: string; proposalId: number }) {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<ActionResult | null>(null);
  return (
    <span className={s.inline}>
      <button className="pill pill--quiet" disabled={pending} onClick={() => start(async () => setRes(await cancelNow(settlementId, proposalId)))}>
        {pending ? "Withdrawing…" : "Withdraw proposal"}
      </button>
      <Result res={res} />
    </span>
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
