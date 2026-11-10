import type { Outcome } from "@/lib/pilot-shared.ts";
import { OUTCOME_LABEL } from "@/lib/labels.ts";
import s from "./Stamp.module.css";

/** A decision as a rubber stamp in its state ink. */
export function Stamp({ outcome, size = "sm", label }: { outcome: Outcome | null; size?: "sm" | "lg"; label?: string }) {
  if (!outcome) return <span className={s.pending}>{label ?? "Pending"}</span>;
  return (
    <span className={s.stamp} data-o={outcome} data-size={size}>
      {label ?? OUTCOME_LABEL[outcome]}
    </span>
  );
}
