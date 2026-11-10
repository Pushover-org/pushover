"use client";
// The claims queue (spec §4.7): AG Grid with custom cell renderers for the evidence thumbnail,
// the decision stamp, failed checks, and where the examiner's logged recommendation lost to the rules.
import { AllCommunityModule, ModuleRegistry, type ColDef, type GridApi, type ICellRendererParams, type RowClickedEvent } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { dollars, GROUP_LABEL, OUTCOME_LABEL, REASON_SHORT } from "@/lib/labels.ts";
import type { Outcome } from "@/lib/pilot-shared.ts";
import { ledgerTheme } from "./grid-theme.ts";
import s from "./ClaimsGrid.module.css";
import { Stamp } from "./Stamp.tsx";

ModuleRegistry.registerModules([AllCommunityModule]);

export interface GridRow {
  id: string;
  seq: number;
  tier: "proof" | "no_proof";
  name: string;
  state: string;
  outcome: Outcome | null;
  reason: string | null;
  entitlementCents: number | null;
  asFiledCents: number;
  hasEvidence: boolean;
  failed: string[];
  unknown: string[];
  modelSaid: "approve" | "deny" | null;
  cluster: number | null;
  decidedBy: string | null;
  label: string | null;
  truth: "honest" | "fraud" | "ineligible" | null;
  paypalVerified: boolean | null;
  /** The PayPal account's pseudonym, first 10 hex: never the payer ID. */
  paypal: string | null;
  /** Waiting for a person's decision (status REVIEW): the rules' hold, or an appealed denial. */
  waiting: boolean;
  /** The claimant appealed and no person has decided since (plan item P9). */
  appealed: boolean;
  /** The linked group this claim is in, if any (plan items P20, P26). */
  group: { id: number; size: number; status: "HELD" | "CLEARED" | "DENIED"; href: string } | null;
}

type P<K extends keyof GridRow> = ICellRendererParams<GridRow, GridRow[K]>;

const Evidence = ({ data }: ICellRendererParams<GridRow>) =>
  data?.hasEvidence ? (
    // A small proxy of the photo; the full one opens on the claim page.
    <img className={s.thumb} src={`/api/evidence/${data.id}`} alt="" loading="lazy" />
  ) : (
    <span className={s.noThumb} title="Filed without a receipt">
      no receipt
    </span>
  );

const Claim = ({ data }: ICellRendererParams<GridRow>) => (
  <span className={s.claim}>
    <b className="num">{data?.id}</b>
    <small>
      {data?.name} · {data?.state}
      {data?.paypal ? ` · PayPal ${data.paypal}…${data.paypalVerified ? "" : " (unverified)"}` : ""}
    </small>
  </span>
);

const Decision = ({ value, data }: P<"outcome">) => (
  <span className={s.decision}>
    <Stamp outcome={value ?? null} />
    {data?.appealed ? <span className={s.appealed}>Appealed</span> : null}
  </span>
);

const Reason = ({ data }: ICellRendererParams<GridRow>) => (
  <span className={s.reason}>
    {REASON_SHORT[data?.reason ?? ""] ?? data?.reason ?? "—"}
    {data?.decidedBy?.startsWith("analyst:") ? <small>by a person</small> : null}
  </span>
);

const Checks = ({ data }: ICellRendererParams<GridRow>) => (
  <span className={s.checks}>
    {data?.failed.map((c) => (
      <span key={c} className={s.fail} title={`${c} failed`}>
        {c}
      </span>
    ))}
    {data?.unknown.slice(0, Math.max(0, 3 - data.failed.length)).map((c) => (
      <span key={c} className={s.unknown} title={`${c} couldn't tell`}>
        {c}?
      </span>
    ))}
    {data && data.failed.length + data.unknown.length > 3 && data.unknown.length > Math.max(0, 3 - data.failed.length) ? (
      <span className={s.dim}>+{data.unknown.length - Math.max(0, 3 - data.failed.length)}</span>
    ) : null}
    {data && data.failed.length + data.unknown.length === 0 ? <span className={s.allPass}>all pass</span> : null}
  </span>
);

const ModelVsRules = ({ data }: ICellRendererParams<GridRow>) => {
  if (!data?.modelSaid) return <span className={s.dim}>—</span>;
  const disagree = (data.modelSaid === "approve") !== (data.outcome === "APPROVE");
  return (
    <span className={s.vs} data-disagree={disagree}>
      model: {data.modelSaid}
      {disagree ? <b>rules won</b> : null}
    </span>
  );
};

const Amount = ({ data }: ICellRendererParams<GridRow>) => (
  <span className={s.amount}>
    {data?.outcome === "APPROVE" ? <b className="num">{dollars(data.entitlementCents)}</b> : <s className="num">{dollars(data?.asFiledCents)}</s>}
  </span>
);

const Label = ({ data }: ICellRendererParams<GridRow>) =>
  data?.label ? (
    <span className={s.label} data-truth={data.truth}>
      {GROUP_LABEL[data.label] ?? data.label}
    </span>
  ) : (
    <span className={s.dim}>live claim</span>
  );

const Group = ({ data }: ICellRendererParams<GridRow>) =>
  data?.group ? (
    <a className={s.groupLink} data-s={data.group.status} href={data.group.href} onClick={(e) => e.stopPropagation()}>
      Group {data.group.id} · {data.group.status === "HELD" ? "held" : data.group.status.toLowerCase()} ({data.group.size})
    </a>
  ) : (
    <span className={s.dim}>—</span>
  );

const FILTERS: { key: string; label: string; test: (r: GridRow) => boolean }[] = [
  { key: "ALL", label: "All claims", test: () => true },
  { key: "REVIEW", label: "Review queue", test: (r) => r.waiting },
  { key: "APPEALED", label: "Appealed", test: (r) => r.appealed },
  { key: "APPROVE", label: OUTCOME_LABEL.APPROVE, test: (r) => r.outcome === "APPROVE" },
  { key: "DENY", label: OUTCOME_LABEL.DENY, test: (r) => r.outcome === "DENY" },
  { key: "NEED_MORE", label: OUTCOME_LABEL.NEED_MORE, test: (r) => r.outcome === "NEED_MORE" },
  { key: "GROUPED", label: "In a linked group", test: (r) => r.group !== null },
  { key: "DISAGREE", label: "Model said ≠ rules said", test: (r) => r.modelSaid !== null && (r.modelSaid === "approve") !== (r.outcome === "APPROVE") },
];

export function ClaimsGrid({ rows, settlementId, initial }: { rows: GridRow[]; settlementId: string; initial: string }) {
  const router = useRouter();
  const api = useRef<GridApi<GridRow> | null>(null);
  const [filter, setFilter] = useState(FILTERS.some((f) => f.key === initial) ? initial : "ALL");
  const [search, setSearch] = useState("");
  const shown = useMemo(() => rows.filter(FILTERS.find((f) => f.key === filter)?.test ?? (() => true)), [rows, filter]);

  const cols = useMemo<ColDef<GridRow>[]>(
    () => [
      { headerName: "Evidence", cellRenderer: Evidence, width: 96, sortable: false, filter: false },
      { headerName: "Claim", field: "seq", cellRenderer: Claim, width: 210, sort: "asc", getQuickFilterText: (p) => `${p.data?.id} ${p.data?.name} ${p.data?.state}` },
      { headerName: "Decision", field: "outcome", cellRenderer: Decision, width: 140 },
      { headerName: "Why", field: "reason", cellRenderer: Reason, flex: 1, minWidth: 220, getQuickFilterText: (p) => REASON_SHORT[p.value ?? ""] ?? "" },
      { headerName: "Checks", cellRenderer: Checks, width: 190, sortable: false, comparator: (_a, _b, x, y) => (x.data?.failed.length ?? 0) - (y.data?.failed.length ?? 0) },
      { headerName: "Model said", field: "modelSaid", cellRenderer: ModelVsRules, width: 160 },
      { headerName: "Cluster", field: "cluster", width: 100, type: "rightAligned", valueFormatter: (p) => (p.value && p.value > 1 ? `of ${p.value}` : "—"), cellClass: "num" },
      { headerName: "Amount", field: "entitlementCents", cellRenderer: Amount, width: 120, type: "rightAligned" },
      { headerName: "Linked group", colId: "linked", valueGetter: (p) => (p.data?.group ? `Group ${p.data.group.id} (${p.data.group.status.toLowerCase()})` : ""), cellRenderer: Group, width: 190 },
      { headerName: "Label (ground truth)", field: "label", cellRenderer: Label, width: 220, getQuickFilterText: (p) => GROUP_LABEL[p.value ?? ""] ?? "" },
    ],
    [],
  );

  return (
    <div className={s.wrap}>
      <div className={s.toolbar}>
        <div className={s.filters} role="tablist" aria-label="Filter claims">
          {FILTERS.map((f) => {
            const n = rows.filter(f.test).length;
            return (
              <button key={f.key} role="tab" aria-selected={filter === f.key} className={s.filter} onClick={() => setFilter(f.key)}>
                {f.label} <span className="num">{n}</span>
              </button>
            );
          })}
        </div>
        <span className={s.tools}>
          <label className={s.search}>
            <span className="sr-only">Search claims</span>
            <input type="search" placeholder="Search claim, name, reason…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <button
            className="pill pill--quiet"
            onClick={() =>
              api.current?.exportDataAsCsv({
                fileName: `${settlementId}-claims.csv`,
                columnKeys: ["seq", "outcome", "reason", "modelSaid", "cluster", "entitlementCents", "linked", "label"],
                processCellCallback: (p) => {
                  const d = p.node?.data;
                  if (!d) return String(p.value ?? "");
                  switch (p.column.getColId()) {
                    case "seq": return d.id;
                    case "entitlementCents": return d.outcome === "APPROVE" && d.entitlementCents !== null ? (d.entitlementCents / 100).toFixed(2) : "";
                    case "label": return d.label ? GROUP_LABEL[d.label] ?? d.label : "";
                    default: return String(p.value ?? "");
                  }
                },
              })
            }
          >
            Export CSV
          </button>
        </span>
      </div>
      <div className={s.grid}>
        <AgGridReact<GridRow>
          theme={ledgerTheme}
          rowData={shown}
          columnDefs={cols}
          defaultColDef={{ sortable: true, resizable: true, suppressMovable: true }}
          quickFilterText={search}
          getRowId={(p) => p.data.id}
          onGridReady={(e) => (api.current = e.api)}
          onRowClicked={(e: RowClickedEvent<GridRow>) => e.data && router.push(`/admin/${settlementId}/claim/${e.data.id}`)}
          rowClass={s.row ?? ""}
          animateRows
          domLayout="autoHeight"
          overlayNoRowsTemplate="<span>No claims match this view.</span>"
        />
      </div>
    </div>
  );
}
