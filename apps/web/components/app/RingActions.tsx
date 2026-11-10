"use client";
import { useState, useTransition } from "react";
import { detectNow, investigateNow } from "@/app/(app)/admin/ring-actions.ts";
import s from "./MoneyActions.module.css";

export function DetectButton({ settlementId }: { settlementId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className={s.inline}>
      <button className="pill pill--quiet" disabled={pending} onClick={() => start(async () => setMsg((await detectNow(settlementId)).message))}>
        {pending ? "Looking for groups…" : "Look for groups again"}
      </button>
      {msg ? <span className={s.ok}>{msg}</span> : null}
    </span>
  );
}

export function InvestigateButton({ settlementId, groupId, again }: { settlementId: string; groupId: number; again: boolean }) {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<{ error: string | null; message: string | null } | null>(null);
  return (
    <span className={s.inline}>
      <button className="pill pill--quiet" disabled={pending} onClick={() => start(async () => setRes(await investigateNow(settlementId, groupId)))}>
        {pending ? "Asking…" : again ? "Ask the investigator again" : "Ask the investigator"}
      </button>
      {res ? <span className={res.error ? s.err : s.ok}>{res.error ?? res.message}</span> : null}
    </span>
  );
}
