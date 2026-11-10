"use client";
import dynamic from "next/dynamic";

/** One claim as the desk agent sees it: decisions and amounts, no names, emails or PayPal IDs. */
export interface DeskRow {
  claim: string;
  filedOn: string;
  proof: string;
  state: string;
  decision: string;
  decidedOn: string | null;
  decidedBy: string;
  reason: string;
  askedUsd: number;
  approvedUsd: number;
  modelSaid: string;
  linkedGroup: string;
  merchant: string;
  receiptTotalUsd: number | null;
}

// AG Studio runs in the browser only.
const Studio = dynamic(() => import("./DeskStudioInner.tsx"), {
  ssr: false,
  loading: () => <p style={{ padding: 24, color: "var(--ink-3)" }}>Loading AG Studio…</p>,
});

export function DeskStudio(props: { rows: DeskRow[]; settlementName: string; licenseKey: string | null }) {
  return <Studio {...props} />;
}
