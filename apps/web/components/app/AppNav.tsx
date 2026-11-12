"use client";
import { usePathname } from "next/navigation";
import s from "./AppNav.module.css";

const S = "acme-restaurant-beverage";
const LINKS = [
  { href: "/judge", label: "Judges" },
  { href: "/demo", label: "Live demo" },
  { href: `/claim/${S}`, label: "File a claim" },
  { href: `/admin/${S}`, label: "Claims desk" },
  { href: `/admin/${S}/money`, label: "Money" },
  { href: `/report/${S}`, label: "Court report" },
  { href: "/settlements", label: "Settlements" },
];

export function AppNav({ analyst }: { analyst: { name: string; role: string } | null }) {
  const path = usePathname();
  const active = (href: string) => (href === `/admin/${S}` ? path === href || path.startsWith(`${href}/claim`) : path.startsWith(href));
  return (
    <header className={s.bar}>
      <a href="#main" className="sr-only">
        Skip to content
      </a>
      <div className={s.inner}>
        <a href="/" className={s.brand} aria-label="Proof of Claim, home">
          <span className={s.mark} aria-hidden>
            <span />
          </span>
          <span className={s.word}>Proof of Claim</span>
        </a>
        <span className={s.case}>
          <span className={s.dot} aria-hidden /> Acme Restaurant Beverage <em>(fictional demo)</em>
        </span>
        <nav aria-label="Product" className={s.links}>
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} aria-current={active(l.href) ? "page" : undefined}>
              {l.label}
            </a>
          ))}
        </nav>
        {analyst ? (
          <form action="/api/admin/logout" method="post" className={s.who}>
            <span>
              {analyst.name} <em>{analyst.role}</em>
            </span>
            <button>Log out</button>
          </form>
        ) : (
          <a className={s.login} href="/login" aria-current={path === "/login" ? "page" : undefined}>
            Analyst login
          </a>
        )}
      </div>
    </header>
  );
}
