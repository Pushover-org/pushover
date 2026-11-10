"use client";
import dynamic from "next/dynamic";

export interface TimelineData {
  settlementId: string;
  /** One row per linked group: held groups first, then by the investigator's coordination probability. */
  groups: { id: number; size: number; status: string; probability: string }[];
  /** Each claim in a group, at the moment it was filed. */
  events: {
    claimId: string;
    groupId: number;
    seq: number;
    filedAt: string;
    outcome: string | null;
  }[];
}

// Bryntum components run in the browser only, so the scheduler is never rendered on the server.
const Chart = dynamic(() => import("./GroupTimelineChart.tsx"), {
  ssr: false,
  loading: () => (
    <p style={{ padding: 24, color: "var(--ink-3)" }}>Loading the timeline…</p>
  ),
});

export function GroupTimeline(props: {
  data: TimelineData;
  licenseKey: string | null;
}) {
  return <Chart {...props} />;
}
