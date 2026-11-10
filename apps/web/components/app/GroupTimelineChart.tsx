"use client";
// The Bryntum Scheduler itself (plan item P24). Client only: GroupTimeline loads it with ssr: false.
import { BryntumScheduler } from "@bryntum/scheduler-react-enterprise";
import "@bryntum/core-enterprise/fontawesome/css/fontawesome.css";
import "@bryntum/core-enterprise/fontawesome/css/solid.css";
import "@bryntum/scheduler-enterprise/scheduler.css";
import "@bryntum/scheduler-enterprise/svalbard-light.css";
import { useRouter } from "next/navigation";
import type { TimelineData } from "./GroupTimeline.tsx";

const COLOR: Record<string, string> = { APPROVE: "#5c5a52", DENY: "#a3321f", REVIEW: "#845b00", NEED_MORE: "#2b4c8c" };
const WORD: Record<string, string> = { APPROVE: "approved by the rules", DENY: "denied", REVIEW: "with a person", NEED_MORE: "asked for more" };
const DAY = 86_400_000;
const LEGEND = Object.entries(WORD)
  .map(([k, w]) => `<span><i style="background:${COLOR[k] ?? ""}"></i>${w}</span>`)
  .join("");

export default function GroupTimelineChart({ data, licenseKey }: { data: TimelineData; licenseKey: string | null }) {
  const router = useRouter();
  // Bryntum reads the key from the global it creates; it may be set before or after the widget paints.
  if (licenseKey) (globalThis.bryntum ??= {} as typeof globalThis.bryntum).licenseKey = licenseKey;
  const times = data.events.map((e) => Date.parse(e.filedAt));
  const first = Math.min(...times);
  const last = Math.max(...times);
  const span = (last - first) / DAY;
  // On a phone the four columns would leave the time axis no width at all: one short column instead.
  const narrow = window.innerWidth < 720;
  const start = new Date(first - DAY);
  const end = new Date(last + Math.max(3, Math.round(span * 0.12)) * DAY);
  return (
    <BryntumScheduler
      autoHeight
      forceFit
      readOnly
      startDate={start}
      endDate={end}
      viewPreset={span <= 18 ? "dayAndWeek" : span <= 100 && !narrow ? "weekAndMonth" : "monthAndYear"}
      rowHeight={64}
      barMargin={10}
      eventLayout="stack"
      milestoneLayoutMode="estimate"
      milestoneTextPosition="always-outside"
      zoomOnMouseWheel={false}
      // The legend (static text, no claim data) also keeps the corner Bryntum's trial badge sits in clear of the rows.
      bbar={[{ type: "widget", cls: "poc-legend", html: LEGEND }]}
      columns={
        narrow
          ? [{ text: "Group", field: "short", width: 112 }]
          : [
              { text: "Group", field: "name", width: 120 },
              { text: "Claims", field: "size", width: 104, align: "end" },
              { text: "Status", field: "status", width: 90 },
              { text: "AI: coordinated", field: "probability", width: 160 },
            ]
      }
      resources={data.groups.map((g) => ({ id: g.id, name: `Group ${g.id}`, short: `${g.id} · ${g.status.toLowerCase()}`, size: g.size, status: g.status, probability: g.probability }))}
      events={data.events.map((e) => ({ id: e.claimId, resourceId: e.groupId, name: `#${e.seq}`, startDate: new Date(e.filedAt), duration: 0, eventColor: COLOR[e.outcome ?? ""] ?? "#8a877c" }))}
      eventTooltipFeature={{
        // Plain text nodes only: nothing from the claim is read as HTML.
        template: ({ eventRecord }: { eventRecord: { id: unknown } }) => {
          const e = data.events.find((x) => x.claimId === eventRecord.id);
          if (!e) return "";
          return {
            children: [
              { tag: "b", text: `Claim #${e.seq}` },
              { tag: "div", text: `Filed ${new Date(e.filedAt).toUTCString().slice(5, 22)} UTC` },
              { tag: "div", text: e.outcome ? `Decision: ${WORD[e.outcome] ?? e.outcome}` : "Not decided yet" },
            ],
          };
        },
      }}
      eventEditFeature={false}
      eventMenuFeature={false}
      scheduleMenuFeature={false}
      cellMenuFeature={false}
      headerMenuFeature={false}
      timeAxisHeaderMenuFeature={false}
      eventDragCreateFeature={false}
      scheduleTooltipFeature={false}
      onEventClick={({ eventRecord }) => router.push(`/admin/${data.settlementId}/claim/${String(eventRecord.id)}`)}
    />
  );
}
