"use client";

import { useEffect } from "react";
import { HBarChart, type HBarDatum } from "@/components/HBarChart";
import { KpiCard } from "@/components/KpiCard";
import { KpiRow } from "@/components/KpiRow";
import { Panel } from "@/components/Panel";
import { PanelState } from "@/components/PanelState";
import { StackedAreaChart } from "@/components/StackedAreaChart";
import { ErrorBanner } from "@/components/ErrorBanner";
import { getEurope } from "@/lib/api";
import { formatEnergy, formatInt, formatPower } from "@/lib/format";
import type { TabMeta } from "@/lib/types";
import { usePolling } from "@/lib/useGridData";

export function EuropeTab({ onMeta }: { onMeta: (m: TabMeta) => void }) {
  const { data, error, lastUpdated, refresh } = usePolling(
    (signal) => getEurope(24, signal),
    60_000,
  );
  useEffect(() => {
    onMeta({ lastUpdated, error });
  }, [lastUpdated, error, onMeta]);

  const loaded = lastUpdated !== null;
  const hasData = (data?.series.length ?? 0) > 0;
  const isEmpty = loaded && !error && !hasData;

  const total = formatEnergy(data?.totalMwh ?? null);
  const peak = formatPower(data?.peakTotalMw ?? null);
  const largest = data?.zones[0] ?? null;
  const largestGw = formatPower(largest?.avgMw ?? null);

  const zoneBars: HBarDatum[] = (data?.zones ?? [])
    .slice(0, 10)
    .map((z) => ({ label: z.name, value: z.avgMw / 1_000 }));

  return (
    <>
      {error && <ErrorBanner error={error} onRetry={refresh} />}

      <KpiRow>
        <KpiCard
          label="Total load, 24h"
          value={total.value}
          unit={total.unit}
          sub={data ? `${data.zones.length} bidding zones` : ""}
          loading={!loaded && !error}
        />
        <KpiCard
          label="Zones tracked"
          value={loaded ? formatInt(data?.zones.length ?? 0) : "-"}
          sub="ENTSO-E bidding zones"
          loading={!loaded && !error}
        />
        <KpiCard
          label="Largest zone"
          value={largestGw.value}
          unit={largestGw.unit}
          sub={largest ? largest.name : ""}
          loading={!loaded && !error}
        />
        <KpiCard
          label="Peak load"
          value={peak.value}
          unit={peak.unit}
          sub="Across all zones"
          loading={!loaded && !error}
        />
      </KpiRow>

      {isEmpty ? (
        <div className="mt-6">
          <Panel title="European load by bidding zone, last 24 hours">
            <PanelState
              loading={false}
              minHeight={320}
              empty="No ENTSO-E load data in the last 24 hours."
            />
          </Panel>
        </div>
      ) : (
        <>
          <div className="mt-6">
            <Panel
              title="European load by bidding zone, last 24 hours"
              right={<span>GW · top 6 zones + other</span>}
            >
              {hasData ? (
                <StackedAreaChart series={data!.series} bands={data!.bands} />
              ) : (
                <PanelState
                  loading={!loaded && !error}
                  error={error}
                  onRetry={refresh}
                  minHeight={320}
                  empty="No ENTSO-E load data in the last 24 hours."
                />
              )}
            </Panel>
          </div>

          <div className="mt-6">
            <Panel title="Load by bidding zone, last 24 hours" right={<span>Average GW</span>}>
              {zoneBars.length > 0 ? (
                <HBarChart data={zoneBars} maxBars={10} decimals={1} unit="GW" labelWidth={130} />
              ) : (
                <PanelState
                  loading={!loaded && !error}
                  error={error}
                  onRetry={refresh}
                  minHeight={280}
                  variant="bars"
                  empty="No bidding-zone data available."
                />
              )}
            </Panel>
          </div>
        </>
      )}
    </>
  );
}
