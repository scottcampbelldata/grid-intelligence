"use client";

import { useEffect } from "react";
import { DataTable, type Column } from "@/components/DataTable";
import { KpiCard } from "@/components/KpiCard";
import { KpiRow } from "@/components/KpiRow";
import { Panel } from "@/components/Panel";
import { PanelState } from "@/components/PanelState";
import { ErrorBanner } from "@/components/ErrorBanner";
import {
  getFreshness,
  getIngestRuns,
  type IngestRun,
  type SourceFreshness,
  type SourceStatus,
} from "@/lib/api";
import { agoFromSeconds, formatInt } from "@/lib/format";
import { STATUS, statusColor } from "@/lib/status";
import type { TabMeta } from "@/lib/types";
import { usePolling } from "@/lib/useGridData";

const STATUS_COLOR: Record<SourceStatus, string> = {
  ok: STATUS.positive,
  stale: STATUS.caution,
  error: STATUS.critical,
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

// Ingest-run status uses the same vocabulary mapping as everything else.
const runColor = statusColor;

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
      {error && <ErrorBanner error={error} onRetry={refresh} />}

      <KpiRow>
        <KpiCard
          label="Sources"
          value={loaded ? formatInt(freshness.length) : "-"}
          sub="Ingestion sources"
          loading={!loaded && !error}
        />
        <KpiCard
          label="Healthy"
          value={loaded ? formatInt(healthy) : "-"}
          sub="Fetched within 3h, no error"
          loading={!loaded && !error}
        />
        <KpiCard
          label="Issues"
          value={loaded ? formatInt(issues) : "-"}
          sub="Stale or errored"
          loading={!loaded && !error}
        />
        <KpiCard
          label="Most stale"
          value={loaded && mostStale ? agoFromSeconds(mostStale.secSinceFetch).replace(" ago", "") : "-"}
          sub={mostStale ? mostStale.source : ""}
          loading={!loaded && !error}
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
            <PanelState
              loading={!loaded && !error}
              error={error}
              onRetry={refresh}
              minHeight={200}
              variant="table"
              empty="No freshness data available."
            />
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
            <PanelState
              loading={!loaded && !error}
              error={error}
              onRetry={refresh}
              minHeight={160}
              variant="table"
              empty="No ingestion runs recorded."
            />
          )}
        </Panel>
      </div>
    </>
  );
}
