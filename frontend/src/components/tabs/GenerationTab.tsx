"use client";

import { useEffect } from "react";
import { HBarChart, type HBarDatum } from "@/components/HBarChart";
import { StackedAreaChart } from "@/components/StackedAreaChart";
import { KpiCard } from "@/components/KpiCard";
import { KpiRow } from "@/components/KpiRow";
import { Panel } from "@/components/Panel";
import { ErrorBanner } from "@/components/ErrorBanner";
import { getGeneration } from "@/lib/api";
import { formatEnergy } from "@/lib/format";
import type { TabMeta } from "@/lib/types";
import { usePolling } from "@/lib/useGridData";

export function GenerationTab({ onMeta }: { onMeta: (m: TabMeta) => void }) {
  const { data, error, lastUpdated, refresh } = usePolling(
    (signal) => getGeneration(24, signal),
    60_000,
  );
  useEffect(() => {
    onMeta({ lastUpdated, error });
  }, [lastUpdated, error, onMeta]);

  const loaded = lastUpdated !== null;
  const share = data?.share ?? null;
  const total = formatEnergy(share?.totalMwh ?? null);
  const topFuel = share?.rows[0] ?? null;

  // Fuel-share breakdown - derived from the same fuel bands as the stacked chart
  // (getGeneration), so both stay consistent: the named fuels plus exactly one
  // aggregated "Other" (no duplicate, Solar kept as its own bar).
  const shareBars: HBarDatum[] = (() => {
    if (!data || !share) return [];
    const namedCodes = new Set(
      data.bands.filter((b) => b.code !== "__other__").map((b) => b.code),
    );
    const pctByCode = new Map(share.rows.map((r) => [r.fuelCode, r.pct ?? 0]));
    return data.bands.map((b) => {
      if (b.code === "__other__") {
        const otherPct = share.rows
          .filter((r) => !namedCodes.has(r.fuelCode))
          .reduce((s, r) => s + (r.pct ?? 0), 0);
        return { label: b.label, value: otherPct };
      }
      return { label: b.label, value: pctByCode.get(b.code) ?? 0 };
    });
  })();

  return (
    <>
      {error && <ErrorBanner error={error} onRetry={refresh} />}

      <KpiRow>
        <KpiCard
          label="Generation, 24h"
          value={total.value}
          unit={total.unit}
          sub={share ? `${share.rows.length} fuel types` : ""}
          loading={!loaded}
        />
        <KpiCard
          label="Carbon-free share"
          value={share?.carbonFreePct != null ? share.carbonFreePct.toFixed(1) : "-"}
          unit="%"
          sub="Nuclear, hydro, wind, solar"
          loading={!loaded}
        />
        <KpiCard
          label="Renewable share"
          value={share?.renewablePct != null ? share.renewablePct.toFixed(1) : "-"}
          unit="%"
          sub="Wind, solar, hydro"
          loading={!loaded}
        />
        <KpiCard
          label="Largest source"
          value={topFuel?.pct != null ? topFuel.pct.toFixed(1) : "-"}
          unit="%"
          sub={topFuel ? topFuel.fuelName : ""}
          loading={!loaded}
        />
      </KpiRow>

      <div className="mt-6">
        <Panel title="Generation by fuel, last 24 hours" right={<span>GW</span>}>
          {data && data.series.length > 0 ? (
            <StackedAreaChart series={data.series} bands={data.bands} />
          ) : (
            <div className="flex h-[320px] items-center justify-center text-sm text-muted">
              {loaded ? "No generation data in the last 24 hours." : "Loading…"}
            </div>
          )}
        </Panel>
      </div>

      <div className="mt-6">
        <Panel title="Fuel share, last 24 hours" right={<span>Share of generation</span>}>
          {shareBars.length > 0 ? (
            <HBarChart data={shareBars} maxBars={shareBars.length} decimals={1} unit="%" labelWidth={96} />
          ) : (
            <div className="flex h-[280px] items-center justify-center text-sm text-muted">
              {loaded ? "No fuel-share data available." : "Loading…"}
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
