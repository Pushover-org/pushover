"use client";
import { useEffect, useState } from "react";
import styles from "./Nav.module.css";

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header className={styles.nav} data-scrolled={scrolled}>
      <a href="#main" className="sr-only">
        Skip to content
      </a>
      <div className={`wrap ${styles.inner}`}>
        <a href="/" className={styles.brand} aria-label="Proof of Claim, home">
          <span className={styles.mark} aria-hidden>
            <span />
          </span>
          Proof of Claim
        </a>
        <nav aria-label="Main" className={styles.links}>
          <a href="/judge">Judges start here</a>
          <a href="/#pile">How it decides</a>
          <a href="/#numbers">The numbers</a>
          <a href="/report/acme-restaurant-beverage">Court report</a>
        </nav>
        <a href="/demo" className={`pill pill--green ${styles.cta}`}>
          Live demo
        </a>
      </div>
    </header>
  );
}
