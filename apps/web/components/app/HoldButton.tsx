"use client";
// Press and hold to confirm an irreversible action (money leaving the fund). A keyboard user holds
// Space or Enter. Reduced motion still needs the hold; only the fill animation is dropped.
import { useRef, useState } from "react";
import s from "./HoldButton.module.css";

export function HoldButton({ label, holdMs = 1200, disabled, onConfirm }: { label: string; holdMs?: number; disabled?: boolean; onConfirm: () => void }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | null>(null);
  const start = () => {
    if (disabled || timer.current) return;
    setHolding(true);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setHolding(false);
      onConfirm();
    }, holdMs);
  };
  const stop = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };
  return (
    <button
      type="button"
      className={s.hold}
      data-holding={holding}
      disabled={disabled}
      style={{ "--hold": `${holdMs}ms` } as React.CSSProperties}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onKeyDown={(e) => (e.key === " " || e.key === "Enter") && !e.repeat && (e.preventDefault(), start())}
      onKeyUp={(e) => (e.key === " " || e.key === "Enter") && stop()}
      aria-label={`${label}. Press and hold to confirm.`}
    >
      <span className={s.fill} aria-hidden />
      <span className={s.text}>{holding ? "Keep holding…" : label}</span>
    </button>
  );
}
