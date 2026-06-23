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
import { formatGwTick, formatHour } from "@/lib/format";
import type { ForecastData } from "@/lib/api";

// Compares the forecasts of 2-3 balancing authorities. Each BA is ONE colored
// line that runs solid through realized history and dashed through the forecast
// horizon, meeting at a single shared "now" divider - the same visual language
// as the single-BA chart, extended to a restrained per-BA palette. Confidence
// bands are deliberately dropped here: stacking 2-3 translucent bands turns the
// panel to mush, so bands stay in the single-BA view and comparison stays to
// clean lines.
const BORDER = "#23262d";
const GRID = "#1a1d23";
const MUTED = "#8b919e";

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

// Merge every BA's points onto a shared timeline. Per BA: a history series
// (actual) and a forecast series (yhat). The forecast series is seeded with the
// last actual value at the boundary so the dashed line joins the solid one
// instead of floating a gap.
function buildRows(series: ForecastCompareSeries[]): Row[] {
  const byT = new Map<number, Row>();
  const ensure = (t: number): Row => {
    let r = byT.get(t);
    if (!r) {
      r = { t };
      byT.set(t, r);
    }
    return r;
  };
  for (const s of series) {
    for (const p of s.data.points) {
      const r = ensure(p.t);
      // Demand can't be negative; some BAs' SARIMAX forecasts go wildly negative
      // and would otherwise crater the shared y-axis. Drop physically-impossible
      // values so a single broken model can't ruin the comparison - that BA then
      // simply shows no forward forecast line.
      if (p.actual !== null && p.actual >= 0) r[histKey(s.ba)] = p.actual;
      if (p.yhat !== null && p.yhat >= 0) r[fcstKey(s.ba)] = p.yhat;
    }
    if (s.data.lastActual && s.data.lastActual.mwh >= 0) {
      ensure(s.data.lastActual.t)[fcstKey(s.ba)] = s.data.lastActual.mwh;
    }
  }
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ payload: Row }>;
  series: ForecastCompareSeries[];
}

function CompareTooltip({ active, payload, series }: TooltipProps) {
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
          const v = hist ?? fcst;
          if (v == null) return null;
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
                {(v / 1_000).toFixed(1)} GW
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
  const rows = buildRows(series);
  const boundaries = series
    .map((s) => s.data.boundaryT)
    .filter((t): t is number => t !== null);
  const boundary = boundaries.length ? Math.max(...boundaries) : null;

  return (
    <div>
      <Legend series={series} />
      <div className="h-[340px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={formatHour}
              tick={{ fontSize: 11, fill: MUTED }}
              tickLine={false}
              tickMargin={10}
              axisLine={{ stroke: BORDER }}
              minTickGap={48}
            />
            <YAxis
              tickFormatter={formatGwTick}
              tick={{ fontSize: 11, fill: MUTED }}
              tickLine={false}
              tickMargin={8}
              axisLine={false}
              width={44}
              // Demand is non-negative - floor at 0 so a stray value can never
              // open negative axis space below the lines.
              domain={[0, "auto"]}
            />
            <Tooltip
              content={<CompareTooltip series={series} />}
              cursor={{ stroke: MUTED, strokeWidth: 1, strokeDasharray: "3 3" }}
            />
            {boundary !== null && (
              <ReferenceLine
                x={boundary}
                stroke={MUTED}
                strokeDasharray="3 3"
                label={{ value: "now", fill: MUTED, fontSize: 11, position: "insideTopRight" }}
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
