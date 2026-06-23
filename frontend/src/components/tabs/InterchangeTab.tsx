"use client";

import { useEffect } from "react";
import { DataTable, type Column } from "@/components/DataTable";
import { HBarChart, type HBarDatum } from "@/components/HBarChart";
import { KpiCard } from "@/components/KpiCard";
import { KpiRow } from "@/components/KpiRow";
import { Panel } from "@/components/Panel";
import { getInterchange, type InterchangeFlow } from "@/lib/api";
import { formatInt } from "@/lib/format";
import type { TabMeta } from "@/lib/types";
import { usePolling } from "@/lib/useGridData";

interface PairFlow {
  label: string; // directed "A → B", oriented by the net sign
  gw: number; // magnitude of the net flow
}

// EIA reports each physical link from both BAs' perspectives, so every pair
// arrives as two near-mirror rows (e.g. SRP→AZPS at 162.09 and AZPS→SRP whose
// flip is also SRP→AZPS at 149.27). Collapse each unordered {A,B} pair into one
// entry: accumulate both perspectives in a canonical lo→hi direction, average
// them, then orient the arrow by the sign of that net. One entry per physical
// pair - the detail table below still shows every directed row.
function dedupePairs(flows: InterchangeFlow[]): PairFlow[] {
  const groups = new Map<string, { lo: string; hi: string; sum: number; n: number }>();
  for (const f of flows) {
    const [lo, hi] = f.fromBa < f.toBa ? [f.fromBa, f.toBa] : [f.toBa, f.fromBa];
    const signed = f.fromBa === lo ? f.netMw : -f.netMw; // express in lo→hi terms
    const key = `${lo}|${hi}`;
    const g = groups.get(key) ?? { lo, hi, sum: 0, n: 0 };
    g.sum += signed;
    g.n += 1;
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => {
      const net = g.sum / g.n; // average the mirror perspectives
      return {
        label: net >= 0 ? `${g.lo} → ${g.hi}` : `${g.hi} → ${g.lo}`,
        gw: Math.abs(net) / 1_000,
      };
    })
    .sort((a, b) => b.gw - a.gw);
}

// EIA publishes interchange with a ~29h lag, so a 24h window is always empty.
// Use a 3-day window so the tab shows the most recent *published* flows.
const WINDOW_HOURS = 72;

export function InterchangeTab({ onMeta }: { onMeta: (m: TabMeta) => void }) {
  const { data, error, lastUpdated, refresh } = usePolling(
    (signal) => getInterchange(WINDOW_HOURS, signal),
    60_000,
  );
  useEffect(() => {
    onMeta({ lastUpdated, error });
  }, [lastUpdated, error, onMeta]);

  const loaded = lastUpdated !== null;
  const flows = data ?? [];
  const isEmpty = loaded && !error && flows.length === 0;

  // One bar per physical pair (both EIA perspectives collapsed), largest first.
  const pairs = dedupePairs(flows);
  const bars: HBarDatum[] = pairs.slice(0, 10).map((p) => ({ label: p.label, value: p.gw }));

  const largest = pairs[0] ?? null;
  const totalGw = flows.reduce((s, f) => s + Math.abs(f.netMw), 0) / 1_000;
  const distinctBas = new Set(flows.flatMap((f) => [f.fromBa, f.toBa])).size;

  const columns: Column<InterchangeFlow>[] = [
    { key: "from", header: "From", align: "left", render: (r) => r.fromBa },
    { key: "to", header: "To", align: "left", render: (r) => r.toBa },
    {
      key: "net",
      header: "Net flow (GW)",
      align: "right",
      cellClassName: "font-mono tabular-nums text-text",
      render: (r) => (r.netMw / 1_000).toFixed(2),
    },
    {
      key: "obs",
      header: "Observations",
      align: "right",
      cellClassName: "font-mono tabular-nums text-muted",
      render: (r) => formatInt(r.nObs),
    },
  ];

  return (
    <>
      {error && (
        <div className="mb-6 flex items-center justify-between gap-4 rounded-md border border-border bg-surface px-5 py-3 text-sm">
          <span className="text-muted">Couldn&apos;t reach the API - {error}</span>
          <button
            type="button"
            onClick={refresh}
            className="text-accent transition-opacity hover:opacity-80"
          >
            Retry
          </button>
        </div>
      )}

      <KpiRow>
        <KpiCard
          label="Active flows"
          value={loaded && !isEmpty ? formatInt(flows.length) : "-"}
          sub={isEmpty ? "No recent data" : "BA-to-BA pairs"}
          loading={!loaded}
        />
        <KpiCard
          label="Largest flow"
          value={largest ? largest.gw.toFixed(1) : "-"}
          unit={largest ? "GW" : undefined}
          sub={largest ? largest.label : isEmpty ? "No recent data" : ""}
          loading={!loaded}
        />
        <KpiCard
          label="Total interchange"
          value={loaded && !isEmpty ? totalGw.toFixed(1) : "-"}
          unit={loaded && !isEmpty ? "GW" : undefined}
          sub="Sum of absolute flows"
          loading={!loaded}
        />
        <KpiCard
          label="Authorities involved"
          value={loaded && !isEmpty ? formatInt(distinctBas) : "-"}
          sub="Distinct BAs"
          loading={!loaded}
        />
      </KpiRow>

      {isEmpty ? (
        <div className="mt-6">
          <Panel title="Interchange flows, last 3 days">
            <div className="flex h-[280px] flex-col items-center justify-center gap-2 text-center">
              <span className="text-sm text-text">No recent interchange data</span>
              <span className="max-w-sm text-xs text-muted">
                EIA publishes interchange with roughly a 29-hour lag. Even across
                the last 3 days nothing has been released yet - this will populate
                once EIA publishes the data.
              </span>
            </div>
          </Panel>
        </div>
      ) : (
        <>
          <div className="mt-6">
            <Panel
              title="Largest interchange flows, last 3 days"
              right={<span>Net GW · direction of arrow</span>}
            >
              {bars.length > 0 ? (
                <HBarChart data={bars} maxBars={10} decimals={2} unit="GW" labelWidth={120} />
              ) : (
                <div className="flex h-[280px] items-center justify-center text-sm text-muted">
                  Loading…
                </div>
              )}
            </Panel>
          </div>

          <div className="mt-6">
            <Panel title="All flows, last 3 days" right={<span>{formatInt(flows.length)} pairs</span>}>
              {flows.length > 0 ? (
                <DataTable
                  columns={columns}
                  rows={flows}
                  rowKey={(r) => `${r.fromBa}->${r.toBa}`}
                />
              ) : (
                <div className="flex h-[200px] items-center justify-center text-sm text-muted">
                  Loading…
                </div>
              )}
            </Panel>
          </div>
        </>
      )}
    </>
  );
}
