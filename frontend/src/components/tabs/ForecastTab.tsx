"use client";

import { useEffect, useState } from "react";
import { BaCompareSelect } from "@/components/BaCompareSelect";
import { ErrorBanner } from "@/components/ErrorBanner";
import { ForecastChart } from "@/components/ForecastChart";
import {
  ForecastCompareChart,
  type ForecastCompareSeries,
} from "@/components/ForecastCompareChart";
import { KpiCard } from "@/components/KpiCard";
import { KpiRow } from "@/components/KpiRow";
import { Panel } from "@/components/Panel";
import { PanelState } from "@/components/PanelState";
import {
  getBalancingAuthorities,
  getForecast,
  getForecastAccuracy,
  type AccuracySource,
  type ForecastData,
} from "@/lib/api";
import { formatInt, formatPower } from "@/lib/format";
import { seriesColor } from "@/lib/palette";
import type { TabMeta } from "@/lib/types";
import { usePolling } from "@/lib/useGridData";

const DEFAULT_BA = "PJM";
const MAX_COMPARE = 3; // forecast overlays get busy fast - cap tighter than Demand

// One source's backtest metrics (our SARIMAX or EIA's day-ahead benchmark).
function AccuracyBlock({ src }: { src: AccuracySource }) {
  return (
    <div className="rounded-md border border-border bg-bg px-5 py-4">
      <div className="text-xs uppercase tracking-[0.12em] text-muted">{src.label}</div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="font-mono text-[1.75rem] font-medium leading-none tabular-nums text-text">
          {src.mapePct != null ? src.mapePct.toFixed(2) : "-"}
        </span>
        <span className="text-sm text-muted">% MAPE</span>
      </div>
      <div className="mt-2 text-xs text-muted">
        RMSE {src.rmseMwh != null ? formatInt(src.rmseMwh) : "-"} MWh · n={formatInt(src.pairs)}
      </div>
    </div>
  );
}

function shortTime(t: number | null): string {
  if (t === null) return "";
  return new Date(t).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function ForecastTab({ onMeta }: { onMeta: (m: TabMeta) => void }) {
  // 1 BA → full single view (actual + forecast + confidence band). 2-3 BAs →
  // clean line overlay, no bands. PJM is the default single selection.
  const [bas, setBas] = useState<string[]>([DEFAULT_BA]);

  // BA list for the selector - fetched once (no polling interval).
  const { data: basData } = usePolling((signal) => getBalancingAuthorities(signal), 0);
  const options = basData ?? [];

  // Once the BA list loads, drop any selection it doesn't contain; fall back to
  // PJM (or the first BA) if nothing valid remains.
  useEffect(() => {
    if (options.length === 0) return;
    const valid = bas.filter((b) => options.includes(b));
    const next =
      valid.length > 0 ? valid : [options.includes(DEFAULT_BA) ? DEFAULT_BA : options[0]];
    if (next.join(",") !== bas.join(",")) setBas(next);
  }, [options, bas]);

  // Forecast(s) for the selected BA(s) - refetches when the selection changes.
  // allSettled (not Promise.all) so one BA's failure doesn't blank the whole
  // comparison: render the BAs that loaded and note the ones that didn't. Only a
  // total outage (nothing loaded) surfaces the error banner + retry.
  const key = bas.join(",");
  const { data, error, lastUpdated, refresh } = usePolling(
    async (signal): Promise<{ forecasts: ForecastData[]; failed: string[] }> => {
      const settled = await Promise.allSettled(bas.map((b) => getForecast(b, signal)));
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      const forecasts: ForecastData[] = [];
      const failed: string[] = [];
      settled.forEach((r, i) => {
        if (r.status === "fulfilled") forecasts.push(r.value);
        else failed.push(bas[i]);
      });
      if (forecasts.length === 0) {
        throw new Error(`forecast unavailable for ${failed.join(", ")}`);
      }
      return { forecasts, failed };
    },
    60_000,
    [key],
  );
  useEffect(() => {
    onMeta({ lastUpdated, error });
  }, [lastUpdated, error, onMeta]);

  // Forecast-accuracy backtest (changes slowly). Filter by the selected BA in
  // single-BA mode; show the all-BA aggregate when comparing.
  const accuracyKey = bas.length === 1 ? bas[0] : "all";
  const { data: accuracyData } = usePolling(
    (signal) => getForecastAccuracy(168, bas.length === 1 ? bas[0] : undefined, signal),
    300_000,
    [accuracyKey],
  );
  const accSarimax = accuracyData?.sources.find((s) => s.source === "sarimax") ?? null;
  const accEia = accuracyData?.sources.find((s) => s.source === "eia_day_ahead") ?? null;
  const accLoaded = accuracyData != null;
  const accScope = bas.length === 1 ? bas[0] : "all BAs";
  const windowDays = accuracyData?.windowHours
    ? Math.round(accuracyData.windowHours / 24)
    : 7;

  const loaded = lastUpdated !== null;
  const forecasts = data?.forecasts ?? [];
  const failedBas = data?.failed ?? [];
  const comparing = forecasts.length > 1;
  const single = forecasts.length === 1 ? forecasts[0] : null;

  const compareSeries: ForecastCompareSeries[] = forecasts.map((f, i) => ({
    ba: f.baCode,
    color: seriesColor(i),
    data: f,
  }));

  const latest = formatPower(single?.lastActual?.mwh ?? null);
  const next = formatPower(single?.firstForecast?.yhat ?? null);
  const peak = formatPower(single?.peakForecast?.yhat ?? null);
  const hasForecast = (single?.horizonHours ?? 0) > 0;
  const hasData = forecasts.some((f) => f.points.length > 0);

  const panelTitle = comparing
    ? `Forecast comparison - ${bas.join(" · ")}`
    : `Demand forecast - ${bas[0] ?? ""}`;
  const panelRight = comparing
    ? `normalized · ${forecasts.length} BAs · % of each BA's peak`
    : hasForecast
      ? "GW · 72h actual + forecast"
      : "GW · no current forecast";

  return (
    <>
      {error && <ErrorBanner error={error} onRetry={refresh} />}

      {!error && failedBas.length > 0 && (
        <div
          role="status"
          className="mb-6 rounded-md border border-border bg-surface px-5 py-3 text-sm text-muted"
        >
          Couldn&apos;t load {failedBas.join(", ")} - showing the rest.
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <span className="text-xs uppercase tracking-[0.12em] text-muted">
          Balancing {bas.length > 1 ? "authorities" : "authority"}
        </span>
        <BaCompareSelect
          options={options}
          selected={bas}
          onChange={setBas}
          colorOf={seriesColor}
          min={1}
          max={MAX_COMPARE}
          addLabel="Compare BA"
        />
      </div>

      {!comparing && (
        <KpiRow>
          <KpiCard
            label="Latest actual"
            value={latest.value}
            unit={latest.unit}
            sub={single?.lastActual ? shortTime(single.lastActual.t) : ""}
            loading={!loaded && !error}
          />
          <KpiCard
            label="Next forecast"
            value={next.value}
            unit={next.unit}
            sub={single?.firstForecast ? shortTime(single.firstForecast.t) : "No current forecast"}
            loading={!loaded && !error}
          />
          <KpiCard
            label="Forecast peak"
            value={peak.value}
            unit={peak.unit}
            sub={single?.peakForecast ? shortTime(single.peakForecast.t) : ""}
            loading={!loaded && !error}
          />
          <KpiCard
            label="Forecast horizon"
            value={loaded ? `${single?.horizonHours ?? 0}` : "-"}
            unit={loaded ? "h" : undefined}
            sub={single?.modelName ?? ""}
            loading={!loaded && !error}
          />
        </KpiRow>
      )}

      <div className="mt-6">
        <Panel title={panelTitle} right={<span>{panelRight}</span>}>
          {hasData ? (
            comparing ? (
              <ForecastCompareChart series={compareSeries} />
            ) : (
              <ForecastChart points={single!.points} boundaryT={single!.boundaryT} />
            )
          ) : (
            <PanelState
              loading={!loaded && !error}
              error={error}
              onRetry={refresh}
              minHeight={340}
              empty={`No demand or forecast data for ${bas.join(", ")}.`}
            />
          )}
        </Panel>
      </div>

      <div className="mt-6">
        <Panel
          title="Forecast accuracy"
          right={
            <span>
              {accScope} · {windowDays}-day out-of-sample backtest
            </span>
          }
        >
          {accSarimax || accEia ? (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {accSarimax && <AccuracyBlock src={accSarimax} />}
                {accEia && <AccuracyBlock src={accEia} />}
              </div>
              <p className="mt-4 max-w-3xl text-xs leading-relaxed text-muted">
                {accuracyData?.metricNotes} SARIMAX is a new model with a short backtest
                history
                {accSarimax && accEia
                  ? ` (n=${formatInt(accSarimax.pairs)} vs EIA day-ahead n=${formatInt(
                      accEia.pairs,
                    )})`
                  : ""}
                {" "}- read the comparison as directional, not a verdict.
              </p>
            </>
          ) : (
            <PanelState
              loading={!accLoaded}
              minHeight={120}
              empty="No backtest available for this selection."
            />
          )}
        </Panel>
      </div>
    </>
  );
}
