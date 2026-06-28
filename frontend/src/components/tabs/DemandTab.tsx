"use client";

import { useEffect, useRef, useState } from "react";
import { BaCompareSelect } from "@/components/BaCompareSelect";
import { DemandChart } from "@/components/DemandChart";
import {
  DemandCompareChart,
  type CompareLine,
  type CompareRow,
} from "@/components/DemandCompareChart";
import { Delta, KpiCard } from "@/components/KpiCard";
import { KpiRow } from "@/components/KpiRow";
import { Panel } from "@/components/Panel";
import { ErrorBanner } from "@/components/ErrorBanner";
import { TopBaChart } from "@/components/TopBaChart";
import { formatEnergy, formatInt, formatPct, formatPower } from "@/lib/format";
import { seriesColor } from "@/lib/palette";
import type { TabMeta } from "@/lib/types";
import { useDemandData } from "@/lib/useGridData";

const MIN_COMPARE = 2;
const MAX_COMPARE = 5;

export function DemandTab({ onMeta }: { onMeta: (m: TabMeta) => void }) {
  const { data, error, lastUpdated, refresh } = useDemandData(60_000);
  useEffect(() => {
    onMeta({ lastUpdated, error });
  }, [lastUpdated, error, onMeta]);

  const { headline, series, byBa, byBaSeries, times, generation, anomalies } = data;
  const loaded = lastUpdated !== null;

  // Multi-BA comparison: default to the top 3 by demand once data lands, then
  // let the user adjust (2-5). Initialized once so polling never resets a choice.
  const [compareBas, setCompareBas] = useState<string[]>([]);
  const initialized = useRef(false);
  useEffect(() => {
    if (!initialized.current && byBa.length > 0) {
      setCompareBas(byBa.slice(0, 3).map((b) => b.baCode));
      initialized.current = true;
    }
  }, [byBa]);

  const compareLines: CompareLine[] = compareBas.map((ba, i) => ({
    ba,
    color: seriesColor(i),
  }));
  const compareRows: CompareRow[] = times.map((t) => {
    const row: CompareRow = { t };
    for (const ba of compareBas) {
      const v = byBaSeries[ba]?.[t];
      row[ba] = v == null ? null : v;
    }
    return row;
  });
  const demand = formatPower(headline?.totalMwhNow ?? null);
  const gen = formatEnergy(generation?.totalMwh ?? null);

  const highSeverity = anomalies.filter((a) =>
    ["high", "critical", "severe"].includes(a.severity.toLowerCase()),
  ).length;
  const anomalySub = !loaded
    ? ""
    : anomalies.length === 0
      ? "None detected"
      : highSeverity > 0
        ? `${highSeverity} high severity`
        : "All low / moderate";

  return (
    <>
      {error && <ErrorBanner error={error} onRetry={refresh} />}

      <KpiRow>
        <KpiCard
          label="Network demand"
          value={demand.value}
          unit={demand.unit}
          sub={<Delta pct={headline?.deltaPct ?? null} />}
          loading={!loaded}
        />
        <KpiCard
          label="Generation, 24h"
          value={gen.value}
          unit={gen.unit}
          sub={generation ? `${generation.rows.length} fuel types` : ""}
          loading={!loaded}
        />
        <KpiCard
          label="Carbon-free share"
          value={generation?.carbonFreePct != null ? generation.carbonFreePct.toFixed(1) : "-"}
          unit="%"
          sub={
            generation?.renewablePct != null
              ? `Renewables ${formatPct(generation.renewablePct)}`
              : ""
          }
          loading={!loaded}
        />
        <KpiCard
          label="Anomalies, 24h"
          value={loaded ? formatInt(anomalies.length) : "-"}
          sub={anomalySub}
          loading={!loaded}
        />
      </KpiRow>

      <div className="mt-6">
        <Panel
          title="Network demand, last 24 hours"
          right={
            <span>
              GW
              {headline?.bas != null && (
                <> · {formatInt(headline.bas)} balancing authorities</>
              )}
            </span>
          }
        >
          {series.length > 0 ? (
            <DemandChart data={series} />
          ) : (
            <div className="flex h-[320px] items-center justify-center text-sm text-muted">
              {loaded ? "No demand data in the last 24 hours." : "Loading…"}
            </div>
          )}
        </Panel>
      </div>

      <div className="mt-6">
        <Panel
          title="Compare balancing authorities, last 24 hours"
          right={<span>GW · demand by BA</span>}
        >
          {byBa.length > 0 ? (
            <>
              <div className="mb-5">
                <BaCompareSelect
                  options={byBa.map((b) => b.baCode)}
                  selected={compareBas}
                  onChange={setCompareBas}
                  colorOf={seriesColor}
                  min={MIN_COMPARE}
                  max={MAX_COMPARE}
                  addLabel="Add BA"
                />
              </div>
              {compareRows.length > 0 ? (
                <DemandCompareChart rows={compareRows} lines={compareLines} />
              ) : (
                <div className="flex h-[320px] items-center justify-center text-sm text-muted">
                  Select balancing authorities to compare.
                </div>
              )}
            </>
          ) : (
            <div className="flex h-[320px] items-center justify-center text-sm text-muted">
              {loaded ? "No balancing-authority data available." : "Loading…"}
            </div>
          )}
        </Panel>
      </div>

      <div className="mt-6">
        <Panel title="Top balancing authorities by demand, last 24 hours" right={<span>Average GW</span>}>
          {byBa.length > 0 ? (
            <TopBaChart data={byBa} />
          ) : (
            <div className="flex h-[280px] items-center justify-center text-sm text-muted">
              {loaded ? "No balancing-authority data available." : "Loading…"}
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
