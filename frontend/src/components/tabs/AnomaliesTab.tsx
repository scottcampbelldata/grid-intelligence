"use client";

import { ErrorBanner } from "@/components/ErrorBanner";

import { useEffect } from "react";
import { DataTable, type Column } from "@/components/DataTable";
import { HBarChart, type HBarDatum } from "@/components/HBarChart";
import { KpiCard } from "@/components/KpiCard";
import { KpiRow } from "@/components/KpiRow";
import { Panel } from "@/components/Panel";
import { PanelState } from "@/components/PanelState";
import { getRecentAnomalies, type Anomaly } from "@/lib/api";
import { formatInt } from "@/lib/format";
import { STATUS } from "@/lib/status";
import type { TabMeta } from "@/lib/types";
import { usePolling } from "@/lib/useGridData";

const WINDOW_HOURS = 48;

// Severity → restrained semantic color (the one sanctioned color exception),
// sourced from the shared status palette. Critical → red, warn/high → amber,
// moderate/low → neutral.
function severityStyle(sev: string): { color: string; rank: number } {
  const s = sev.toLowerCase();
  if (s.includes("crit")) return { color: STATUS.critical, rank: 3 };
  if (s.includes("warn") || s.includes("high") || s.includes("sev"))
    return { color: STATUS.caution, rank: 2 };
  if (s.includes("mod")) return { color: STATUS.neutral, rank: 1 };
  return { color: STATUS.neutral, rank: 0 };
}

function isCritical(a: Anomaly) {
  return a.severity.toLowerCase().includes("crit");
}
function isWarn(a: Anomaly) {
  const s = a.severity.toLowerCase();
  return s.includes("warn") || s.includes("high") || s.includes("sev");
}

function fmtTime(d: Date | null): string {
  if (!d) return "-";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function gw(mwh: number | null, signed = false): string {
  if (mwh === null) return "-";
  const v = mwh / 1_000;
  return signed && v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2);
}

export function AnomaliesTab({ onMeta }: { onMeta: (m: TabMeta) => void }) {
  const { data, error, lastUpdated, refresh } = usePolling(
    (signal) => getRecentAnomalies(WINDOW_HOURS, signal),
    60_000,
  );
  useEffect(() => {
    onMeta({ lastUpdated, error });
  }, [lastUpdated, error, onMeta]);

  const loaded = lastUpdated !== null;
  const anomalies = data ?? [];
  const isEmpty = loaded && !error && anomalies.length === 0;

  const critical = anomalies.filter(isCritical).length;
  const warn = anomalies.filter(isWarn).length;
  const peak = anomalies.reduce<Anomaly | null>(
    (best, a) =>
      best === null || Math.abs(a.zScore ?? 0) > Math.abs(best.zScore ?? 0) ? a : best,
    null,
  );

  // Secondary: anomaly count by balancing authority.
  const byBa: HBarDatum[] = (() => {
    const counts = new Map<string, number>();
    for (const a of anomalies) counts.set(a.baCode, (counts.get(a.baCode) ?? 0) + 1);
    return [...counts.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  })();

  const columns: Column<Anomaly>[] = [
    {
      key: "period",
      header: "Period",
      align: "left",
      render: (r) => fmtTime(r.periodUtc),
      sortValue: (r) => r.periodUtc?.getTime() ?? 0,
    },
    { key: "ba", header: "BA", align: "left", render: (r) => r.baCode, sortValue: (r) => r.baCode },
    {
      key: "severity",
      header: "Severity",
      align: "left",
      render: (r) => {
        const { color } = severityStyle(r.severity);
        return (
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span style={{ color }} className="capitalize">
              {r.severity}
            </span>
          </span>
        );
      },
      sortValue: (r) => severityStyle(r.severity).rank,
    },
    {
      key: "actual",
      header: "Actual (GW)",
      align: "right",
      cellClassName: "font-mono tabular-nums text-text",
      render: (r) => gw(r.actualMwh),
      sortValue: (r) => r.actualMwh ?? 0,
    },
    {
      key: "expected",
      header: "Expected (GW)",
      align: "right",
      cellClassName: "font-mono tabular-nums text-muted",
      render: (r) => gw(r.expectedMwh),
      sortValue: (r) => r.expectedMwh ?? 0,
    },
    {
      key: "residual",
      header: "Residual (GW)",
      align: "right",
      cellClassName: "font-mono tabular-nums text-text",
      render: (r) => gw(r.residualMwh, true),
      sortValue: (r) => r.residualMwh ?? 0,
    },
    {
      key: "z",
      header: "z-score",
      align: "right",
      cellClassName: "font-mono tabular-nums text-text",
      render: (r) => (r.zScore != null ? r.zScore.toFixed(2) : "-"),
      sortValue: (r) => Math.abs(r.zScore ?? 0),
    },
  ];

  return (
    <>
      {error && <ErrorBanner error={error} onRetry={refresh} />}

      <KpiRow>
        <KpiCard
          label="Anomalies, 48h"
          value={loaded ? formatInt(anomalies.length) : "-"}
          sub="Detected via diurnal z-score"
          loading={!loaded && !error}
        />
        <KpiCard
          label="Critical"
          value={loaded ? formatInt(critical) : "-"}
          sub="Severity critical"
          loading={!loaded && !error}
        />
        <KpiCard
          label="Warn"
          value={loaded ? formatInt(warn) : "-"}
          sub="Severity warn / high"
          loading={!loaded && !error}
        />
        <KpiCard
          label="Peak z-score"
          value={peak?.zScore != null ? Math.abs(peak.zScore).toFixed(1) : "-"}
          sub={peak ? `${peak.baCode} · ${fmtTime(peak.periodUtc)}` : ""}
          loading={!loaded && !error}
        />
      </KpiRow>

      {isEmpty ? (
        <div className="mt-6">
          <Panel title="Demand anomalies, last 48 hours">
            <PanelState
              loading={false}
              minHeight={240}
              empty="No anomalies detected in the last 48 hours."
            />
          </Panel>
        </div>
      ) : (
        <>
          <div className="mt-6">
            <Panel
              title="Demand anomalies, last 48 hours"
              right={
                <span>
                  {formatInt(anomalies.length)} anomalies · {formatInt(critical)} critical ·{" "}
                  {formatInt(warn)} warn
                </span>
              }
            >
              {anomalies.length > 0 ? (
                <DataTable
                  columns={columns}
                  rows={anomalies}
                  rowKey={(r, i) => `${r.baCode}-${r.periodUtc?.getTime() ?? i}`}
                />
              ) : (
                <PanelState
                  loading={!loaded && !error}
                  error={error}
                  onRetry={refresh}
                  minHeight={200}
                  variant="table"
                  empty="No anomalies to list."
                />
              )}
            </Panel>
          </div>

          {byBa.length > 0 && (
            <div className="mt-6">
              <Panel title="Anomalies by balancing authority, last 48 hours" right={<span>Count</span>}>
                <HBarChart data={byBa} maxBars={12} decimals={0} labelWidth={72} />
              </Panel>
            </div>
          )}
        </>
      )}
    </>
  );
}
