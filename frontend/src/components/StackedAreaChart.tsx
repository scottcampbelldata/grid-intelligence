"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatHour } from "@/lib/format";
import { useThemeColors } from "@/lib/useThemeColors";
import type { GenBand, GenStackPoint } from "@/lib/api";

// Generic stacked-area chart (GW) used wherever a quantity decomposes into a
// handful of named bands over time - Generation (fuel mix) and Europe (load by
// bidding zone). Bands are pre-grouped (top-N + "Other") by the caller. The band
// ramp (up to 8 distinguishable tones + an "Other" rollup) is theme-aware and
// lives in lib/theme-colors.ts.

interface ColoredBand {
  label: string;
  color: string;
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; payload: GenStackPoint }>;
  bands: ColoredBand[];
}

function StackTooltip({ active, payload, bands }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const t = payload[0]?.payload?.t;
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0);
  return (
    <div className="rounded border border-border bg-bg px-3 py-2 text-xs">
      <div className="text-muted">
        {new Date(t).toLocaleString("en-US", {
          weekday: "short",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })}
      </div>
      <div className="mt-1 space-y-0.5">
        {bands.map((b) => {
          const v = payload.find((p) => p.dataKey === b.label)?.value ?? 0;
          return (
            <div key={b.label} className="flex items-center justify-between gap-6">
              <span className="inline-flex items-center gap-1.5 text-muted">
                <span
                  className="inline-block h-2 w-2 rounded-[1px]"
                  style={{ backgroundColor: b.color }}
                />
                {b.label}
              </span>
              <span className="font-mono tabular-nums text-text">{(v / 1_000).toFixed(1)}</span>
            </div>
          );
        })}
        <div className="mt-0.5 flex items-center justify-between gap-6 border-t border-border pt-1">
          <span className="text-muted">Total</span>
          <span className="font-mono tabular-nums text-text">{(total / 1_000).toFixed(1)} GW</span>
        </div>
      </div>
    </div>
  );
}

export function StackedAreaChart({
  series,
  bands,
}: {
  series: GenStackPoint[];
  bands: GenBand[];
}) {
  const tc = useThemeColors();
  const colorFor = (band: GenBand, i: number): string =>
    band.code === "__other__" ? tc.bandOther : (tc.bands[i] ?? tc.bandOther);
  const colored: ColoredBand[] = bands.map((b, i) => ({
    label: b.label,
    color: colorFor(b, i),
  }));

  // A stacked area needs at least two time points to draw a shape; with a single
  // point Recharts renders nothing but a column of dots, which reads as a broken
  // chart. Show the band legend plus a clear note instead (the source sometimes
  // publishes only the latest hour - e.g. EIA generation mix lagging).
  const tooFewPoints = series.length < 2;

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1.5">
        {colored.map((b) => (
          <span key={b.label} className="inline-flex items-center gap-1.5 text-xs text-muted">
            <span
              className="inline-block h-2 w-2 rounded-[1px]"
              style={{ backgroundColor: b.color }}
            />
            {b.label}
          </span>
        ))}
      </div>
      {tooFewPoints ? (
        <div className="flex h-[320px] items-center justify-center px-6 text-center text-sm text-muted">
          <span className="max-w-md">
            Only one hour of data is available right now - a stacked time series
            needs at least two points, and will fill in as more is published.
          </span>
        </div>
      ) : (
        <div className="h-[320px] w-full" role="img" aria-label="Stacked area chart of generation by fuel type over time">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
            <CartesianGrid stroke={tc.grid} vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={formatHour}
              tick={{ fontSize: 11, fill: tc.muted }}
              tickLine={false}
              tickMargin={10}
              axisLine={{ stroke: tc.border }}
              minTickGap={48}
            />
            <YAxis
              tickFormatter={(v) => `${Math.round(v / 1_000)}`}
              tick={{ fontSize: 11, fill: tc.muted }}
              tickLine={false}
              tickMargin={8}
              axisLine={false}
              width={44}
            />
            <Tooltip
              content={<StackTooltip bands={colored} />}
              cursor={{ stroke: tc.muted, strokeWidth: 1, strokeDasharray: "3 3" }}
            />
            {colored.map((b) => (
              <Area
                key={b.label}
                type="monotone"
                dataKey={b.label}
                stackId="stack"
                stroke={b.color}
                strokeWidth={0.75}
                fill={b.color}
                fillOpacity={0.85}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
