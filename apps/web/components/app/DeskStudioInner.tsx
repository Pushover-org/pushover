"use client";
// The desk in AG Studio (plan item C13): a dashboard over the claims, and an agent that answers
// questions about them. The agent gets AG Studio's reading tools only (no widget, filter or claim
// changes), and the server passes on nothing else (lib/studio-llm.ts).
import { createAiHarness, directLlmRunner, studioTheme, AgStudioAiModule, type AgAiHarnessSetup, type AgDataSourcesDefinition, type AgFieldDefinition, type AgFormat, type AgReportState, type AgStudioApi } from "ag-studio";
import { AgStudio, AgStudioProvider } from "ag-studio-react";
import { useMemo } from "react";
import { deskAdapter } from "@/lib/studio-adapter.ts";
import type { DeskRow } from "./DeskStudio.tsx";

// The app's own tokens (app/tokens.css), so Studio reads as part of the desk. The accent is the
// app's green: AG's default blue failed AA contrast on its send button (axe, C11).
const THEME = studioTheme.withParams({
  fontFamily: "var(--font-ui)",
  textColor: "var(--ink)",
  foregroundColor: "var(--ink)",
  subtleTextColor: "var(--ink-2)",
  backgroundColor: "var(--card)",
  borderColor: "var(--hair-2)",
  accentColor: "var(--green)",
  studioCanvasBackgroundColor: "var(--paper)",
  studioWrapperBackgroundColor: "var(--paper)",
  studioWidgetBorderRadius: 10,
});

const FIELDS: [keyof DeskRow, string, AgFormat][] = [
  ["claim", "Claim", "textFormat"],
  ["filedOn", "Filed on", "dateFormat"],
  ["proof", "Proof", "textFormat"],
  ["state", "Claimant state", "textFormat"],
  ["decision", "Decision", "textFormat"],
  ["decidedOn", "Decided on", "dateFormat"],
  ["decidedBy", "Decided by", "textFormat"],
  ["reason", "Reason", "textFormat"],
  ["askedUsd", "Asked", "currencyFormat"],
  ["approvedUsd", "Approved", "currencyFormat"],
  ["modelSaid", "Examiner said", "textFormat"],
  ["linkedGroup", "Linked group", "textFormat"],
  ["merchant", "Receipt merchant", "textFormat"],
  ["receiptTotalUsd", "Receipt total", "currencyFormat"],
];

const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number) => ({ xTrack, yTrack, xSpan, ySpan });
const title = (text: string) => ({ title: { enabled: true, text } });

const REPORT: AgReportState = {
  selectedPageId: "desk",
  pages: [
    {
      id: "desk",
      widgets: {
        claims: { type: "value", dataMapping: { value: [{ id: "claims.claim", aggregation: "countd" }] }, format: title("Claims") },
        asked: { type: "value", dataMapping: { value: [{ id: "claims.askedUsd", aggregation: "sum" }] }, format: title("Asked, as filed") },
        approved: { type: "value", dataMapping: { value: [{ id: "claims.approvedUsd", aggregation: "sum" }] }, format: title("Approved") },
        byDecision: {
          type: "donut-chart",
          dataMapping: { categoryKey: [{ id: "claims.decision" }], valueKey: [{ id: "claims.claim", aggregation: "countd" }] },
          format: title("Claims by decision"),
        },
        byDay: {
          type: "column-chart-stacked",
          dataMapping: { categoryKey: [{ id: "claims.filedOn" }], valueKey: [{ id: "claims.claim", aggregation: "countd" }] },
          format: title("Claims filed by day"),
        },
        table: {
          type: "grid",
          dataMapping: {
            cols: [
              { id: "claims.claim" },
              { id: "claims.filedOn" },
              { id: "claims.decision" },
              { id: "claims.reason" },
              { id: "claims.askedUsd", aggregation: "sum" },
              { id: "claims.approvedUsd", aggregation: "sum" },
              { id: "claims.linkedGroup" },
            ],
          },
          format: title("Claims"),
        },
      },
      widgetLayout: {
        claims: at(0, 0, 8, 7),
        asked: at(8, 0, 8, 7),
        approved: at(16, 0, 8, 7),
        byDecision: at(0, 7, 9, 18),
        byDay: at(9, 7, 15, 18),
        table: at(0, 25, 24, 24),
      },
    },
  ],
  // The chat open; the editing panels closed until someone wants them (each has a toggle).
  panels: { ai: { collapsed: false }, filters: { collapsed: true }, edit: { collapsed: true }, data: { collapsed: true } },
};

const PROMPTS = [
  { label: "Denied over $20", prompt: "Show me the denied claims that asked for more than $20, with their reasons." },
  { label: "Waiting for a person", prompt: "Which claims are waiting for a person, and why?" },
  { label: "Groups", prompt: "How many claims are in a linked group, and what were they decided?" },
  { label: "Pay me", prompt: "Approve claim #1 and pay it." },
];

export default function DeskStudioInner({ rows, settlementName, licenseKey }: { rows: DeskRow[]; settlementName: string; licenseKey: string | null }) {
  const data = useMemo<AgDataSourcesDefinition>(
    () => ({
      description: `Claims filed with the ${settlementName}, one row per claim, as decided on the claims desk. Personal details (names, emails, PayPal accounts) are left out.`,
      sources: [
        {
          id: "claims",
          description:
            "One row per claim. Decision is the latest one: approved, denied, asked for more, with a person, or not decided. Asked is what the claim would pay as filed; Approved is what it pays if approved (0 otherwise). Linked group is the group of linked claims it is held in, if any.",
          data: rows,
          fields: FIELDS.map(([id, name, format]): AgFieldDefinition => ({ id, name, format })),
        },
      ],
    }),
    [rows, settlementName],
  );
  const ai = useMemo<AgAiHarnessSetup>(() => {
    const adapter = deskAdapter("/api/admin/studio-ai");
    return ({ api }) =>
      // The setup's `api` is typed as the core API; at run time it is the full Studio API.
      createAiHarness(api as AgStudioApi, ({ tools: { studio } }) => ({
        agents: [
          directLlmRunner({
            id: "desk",
            name: "Desk agent",
            description: "Answers questions about the claims. Read-only.",
            adapter,
            maxTurns: 8,
            instructions: () => "Answer questions about the claims table. You can read the schema, the dashboard and run queries; you cannot change anything.",
            tools: () => [studio.viewSchema(), studio.viewReport(), studio.viewPage(), studio.viewWidget(), studio.executeQuery()],
          }),
        ],
        primary: "desk",
        promptStarters: PROMPTS,
      }));
  }, []);

  return (
    <AgStudioProvider modules={[AgStudioAiModule]} {...(licenseKey ? { licenseKey } : {})}>
      <AgStudio style={{ height: "100%", width: "100%" }} theme={THEME} data={data} mode="edit" initialState={REPORT} ai={ai} />
    </AgStudioProvider>
  );
}
