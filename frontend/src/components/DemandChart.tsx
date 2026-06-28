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
import type { DemandSeriesPoint } from "@/lib/api";

// Theme tokens referenced directly - Recharts SVG props can't read Tailwind classes.
const ACCENT = "#4f8bf5";
const BORDER = "#23262d"; // panel hairlines / axis baseline
const GRID = "#1a1d23"; // gridlines: one step darker than borders, so they recede
const MUTED = "#8b919e";

// Data points are hourly MWh, which for a one-hour period equals average power
// in MW. We present the axis in GW to match the "Network demand" KPI card.
function yTick(v: number): string {
  return `${Math.round(v / 1_000)}`;
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ payload: DemandSeriesPoint }>;
}

function ChartTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded border border-border bg-bg px-3 py-2 text-xs">
      <div className="text-muted">
        {new Date(p.t).toLocaleString("en-US", {
          weekday: "short",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })}
      </div>
      <div className="mt-0.5 font-mono tabular-nums text-text">
        {(p.mwh / 1_000).toFixed(1)} GW
      </div>
    </div>
  );
}

export function DemandChart({ data }: { data: DemandSeriesPoint[] }) {
  return (
    <div className="h-[320px] w-full" role="img" aria-label="Area chart of electricity demand over time">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
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
            tickFormatter={yTick}
            tick={{ fontSize: 11, fill: MUTED }}
            tickLine={false}
            tickMargin={8}
            axisLine={false}
            width={44}
            // Auto domain - Recharts picks clean round GW steps (400/450/…/600).
            domain={["auto", "auto"]}
          />
          <Tooltip
            content={<ChartTooltip />}
            cursor={{ stroke: MUTED, strokeWidth: 1, strokeDasharray: "3 3" }}
          />
          {/* Single accent line; flat low-opacity fill (no gradient). */}
          <Area
            type="monotone"
            dataKey="mwh"
            stroke={ACCENT}
            strokeWidth={1.75}
            fill={ACCENT}
            fillOpacity={0.07}
            dot={false}
            activeDot={{ r: 3, fill: ACCENT, stroke: "none" }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
