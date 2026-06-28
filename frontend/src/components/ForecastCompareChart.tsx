"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatHour } from "@/lib/format";
import { useThemeColors } from "@/lib/useThemeColors";
import type { ForecastData } from "@/lib/api";

// Compares the forecasts of 2-3 balancing authorities. Each BA is ONE colored
// line that runs solid through realized history and dashed through the forecast
// horizon, meeting at a single shared "now" divider - the same visual language
// as the single-BA chart, extended to a restrained per-BA palette. Confidence
// bands are deliberately dropped here: stacking 2-3 translucent bands turns the
// panel to mush, so bands stay in the single-BA view and comparison stays to
// clean lines.
//
// Series are NORMALIZED to each BA's own peak (% of peak), not plotted in
// absolute GW. A shared GW axis is the wrong encoding for comparison: a 120 GW
// RTO (PJM) and a 3 GW utility (PGE) on one linear scale just crushes the small
// BA into a flat line at the floor and communicates nothing but "PJM is big" -
// which the single-BA view already shows. Normalizing lets the actual point of a
// comparison - demand *shape* and timing (diurnal peaks, ramps, where each grid
// sits in its cycle) - read directly across BAs of any size. Absolute GW is not
// lost: the tooltip carries it so magnitude is one hover away.

export interface ForecastCompareSeries {
  ba: string;
  color: string;
  data: ForecastData;
}

type Row = { t: number } & Record<string, number | null>;

const histKey = (ba: string) => `${ba}__hist`;
const fcstKey = (ba: string) => `${ba}__fcst`;

// A BA contributes a forward forecast line only if it has at least one
// physically-valid (non-negative) yhat - the same rule buildRows plots by. When
// it has none (e.g. a model emitting negative demand), we surface a quiet note
// so the missing dashed line reads as intentional, not a rendering bug.
function hasValidForecast(s: ForecastCompareSeries): boolean {
  return s.data.points.some((p) => p.yhat !== null && p.yhat >= 0);
}

// Each BA's peak across the visible window (actual + forecast), used as its
// normalization base. Demand is non-negative, so we only consider values >= 0.
function peakOf(s: ForecastCompareSeries): number {
  let peak = 0;
  for (const p of s.data.points) {
    if (p.actual !== null && p.actual >= 0 && p.actual > peak) peak = p.actual;
    if (p.yhat !== null && p.yhat >= 0 && p.yhat > peak) peak = p.yhat;
  }
  if (s.data.lastActual && s.data.lastActual.mwh > peak) peak = s.data.lastActual.mwh;
  return peak;
}

// Merge every BA's points onto a shared timeline, normalized to % of that BA's
// own peak. Per BA: a history series (actual) and a forecast series (yhat). The
// forecast series is seeded with the last actual value at the boundary so the
// dashed line joins the solid one instead of floating a gap.
function buildRows(series: ForecastCompareSeries[], peaks: Map<string, number>): Row[] {
  const byT = new Map<number, Row>();
  const ensure = (t: number): Row => {
    let r = byT.get(t);
    if (!r) {
      r = { t };
      byT.set(t, r);
    }
    return r;
  };
  // Normalize a raw MWh value to a percent of the BA's peak. A non-positive peak
  // (no usable data) yields null so the line simply doesn't draw.
  const pct = (ba: string, mwh: number): number | null => {
    const peak = peaks.get(ba) ?? 0;
    return peak > 0 ? (mwh / peak) * 100 : null;
  };
  for (const s of series) {
    for (const p of s.data.points) {
      const r = ensure(p.t);
      // Demand can't be negative; some BAs' SARIMAX forecasts go wildly negative
      // and would otherwise crater the shared axis. Drop physically-impossible
      // values so a single broken model can't ruin the comparison - that BA then
      // simply shows no forward forecast line.
      if (p.actual !== null && p.actual >= 0) r[histKey(s.ba)] = pct(s.ba, p.actual);
      if (p.yhat !== null && p.yhat >= 0) r[fcstKey(s.ba)] = pct(s.ba, p.yhat);
    }
    if (s.data.lastActual && s.data.lastActual.mwh >= 0) {
      ensure(s.data.lastActual.t)[fcstKey(s.ba)] = pct(s.ba, s.data.lastActual.mwh);
    }
  }
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ payload: Row }>;
  series: ForecastCompareSeries[];
  peaks: Map<string, number>;
}

function CompareTooltip({ active, payload, series, peaks }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded border border-border bg-bg px-3 py-2 text-xs">
      <div className="text-muted">
        {new Date(row.t).toLocaleString("en-US", {
          weekday: "short",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })}
      </div>
      <div className="mt-1 space-y-0.5">
        {series.map((s) => {
          const hist = row[histKey(s.ba)];
          const fcst = row[fcstKey(s.ba)];
          // Prefer the actual; fall back to the forecast when past "now".
          const isForecast = hist == null && fcst != null;
          const pct = hist ?? fcst;
          if (pct == null) return null;
          // Recover absolute GW from the normalized value so magnitude is never
          // lost to normalization - the shape comparison stays on the axis, the
          // real numbers stay one hover away.
          const peak = peaks.get(s.ba) ?? 0;
          const gw = (pct / 100) * peak;
          return (
            <div key={s.ba} className="flex items-center justify-between gap-6">
              <span className="inline-flex items-center gap-1.5 text-muted">
                <span
                  className="inline-block h-2 w-2 rounded-[1px]"
                  style={{ backgroundColor: s.color }}
                />
                {s.ba}
                {isForecast && <span className="text-muted/70">· fcst</span>}
              </span>
              <span className="font-mono tabular-nums text-text">
                {pct.toFixed(0)}%
                <span className="text-muted"> · {(gw / 1_000).toFixed(1)} GW</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Legend({ series }: { series: ForecastCompareSeries[] }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
      {series.map((s) => (
        <span key={s.ba} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4" style={{ backgroundColor: s.color }} />
          {s.ba}
          {!hasValidForecast(s) && (
            <span className="text-muted/60">(no valid forecast)</span>
          )}
        </span>
      ))}
      <span className="ml-auto inline-flex items-center gap-3 text-muted/80">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-current" />
          actual
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-0.5 w-4"
            style={{
              backgroundImage:
                "repeating-linear-gradient(90deg, currentColor 0 4px, transparent 4px 7px)",
            }}
          />
          forecast
        </span>
      </span>
    </div>
  );
}

export function ForecastCompareChart({ series }: { series: ForecastCompareSeries[] }) {
  const { border, grid, muted } = useThemeColors();
  const peaks = new Map(series.map((s) => [s.ba, peakOf(s)]));
  const rows = buildRows(series, peaks);
  const boundaries = series
    .map((s) => s.data.boundaryT)
    .filter((t): t is number => t !== null);
  const boundary = boundaries.length ? Math.max(...boundaries) : null;

  return (
    <div>
      <Legend series={series} />
      <div className="h-[340px] w-full" role="img" aria-label="Line chart comparing normalized demand forecasts across balancing authorities">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
            <CartesianGrid stroke={grid} vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={formatHour}
              tick={{ fontSize: 11, fill: muted }}
              tickLine={false}
              tickMargin={10}
              axisLine={{ stroke: border }}
              minTickGap={48}
            />
            <YAxis
              tickFormatter={(v: number) => `${v}%`}
              tick={{ fontSize: 11, fill: muted }}
              tickLine={false}
              tickMargin={8}
              axisLine={false}
              width={44}
              // Normalized to % of each BA's own peak; floor at 0 (demand is
              // non-negative) and give a little headroom above 100 for forecasts
              // that nose above a BA's realized peak.
              domain={[0, (max: number) => Math.max(105, Math.ceil(max / 10) * 10)]}
            />
            <Tooltip
              content={<CompareTooltip series={series} peaks={peaks} />}
              cursor={{ stroke: muted, strokeWidth: 1, strokeDasharray: "3 3" }}
            />
            {boundary !== null && (
              <ReferenceLine
                x={boundary}
                stroke={muted}
                strokeDasharray="3 3"
                label={{ value: "now", fill: muted, fontSize: 11, position: "insideTopRight" }}
              />
            )}
            {series.flatMap((s) => [
              <Line
                key={histKey(s.ba)}
                type="monotone"
                dataKey={histKey(s.ba)}
                stroke={s.color}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                connectNulls
              />,
              <Line
                key={fcstKey(s.ba)}
                type="monotone"
                dataKey={fcstKey(s.ba)}
                stroke={s.color}
                strokeWidth={1.75}
                strokeDasharray="5 3"
                dot={false}
                isAnimationActive={false}
                connectNulls
              />,
            ])}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
