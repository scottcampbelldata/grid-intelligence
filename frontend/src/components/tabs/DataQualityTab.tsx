"use client";

import { useEffect, useState } from "react";
import { DataTable, type Column } from "@/components/DataTable";
import { KpiCard } from "@/components/KpiCard";
import { KpiRow } from "@/components/KpiRow";
import { Panel } from "@/components/Panel";
import {
  getValidation,
  type ValidationCheck,
  type ValidationDetail,
  type ValidationReport,
  type ValidationStatus,
} from "@/lib/api";
import { formatInt } from "@/lib/format";
import type { TabMeta } from "@/lib/types";
import { usePolling } from "@/lib/useGridData";

// pass / warn / fail - muted green / gold / red, matching the Operations tab.
const STATUS_COLOR: Record<string, string> = {
  pass: "#5ea88a",
  warn: "#c9a45c",
  fail: "#d08a8a",
};
const STATUS_RANK: Record<string, number> = { fail: 2, warn: 1, pass: 0 };

const CHECK_LABELS: Record<string, string> = {
  energy_balance: "Energy balance",
  fuel_shares: "Fuel shares",
  carbonfree_renewable: "Carbon-free & renewable",
  demand_plausibility: "Demand plausibility",
  freshness: "Freshness",
};
function checkLabel(name: string): string {
  return CHECK_LABELS[name] ?? name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, " ");
}

function humanizeKey(k: string): string {
  if (k === "ba_code") return "BA";
  if (k === "period_utc") return "Hour";
  const base = k.replace(/_(pct|mwh|utc)$/, "").replace(/_/g, " ");
  const cap = base.charAt(0).toUpperCase() + base.slice(1);
  if (k.endsWith("_pct")) return `${cap} %`;
  if (k.endsWith("_mwh")) return `${cap} (MWh)`;
  return cap;
}

function numOf(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
}
function fmtPct(v: unknown): string {
  const n = numOf(v);
  if (Number.isNaN(n)) return "-";
  const r = Math.round(n);
  // Avoid "-0%" for tiny negative residuals that round to zero.
  return `${r === 0 ? 0 : r}%`;
}
function fmtIntCell(v: unknown): string {
  const n = numOf(v);
  return Number.isNaN(n) ? "-" : formatInt(n);
}
function fmtHour(v: unknown): string {
  if (typeof v !== "string") return "-";
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? "-"
    : d.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
}

function StatusBadge({ status }: { status: ValidationStatus | string }) {
  const color = STATUS_COLOR[status] ?? "#8b919e";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium uppercase tracking-[0.06em]"
      style={{ color, borderColor: `${color}66`, backgroundColor: `${color}14` }}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {status}
    </span>
  );
}

function StatusDot({ status }: { status: string }) {
  const color = STATUS_COLOR[status] ?? "#8b919e";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      <span style={{ color }} className="capitalize">
        {status}
      </span>
    </span>
  );
}

// Order detail columns sensibly regardless of which keys a given check exposes.
const KEY_ORDER = [
  "ba_code",
  "status",
  "residual_pct",
  "residual_mwh",
  "demand_mwh",
  "fuel_sum_mwh",
  "net_generation_mwh",
  "total_interchange_mwh",
  "period_utc",
];
function buildDetailColumns(
  details: ValidationDetail[],
  includeHours: boolean,
): Column<ValidationDetail>[] {
  const keys = Object.keys(details[0] ?? {})
    // "hours" is internal coverage context, not an exec-facing metric; only show
    // it in the expanded ("show all") view.
    .filter((k) => includeHours || k !== "hours")
    .sort((a, b) => {
      const ia = KEY_ORDER.indexOf(a);
      const ib = KEY_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  return keys.map((k): Column<ValidationDetail> => {
    if (k === "status") {
      return {
        key: k,
        header: "Status",
        align: "left",
        render: (r) => <StatusDot status={String(r.status)} />,
        sortValue: (r) => STATUS_RANK[String(r.status)] ?? 0,
      };
    }
    if (k === "ba_code") {
      return {
        key: k,
        header: "BA",
        align: "left",
        cellClassName: "text-text",
        render: (r) => String(r.ba_code ?? "-"),
        sortValue: (r) => String(r.ba_code ?? ""),
      };
    }
    if (k === "period_utc") {
      return {
        key: k,
        header: "Hour",
        align: "right",
        cellClassName: "text-muted",
        render: (r) => fmtHour(r[k]),
        sortValue: (r) => new Date(String(r[k])).getTime() || 0,
      };
    }
    if (k.endsWith("_pct")) {
      return {
        key: k,
        header: humanizeKey(k),
        align: "right",
        cellClassName: "font-mono tabular-nums text-text",
        render: (r) => fmtPct(r[k]),
        sortValue: (r) => numOf(r[k]) || 0,
      };
    }
    return {
      key: k,
      header: humanizeKey(k),
      align: "right",
      cellClassName: "font-mono tabular-nums text-muted",
      render: (r) => fmtIntCell(r[k]),
      sortValue: (r) => numOf(r[k]) || 0,
    };
  });
}

function CheckPanel({ check }: { check: ValidationCheck }) {
  const [showAll, setShowAll] = useState(false);
  const hasDetails = check.details.length > 0;
  const problems = check.details.filter((d) => String(d.status) !== "pass");
  const okCount = check.details.length - problems.length;
  const cols = hasDetails ? buildDetailColumns(check.details, showAll) : [];
  const initialSort = cols.some((c) => c.key === "residual_pct")
    ? { key: "residual_pct", dir: "desc" as const }
    : { key: "status", dir: "desc" as const };
  const rows = showAll ? check.details : problems;

  return (
    <Panel
      title={checkLabel(check.name)}
      right={<StatusBadge status={check.status} />}
      className="mt-6"
    >
      <p className="max-w-3xl text-xs leading-relaxed text-muted">{check.explanation}</p>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <span className="text-sm text-text">{check.value}</span>
        {check.threshold && (
          <span className="text-xs text-muted">Threshold: {check.threshold}</span>
        )}
      </div>

      {hasDetails ? (
        <div className="mt-4">
          {problems.length > 0 ? (
            <>
              <div className="mb-2 text-xs text-muted">
                {showAll
                  ? `All ${check.details.length} BAs`
                  : `${problems.length} BA${problems.length === 1 ? "" : "s"} flagged (warn or fail)`}
              </div>
              <DataTable
                columns={cols}
                rows={rows}
                rowKey={(r, i) => String(r.ba_code ?? i)}
                initialSort={initialSort}
              />
            </>
          ) : (
            <div className="text-sm text-muted">
              All {check.details.length} BAs pass.
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="mt-3 text-xs text-accent transition-opacity hover:opacity-80"
          >
            {showAll
              ? "Show only flagged BAs"
              : `Show all ${check.details.length} BAs (incl. ${okCount} passing)`}
          </button>
        </div>
      ) : (
        Object.keys(check.counts).length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {Object.entries(check.counts).map(([k, v]) => (
              <span
                key={k}
                className="inline-flex items-baseline gap-1.5 rounded border border-border bg-bg px-2.5 py-1 text-xs"
              >
                <span className="font-mono tabular-nums text-text">{formatInt(v)}</span>
                <span className="text-muted">{humanizeKey(k)}</span>
              </span>
            ))}
          </div>
        )
      )}
    </Panel>
  );
}

function fmtAsOf(d: Date | null): string {
  if (!d) return "-";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function DataQualityTab({ onMeta }: { onMeta: (m: TabMeta) => void }) {
  const { data, error, lastUpdated, refresh } = usePolling<ValidationReport>(
    (signal) => getValidation(signal),
    60_000,
  );
  useEffect(() => {
    onMeta({ lastUpdated, error });
  }, [lastUpdated, error, onMeta]);

  const loaded = lastUpdated !== null;
  const summary = data?.summary ?? { pass: 0, warn: 0, fail: 0 };
  const checks = data?.checks ?? [];
  const total = summary.pass + summary.warn + summary.fail;

  // Plain-language verdict, leading with the reassuring case.
  const headline = !loaded
    ? null
    : summary.fail > 0
      ? `${summary.fail} ${summary.fail === 1 ? "check needs" : "checks need"} attention.`
      : summary.warn > 0
        ? `All checks healthy - ${summary.warn} advisory ${summary.warn === 1 ? "notice" : "notices"}.`
        : "All data-quality checks passing.";

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
          label="Checks"
          value={loaded ? formatInt(total) : "-"}
          sub="Data-quality checks"
          loading={!loaded}
        />
        <KpiCard
          label="Passing"
          value={loaded ? formatInt(summary.pass) : "-"}
          sub="Within threshold"
          loading={!loaded}
        />
        <KpiCard
          label="Warnings"
          value={loaded ? formatInt(summary.warn) : "-"}
          sub="Above warn threshold"
          loading={!loaded}
        />
        <KpiCard
          label="Failures"
          value={loaded ? formatInt(summary.fail) : "-"}
          sub={data?.asOf ? `As of ${fmtAsOf(data.asOf)}` : "Above fail threshold"}
          loading={!loaded}
        />
      </KpiRow>

      {headline && <p className="mt-4 text-sm text-muted">{headline}</p>}

      {loaded && checks.length === 0 && !error ? (
        <div className="mt-6">
          <Panel title="Validation">
            <div className="flex h-[200px] items-center justify-center text-sm text-muted">
              No validation checks returned.
            </div>
          </Panel>
        </div>
      ) : (
        checks.map((c) => <CheckPanel key={c.name} check={c} />)
      )}
    </>
  );
}
