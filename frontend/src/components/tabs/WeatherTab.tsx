"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { DataTable, type Column } from "@/components/DataTable";
import { KpiCard } from "@/components/KpiCard";
import { KpiRow } from "@/components/KpiRow";
import { Panel } from "@/components/Panel";
import { getWeather, type WeatherStation } from "@/lib/api";
import { formatInt } from "@/lib/format";
import type { TabMeta } from "@/lib/types";
import { usePolling } from "@/lib/useGridData";

// Map is client-only (d3 / react-simple-maps) - never server-rendered.
const WeatherMap = dynamic(
  () => import("@/components/WeatherMap").then((m) => m.WeatherMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[500px] items-center justify-center text-sm text-muted">
        Loading map…
      </div>
    ),
  },
);

function fmtTemp(c: number | null): string {
  return c === null ? "-" : `${c.toFixed(1)}`;
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

export function WeatherTab({ onMeta }: { onMeta: (m: TabMeta) => void }) {
  const { data, error, lastUpdated, refresh } = usePolling(
    (signal) => getWeather(signal),
    300_000, // weather forecast changes slowly - poll every 5 min
  );
  useEffect(() => {
    onMeta({ lastUpdated, error });
  }, [lastUpdated, error, onMeta]);

  const loaded = lastUpdated !== null;
  const stations = data ?? [];
  const isEmpty = loaded && !error && stations.length === 0;

  const withTemp = stations.filter((s) => s.tempC !== null);
  const warmest = withTemp.reduce<WeatherStation | null>(
    (b, s) => (b === null || (s.tempC ?? -Infinity) > (b.tempC ?? -Infinity) ? s : b),
    null,
  );
  const coolest = withTemp.reduce<WeatherStation | null>(
    (b, s) => (b === null || (s.tempC ?? Infinity) < (b.tempC ?? Infinity) ? s : b),
    null,
  );
  const windiest = stations.reduce<WeatherStation | null>(
    (b, s) => (b === null || (s.windKph ?? -Infinity) > (b.windKph ?? -Infinity) ? s : b),
    null,
  );

  const columns: Column<WeatherStation>[] = [
    { key: "ba", header: "BA", align: "left", render: (r) => r.baCode, sortValue: (r) => r.baCode },
    {
      key: "temp",
      header: "Temp (°C)",
      align: "right",
      cellClassName: "font-mono tabular-nums text-text",
      render: (r) => fmtTemp(r.tempC),
      sortValue: (r) => r.tempC ?? -Infinity,
    },
    {
      key: "wind",
      header: "Wind (km/h)",
      align: "right",
      cellClassName: "font-mono tabular-nums text-muted",
      render: (r) => (r.windKph != null ? r.windKph.toFixed(0) : "-"),
      sortValue: (r) => r.windKph ?? -Infinity,
    },
    {
      key: "cloud",
      header: "Cloud (%)",
      align: "right",
      cellClassName: "font-mono tabular-nums text-muted",
      render: (r) => (r.cloudPct != null ? r.cloudPct.toFixed(0) : "-"),
      sortValue: (r) => r.cloudPct ?? -Infinity,
    },
    {
      key: "conditions",
      header: "Conditions",
      align: "left",
      cellClassName: "text-text",
      render: (r) => r.conditions,
    },
    {
      key: "valid",
      header: "Forecast for",
      align: "right",
      cellClassName: "text-muted",
      render: (r) => fmtTime(r.periodUtc),
      sortValue: (r) => r.periodUtc?.getTime() ?? 0,
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
          label="Stations"
          value={loaded ? formatInt(stations.length) : "-"}
          sub="BA centroids"
          loading={!loaded}
        />
        <KpiCard
          label="Warmest"
          value={fmtTemp(warmest?.tempC ?? null)}
          unit={warmest ? "°C" : undefined}
          sub={warmest ? warmest.baCode : ""}
          loading={!loaded}
        />
        <KpiCard
          label="Coolest"
          value={fmtTemp(coolest?.tempC ?? null)}
          unit={coolest ? "°C" : undefined}
          sub={coolest ? coolest.baCode : ""}
          loading={!loaded}
        />
        <KpiCard
          label="Windiest"
          value={windiest?.windKph != null ? windiest.windKph.toFixed(0) : "-"}
          unit={windiest?.windKph != null ? "km/h" : undefined}
          sub={windiest ? windiest.baCode : ""}
          loading={!loaded}
        />
      </KpiRow>

      <div className="mt-6">
        <Panel
          title="Weather forecast by balancing-authority centroid"
          right={<span>NOAA gridpoint forecast · future-dated</span>}
        >
          {isEmpty ? (
            <div className="flex h-[500px] items-center justify-center text-sm text-muted">
              No weather forecast available.
            </div>
          ) : stations.length > 0 ? (
            <>
              <p className="mb-4 max-w-2xl text-xs text-muted">
                NOAA gridpoint forecast at each balancing-authority centroid, colored
                by temperature - these are predicted conditions, not current
                observations. Hover a point for detail.
              </p>
              <WeatherMap stations={stations} />
            </>
          ) : (
            <div className="flex h-[500px] items-center justify-center text-sm text-muted">
              Loading…
            </div>
          )}
        </Panel>
      </div>

      {stations.length > 0 && (
        <div className="mt-6">
          <Panel title="Forecast detail" right={<span>{formatInt(stations.length)} stations</span>}>
            <DataTable
              columns={columns}
              rows={stations}
              rowKey={(r) => r.baCode}
              initialSort={{ key: "ba", dir: "asc" }}
            />
          </Panel>
        </div>
      )}
    </>
  );
}
