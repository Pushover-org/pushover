"use client";
import { AllCommunityModule, ModuleRegistry, type ColDef, type ICellRendererParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useMemo, useState } from "react";
import { dollars, REASON_SHORT } from "@/lib/labels.ts";
import type { Outcome } from "@/lib/pilot-shared.ts";
import type { ReportRow } from "@/lib/server/report.ts";
import { ledgerTheme } from "./grid-theme.ts";
import s from "./ClaimsGrid.module.css";
import { Stamp } from "./Stamp.tsx";

ModuleRegistry.registerModules([AllCommunityModule]);

const Decision = ({ value }: ICellRendererParams<ReportRow, string>) => <Stamp outcome={value === "PENDING" ? null : ((value ?? null) as Outcome | null)} />;

/** The public report: masked, sortable, searchable (spec §4.7). */
export function ReportGrid({ rows }: { rows: ReportRow[] }) {
  const [q, setQ] = useState("");
  const cols = useMemo<ColDef<ReportRow>[]>(
    () => [
      { headerName: "Claim", field: "claim", width: 120, cellClass: "num", sort: "asc" },
      { headerName: "Filed", field: "filed", width: 120, cellClass: "num" },
      { headerName: "Claimant", field: "claimant", width: 110 },
      { headerName: "State", field: "state", width: 90 },
      { headerName: "Tier", field: "tier", width: 120 },
      { headerName: "Decision", field: "decision", cellRenderer: Decision, width: 140 },
      { headerName: "Reason", field: "reason", flex: 1, minWidth: 240, valueFormatter: (p) => REASON_SHORT[p.value ?? ""] ?? p.value ?? "", tooltipField: "reasonText" },
      { headerName: "By", field: "decidedBy", width: 100, valueFormatter: (p) => (p.data?.decidedBy === "rules" && p.data.rule !== null ? `rule ${p.data.rule}` : (p.value ?? "")) },
      { headerName: "Amount", field: "amountCents", width: 110, type: "rightAligned", cellClass: "num", valueFormatter: (p) => (p.value == null ? "—" : dollars(p.value)) },
      { headerName: "Payout", field: "payout", width: 120 },
    ],
    [],
  );
  return (
    <div className={s.wrap}>
      <div className={s.toolbar}>
        <span />
        <label className={s.search}>
          <span className="sr-only">Search the report</span>
          <input type="search" placeholder="Search claim, state, reason…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      <div className={s.grid}>
        <AgGridReact<ReportRow> theme={ledgerTheme} rowData={rows} columnDefs={cols} defaultColDef={{ sortable: true, resizable: true }} quickFilterText={q} domLayout="autoHeight" rowHeight={46} tooltipShowDelay={300} />
      </div>
    </div>
  );
}
