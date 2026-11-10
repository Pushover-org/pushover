"use client";
import { useState, useTransition } from "react";
import { bulkDecideNow, decideGroupNow, detectNow, investigateNow } from "@/app/(app)/admin/ring-actions.ts";
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

/** Asks once more before acting: a group decision changes many claims at once. */
function Confirmed({ label, confirm, tone, onConfirm }: { label: string; confirm: string; tone: "quiet" | "danger"; onConfirm: () => Promise<{ error: string | null; message: string | null }> }) {
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  const [res, setRes] = useState<{ error: string | null; message: string | null } | null>(null);
  return (
    <span className={s.inline}>
      {asking ? (
        <>
          <span>{confirm}</span>
          <button className={`pill ${tone === "danger" ? "pill--danger" : "pill--green"}`} disabled={pending} onClick={() => start(async () => (setRes(await onConfirm()), setAsking(false)))}>
            {pending ? "Recording…" : "Yes, do it"}
          </button>
          <button className="pill pill--quiet" disabled={pending} onClick={() => setAsking(false)}>
            Cancel
          </button>
        </>
      ) : (
        <button className="pill pill--quiet" onClick={() => setAsking(true)}>
          {label}
        </button>
      )}
      {res ? <span className={res.error ? s.err : s.ok}>{res.error ?? res.message}</span> : null}
    </span>
  );
}

export function GroupDecisionButtons({ settlementId, groupId, members }: { settlementId: string; groupId: number; members: number }) {
  return (
    <span className={s.inline}>
      <Confirmed label="Clear this group" tone="quiet" confirm="Release the group? Each claim then stands on its own checks." onConfirm={() => decideGroupNow(settlementId, groupId, "CLEARED")} />
      <Confirmed label={`Deny every claim in this group (${members})`} tone="danger" confirm={`Deny all ${members} claims as your decision?`} onConfirm={() => decideGroupNow(settlementId, groupId, "DENIED")} />
    </span>
  );
}

export function BulkDecisionButtons({ settlementId, toClear, toDeny }: { settlementId: string; toClear: number; toDeny: number }) {
  return (
    <span className={s.inline}>
      {toClear > 0 ? (
        <Confirmed label={`Clear every group the AI recommends clearing (${toClear})`} tone="quiet" confirm={`Clear ${toClear} group${toClear === 1 ? "" : "s"} as your decision?`} onConfirm={() => bulkDecideNow(settlementId, "CLEAR")} />
      ) : null}
      {toDeny > 0 ? (
        <Confirmed label={`Deny every group the AI recommends denying (${toDeny})`} tone="danger" confirm={`Deny ${toDeny} group${toDeny === 1 ? "" : "s"} and their claims as your decision?`} onConfirm={() => bulkDecideNow(settlementId, "DENY_GROUP")} />
      ) : null}
    </span>
  );
}

