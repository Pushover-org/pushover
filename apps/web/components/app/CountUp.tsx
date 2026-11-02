"use client";
import NumberFlow from "@number-flow/react";
import { useEffect, useState } from "react";

/** A number that counts up from zero once on load: the tally "moving" on the demo screen. */
export function CountUp({ value, money = false, className }: { value: number; money?: boolean; className?: string }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), 250);
    return () => window.clearTimeout(t);
  }, [value]);
  return money ? (
    <NumberFlow value={v / 100} className={className} format={{ style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }} />
  ) : (
    <NumberFlow value={v} className={className} />
  );
}
