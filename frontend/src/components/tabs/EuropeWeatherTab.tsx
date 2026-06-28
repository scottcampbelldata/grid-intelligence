"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { DataTable, type Column } from "@/components/DataTable";
import { KpiCard } from "@/components/KpiCard";
import { KpiRow } from "@/components/KpiRow";
import { Panel } from "@/components/Panel";
import { PanelState } from "@/components/PanelState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { getEuropeWeather, type EuropeWeatherZone } from "@/lib/api";
import { formatInt } from "@/lib/format";
import type { TabMeta } from "@/lib/types";
import { usePolling } from "@/lib/useGridData";

// Map is client-only (d3 / react-simple-maps) - never server-rendered, same as
// the US Weather tab.
const EuropeWeatherMap = dynamic(
  () => import("@/components/EuropeWeatherMap").then((m) => m.EuropeWeatherMap),
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

export function EuropeWeatherTab({ onMeta }: { onMeta: (m: TabMeta) => void }) {
  const { data, error, lastUpdated, refresh } = usePolling(
    (signal) => getEuropeWeather(signal),
    300_000, // weather forecast changes slowly - poll every 5 min
  );
  useEffect(() => {
    onMeta({ lastUpdated, error });
  }, [lastUpdated, error, onMeta]);

  const loaded = lastUpdated !== null;
  const zones = data ?? [];
  const isEmpty = loaded && !error && zones.length === 0;

  const withTemp = zones.filter((z) => z.tempC !== null);
  const warmest = withTemp.reduce<EuropeWeatherZone | null>(
    (b, z) => (b === null || (z.tempC ?? -Infinity) > (b.tempC ?? -Infinity) ? z : b),
    null,
  );
  const coolest = withTemp.reduce<EuropeWeatherZone | null>(
    (b, z) => (b === null || (z.tempC ?? Infinity) < (b.tempC ?? Infinity) ? z : b),
    null,
  );
  const windiest = zones.reduce<EuropeWeatherZone | null>(
    (b, z) => (b === null || (z.windKph ?? -Infinity) > (b.windKph ?? -Infinity) ? z : b),
    null,
  );

  const columns: Column<EuropeWeatherZone>[] = [
    {
      key: "zone",
      header: "Zone",
      align: "left",
      cellClassName: "text-text",
      render: (r) => r.name,
      sortValue: (r) => r.name,
    },
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
      {error && <ErrorBanner error={error} onRetry={refresh} />}

      <KpiRow>
        <KpiCard
          label="Zones tracked"
          value={loaded ? formatInt(zones.length) : "-"}
          sub="Bidding-zone centroids"
          loading={!loaded && !error}
        />
        <KpiCard
          label="Warmest"
          value={fmtTemp(warmest?.tempC ?? null)}
          unit={warmest ? "°C" : undefined}
          sub={warmest ? warmest.name : ""}
          loading={!loaded && !error}
        />
        <KpiCard
          label="Coolest"
          value={fmtTemp(coolest?.tempC ?? null)}
          unit={coolest ? "°C" : undefined}
          sub={coolest ? coolest.name : ""}
          loading={!loaded && !error}
        />
        <KpiCard
          label="Windiest"
          value={windiest?.windKph != null ? windiest.windKph.toFixed(0) : "-"}
          unit={windiest?.windKph != null ? "km/h" : undefined}
          sub={windiest ? windiest.name : ""}
          loading={!loaded && !error}
        />
      </KpiRow>

      <div className="mt-6">
        <Panel
          title="Europe - weather forecast by bidding-zone centroid"
          right={<span>Open-Meteo forecast · future-dated</span>}
        >
          {isEmpty ? (
            <PanelState loading={false} minHeight={500} empty="No weather forecast available." />
          ) : zones.length > 0 ? (
            <>
              <p className="mb-4 max-w-2xl text-xs text-muted">
                Open-Meteo forecast at each European bidding-zone centroid, colored by
                temperature - these are predicted conditions, not current observations.
                Hover a point for detail.
              </p>
              <EuropeWeatherMap stations={zones} />
            </>
          ) : (
            <PanelState
              loading={!loaded && !error}
              error={error}
              onRetry={refresh}
              minHeight={500}
              empty="No weather forecast available."
            />
          )}
        </Panel>
      </div>

      {zones.length > 0 && (
        <div className="mt-6">
          <Panel
            title="Forecast detail"
            right={<span>Open-Meteo (CC BY 4.0) · {formatInt(zones.length)} zones</span>}
          >
            <DataTable
              columns={columns}
              rows={zones}
              rowKey={(r) => r.zone}
              initialSort={{ key: "zone", dir: "asc" }}
            />
          </Panel>
        </div>
      )}
    </>
  );
}
