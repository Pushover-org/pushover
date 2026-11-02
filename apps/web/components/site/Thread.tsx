"use client";
// The thread (docs/design-direction.md): one ledger-green rule down the left margin that fills as
// you read, with a tick for each section. Desktop only.
import { useEffect, useRef } from "react";
import styles from "./Thread.module.css";

export function Thread() {
  const line = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const update = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      line.current?.style.setProperty("--p", String(max > 0 ? Math.min(1, window.scrollY / max) : 0));
    };
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
      cancelAnimationFrame(raf);
    };
  }, []);
  return (
    <div ref={line} className={styles.thread} aria-hidden>
      <div className={styles.fill} />
      <div className={styles.dot} />
    </div>
  );
}
