"use client";
import { AllCommunityModule, ModuleRegistry, type ColDef, type ICellRendererParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useMemo } from "react";
import { dollars } from "@/lib/labels.ts";
import type { PayoutRow } from "@/lib/server/money.ts";
import { ledgerTheme } from "./grid-theme.ts";
import s from "./ClaimsGrid.module.css";

ModuleRegistry.registerModules([AllCommunityModule]);

const PILL: Record<string, string> = { PAID: "ok", UNCLAIMED: "wait", IN_FLIGHT: "wait", PLANNED: "wait", RETURNED: "bad", FAILED: "bad", UNVERIFIED: "bad" };

const Status = ({ data }: ICellRendererParams<PayoutRow>) => (
  <span className={s.payPill} data-s={PILL[data?.outcome ?? ""] ?? "wait"} title={data?.error ?? undefined}>
    {data?.outcome === "PLANNED" ? "not read yet" : (data?.paypalStatus ?? data?.outcome)}
  </span>
);

/** Payout items with the status PayPal reported for each (spec §4.7 payout-status pill). */
export function PayoutGrid({ rows }: { rows: PayoutRow[] }) {
  const cols = useMemo<ColDef<PayoutRow>[]>(
    () => [
      { headerName: "Claim", field: "claimId", width: 120, cellClass: "num" },
      { headerName: "Claimant", field: "name", flex: 1, minWidth: 160 },
      { headerName: "Paid to", valueGetter: (p) => (p.data?.recipientType === "PAYPAL_ID" ? "PayPal account (logged in)" : "Email on the claim"), width: 220 },
      { headerName: "Amount", field: "cents", width: 110, type: "rightAligned", valueFormatter: (p) => dollars(p.value), cellClass: "num" },
      { headerName: "PayPal status", field: "outcome", cellRenderer: Status, width: 170 },
      {
        headerName: "PayPal history", field: "historyStatus", width: 170,
        valueFormatter: (p) => (p.value === "CONFIRMED" ? `confirmed ${p.data?.historyCode ?? ""}` : p.value === "WAITING" ? "waiting for history" : p.value === "NEVER_CAUGHT_UP" ? "never caught up" : "not checked"),
        tooltipValueGetter: () => "Whether this payout shows in PayPal's own transaction history (Transaction Search). The history runs hours behind.",
      },
      { headerName: "Fee", field: "feeCents", width: 90, type: "rightAligned", valueFormatter: (p) => (p.value == null ? "—" : dollars(p.value)), cellClass: "num" },
      { headerName: "Payout item", field: "paypalItemId", width: 170, cellClass: "num", valueFormatter: (p) => p.value ?? "—" },
      { headerName: "Batch", field: "paypalBatchId", width: 170, cellClass: "num", valueFormatter: (p) => p.value ?? "—" },
      { headerName: "Error", field: "error", width: 210, valueFormatter: (p) => p.value ?? "" },
    ],
    [],
  );
  return (
    <div className={s.grid}>
      <AgGridReact<PayoutRow> theme={ledgerTheme} rowData={rows} columnDefs={cols} defaultColDef={{ sortable: true, resizable: true }} domLayout="autoHeight" rowHeight={46} />
    </div>
  );
}
