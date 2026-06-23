"use client";

import { useEffect } from "react";
import { DataTable, type Column } from "@/components/DataTable";
import { KpiCard } from "@/components/KpiCard";
import { KpiRow } from "@/components/KpiRow";
import { Panel } from "@/components/Panel";
import {
  getFreshness,
  getIngestRuns,
  type IngestRun,
  type SourceFreshness,
  type SourceStatus,
} from "@/lib/api";
import { agoFromSeconds, formatInt } from "@/lib/format";
import type { TabMeta } from "@/lib/types";
import { usePolling } from "@/lib/useGridData";

const STATUS_COLOR: Record<SourceStatus, string> = {
  ok: "#5ea88a", // muted green
  stale: "#c9a45c", // muted gold
  error: "#d08a8a", // muted red
};
const STATUS_RANK: Record<SourceStatus, number> = { error: 2, stale: 1, ok: 0 };

function StatusDot({ status }: { status: SourceStatus }) {
  const color = STATUS_COLOR[status];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      <span style={{ color }} className="capitalize">
        {status}
      </span>
    </span>
  );
}

function runColor(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("err") || s.includes("fail")) return "#d08a8a";
  if (s.includes("ok") || s.includes("success") || s.includes("complete")) return "#5ea88a";
  return "#8b919e";
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

interface OpsData {
  freshness: SourceFreshness[];
  runs: IngestRun[];
}

export function OperationsTab({ onMeta }: { onMeta: (m: TabMeta) => void }) {
  const { data, error, lastUpdated, refresh } = usePolling<OpsData>(
    (signal) =>
      Promise.all([getFreshness(signal), getIngestRuns(20, signal)]).then(
        ([freshness, runs]) => ({ freshness, runs }),
      ),
    60_000,
  );
  useEffect(() => {
    onMeta({ lastUpdated, error });
  }, [lastUpdated, error, onMeta]);

  const loaded = lastUpdated !== null;
  const freshness = data?.freshness ?? [];
  const runs = data?.runs ?? [];

  const healthy = freshness.filter((f) => f.status === "ok").length;
  const issues = freshness.filter((f) => f.status !== "ok").length;
  const mostStale = freshness.reduce<SourceFreshness | null>(
    (b, f) =>
      b === null || (f.secSinceFetch ?? -Infinity) > (b.secSinceFetch ?? -Infinity) ? f : b,
    null,
  );

  const freshnessCols: Column<SourceFreshness>[] = [
    { key: "source", header: "Source", align: "left", render: (r) => r.source, sortValue: (r) => r.source },
    {
      key: "status",
      header: "Status",
      align: "left",
      render: (r) => <StatusDot status={r.status} />,
      sortValue: (r) => STATUS_RANK[r.status],
    },
    {
      key: "fetch",
      header: "Last fetch",
      align: "right",
      cellClassName: "text-muted",
      render: (r) => agoFromSeconds(r.secSinceFetch),
      sortValue: (r) => r.secSinceFetch ?? Infinity,
    },
    {
      key: "data",
      header: "Last data",
      align: "right",
      cellClassName: "text-muted",
      render: (r) => agoFromSeconds(r.secSincePeriod),
      sortValue: (r) => r.secSincePeriod ?? Infinity,
    },
    {
      key: "rows",
      header: "Rows",
      align: "right",
      cellClassName: "font-mono tabular-nums text-text",
      render: (r) => (r.lastRows != null ? formatInt(r.lastRows) : "-"),
      sortValue: (r) => r.lastRows ?? 0,
    },
    {
      key: "msg",
      header: "Message",
      align: "left",
      cellClassName: "text-muted",
      render: (r) => r.lastError?.trim() || "-",
    },
  ];

  const runCols: Column<IngestRun>[] = [
    { key: "source", header: "Source", align: "left", render: (r) => r.source, sortValue: (r) => r.source },
    {
      key: "started",
      header: "Started",
      align: "left",
      cellClassName: "text-muted",
      render: (r) => fmtTime(r.startedAt),
      sortValue: (r) => r.startedAt?.getTime() ?? 0,
    },
    {
      key: "status",
      header: "Status",
      align: "left",
      render: (r) => (
        <span style={{ color: runColor(r.status) }} className="capitalize">
          {r.status}
        </span>
      ),
      sortValue: (r) => r.status,
    },
    {
      key: "rows",
      header: "Rows written",
      align: "right",
      cellClassName: "font-mono tabular-nums text-text",
      render: (r) => (r.rowsWritten != null ? formatInt(r.rowsWritten) : "-"),
      sortValue: (r) => r.rowsWritten ?? 0,
    },
    {
      key: "msg",
      header: "Message",
      align: "left",
      cellClassName: "text-muted",
      render: (r) => r.errorMessage?.trim() || "-",
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
          label="Sources"
          value={loaded ? formatInt(freshness.length) : "-"}
          sub="Ingestion sources"
          loading={!loaded}
        />
        <KpiCard
          label="Healthy"
          value={loaded ? formatInt(healthy) : "-"}
          sub="Fetched within 3h, no error"
          loading={!loaded}
        />
        <KpiCard
          label="Issues"
          value={loaded ? formatInt(issues) : "-"}
          sub="Stale or errored"
          loading={!loaded}
        />
        <KpiCard
          label="Most stale"
          value={loaded && mostStale ? agoFromSeconds(mostStale.secSinceFetch).replace(" ago", "") : "-"}
          sub={mostStale ? mostStale.source : ""}
          loading={!loaded}
        />
      </KpiRow>

      <div className="mt-6">
        <Panel
          title="Source freshness"
          right={<span>{formatInt(healthy)} healthy · {formatInt(issues)} issues</span>}
        >
          {freshness.length > 0 ? (
            <DataTable
              columns={freshnessCols}
              rows={freshness}
              rowKey={(r) => r.source}
              initialSort={{ key: "status", dir: "desc" }}
            />
          ) : (
            <div className="flex h-[200px] items-center justify-center text-sm text-muted">
              {loaded ? "No freshness data available." : "Loading…"}
            </div>
          )}
        </Panel>
      </div>

      <div className="mt-6">
        <Panel title="Recent ingestion runs" right={<span>Last {runs.length}</span>}>
          {runs.length > 0 ? (
            <DataTable
              columns={runCols}
              rows={runs}
              rowKey={(r, i) => `${r.source}-${r.startedAt?.getTime() ?? i}`}
            />
          ) : (
            <div className="flex h-[160px] items-center justify-center text-sm text-muted">
              {loaded ? "No ingestion runs recorded." : "Loading…"}
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
