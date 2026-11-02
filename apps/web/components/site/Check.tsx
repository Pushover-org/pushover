"use client";
// The signature object (docs/design-direction.md): an honest claimant's check. It opens at what
// pay-everyone gives and rises to what Rightful Share gives, both measured in the R9 pilot.
import NumberFlow from "@number-flow/react";
import { useEffect, useRef, useState } from "react";
import styles from "./Check.module.css";

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function dollarsInWords(cents: number): string {
  const d = Math.floor(cents / 100);
  const w = d < 20 ? (ONES[d] ?? "") : `${TENS[Math.floor(d / 10)] ?? ""}${d % 10 ? `-${ONES[d % 10] ?? ""}` : ""}`;
  return `${w.charAt(0).toUpperCase()}${w.slice(1)} and ${String(cents % 100).padStart(2, "0")}/100 dollars`;
}

/** Wavy guilloche lines for the check's security band, drawn once. */
function guilloche(width: number, height: number, lines: number): string {
  const paths: string[] = [];
  for (let k = 0; k < lines; k++) {
    let d = "";
    for (let x = 0; x <= width; x += 4) {
      const y = height / 2 + Math.sin(x / 18 + k * 0.55) * (height * 0.32) * Math.cos(x / 97 + k * 0.21);
      d += `${x === 0 ? "M" : "L"}${x},${y.toFixed(1)}`;
    }
    paths.push(d);
  }
  return paths.join(" ");
}

const BAND = guilloche(520, 60, 14);

export function Check({ fromCents, toCents, claims, bad, stopped }: { fromCents: number; toCents: number; claims: number; bad: number; stopped: number }) {
  const [cents, setCents] = useState(fromCents);
  const [settled, setSettled] = useState(false);
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = window.setTimeout(() => {
      setCents(toCents);
      setSettled(true);
    }, reduce ? 0 : 1600);
    return () => window.clearTimeout(t);
  }, [toCents]);

  useEffect(() => {
    const el = card.current;
    if (!el || window.matchMedia("(pointer: coarse), (prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.setProperty("--rx", `${(-y * 9).toFixed(2)}deg`);
        el.style.setProperty("--ry", `${(x * 12).toFixed(2)}deg`);
        el.style.setProperty("--gx", `${((x + 0.5) * 100).toFixed(1)}%`);
        el.style.setProperty("--gy", `${((y + 0.5) * 100).toFixed(1)}%`);
      });
    };
    const leave = () => {
      el.style.setProperty("--rx", "0deg");
      el.style.setProperty("--ry", "0deg");
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <figure className={styles.stage} aria-label={`An honest claimant's check: $${(toCents / 100).toFixed(2)}, up from $${(fromCents / 100).toFixed(2)} when every claim was paid.`}>
      <div className={styles.under} aria-hidden />
      <div className={styles.under2} aria-hidden />
      <div ref={card} className={styles.check} data-settled={settled}>
        <svg className={styles.band} viewBox="0 0 520 60" preserveAspectRatio="none" aria-hidden>
          <path d={BAND} />
        </svg>
        <div className={styles.sheen} aria-hidden />

        <div className={styles.top}>
          <div>
            <div className={styles.bank}>Rightful Share · Settlement Fund</div>
            <div className={styles.sub}>Acme Restaurant Beverage Settlement (fictional demo)</div>
          </div>
          <div className={styles.no}>
            <span className="label">No.</span> <span className="num">0015</span>
          </div>
        </div>

        <div className={styles.payee}>
          <span className={styles.small}>Pay to the order of</span>
          <span className={styles.name}>An honest claimant</span>
          <span className={styles.amountBox}>
            <span className={styles.dollar}>$</span>
            <NumberFlow value={cents / 100} format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }} className={styles.amount} transformTiming={{ duration: 1400, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }} />
          </span>
        </div>

        <div className={styles.words}>
          <span>{dollarsInWords(cents)}</span>
        </div>

        <div className={styles.bottom}>
          <div className={styles.memo}>
            <span className={styles.small}>Memo</span>
            <span>
              Average honest check, pilot of {claims} claims.{" "}
              <s className={styles.was} data-show={settled}>Paying everyone: ${(fromCents / 100).toFixed(2)}</s>
            </span>
          </div>
          <div className={styles.sign}>
            <svg viewBox="0 0 200 50" className={styles.signature} aria-hidden>
              <path d="M6 34 C 18 10, 30 12, 26 30 S 40 44, 52 22 C 58 12, 62 34, 70 28 S 84 14, 92 26 C 98 36, 108 30, 116 20 C 122 14, 126 30, 134 28 C 146 25, 152 18, 166 22 C 176 25, 184 22, 194 16" />
            </svg>
            <span className={styles.small}>Signed by the rules, not the model</span>
          </div>
        </div>

        <div className={styles.micr} aria-hidden>
          C000015C  A20261101A  {String(toCents).padStart(8, "0")}C
        </div>

      </div>
      <div className={styles.stamp} data-show={settled} aria-hidden>
        <span>{stopped} of {bad} bad claims</span>
        <strong>stopped</strong>
      </div>
    </figure>
  );
}
