"use client";
import { useActionState } from "react";
import { logIn } from "@/app/(app)/login/actions.ts";
import s from "./ClaimForm.module.css";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(logIn, { error: null });
  return (
    <form action={action} className={s.form}>
      <input type="hidden" name="next" value={next} />
      <label className={s.field}>
        <span className={s.lbl}>Email</span>
        <input name="email" type="email" autoComplete="username" required maxLength={200} />
      </label>
      <label className={s.field}>
        <span className={s.lbl}>Password</span>
        <input name="password" type="password" autoComplete="current-password" required maxLength={200} />
      </label>
      {state.error ? (
        <p role="alert" className={s.err}>
          {state.error}
        </p>
      ) : null}
      <button className={`pill pill--green ${s.submit}`} disabled={pending}>
        {pending ? "Checking…" : "Log in"}
      </button>
    </form>
  );
}
