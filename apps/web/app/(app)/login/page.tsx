import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/app/LoginForm.tsx";
import { currentAnalyst, safeNext } from "@/lib/server/auth.ts";
import s from "./login.module.css";

export const metadata: Metadata = { title: "Analyst login" };
export const dynamic = "force-dynamic";

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; out?: string }> }) {
  const { next, out } = await searchParams;
  if (await currentAnalyst()) redirect(safeNext(next));
  return (
    <div className={s.page}>
      <section className={s.card}>
        <p className="label">Claims desk</p>
        <h1 className="display">Analyst login</h1>
        <p className={s.lede}>
          The desk shows claimants&apos; details and moves money, so every review and every payout is recorded against a named person. Money needs two: one analyst
          proposes, a different supervisor approves.
        </p>
        {out ? <p className={s.note}>You&apos;re logged out.</p> : null}
        <LoginForm next={safeNext(next)} />
        <p className={s.judge}>
          Judging? The sandbox analyst and supervisor logins are on the <a href="/judge">judges&apos; page</a>.
        </p>
      </section>
    </div>
  );
}
