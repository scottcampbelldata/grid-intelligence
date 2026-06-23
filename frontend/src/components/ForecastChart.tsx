"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatGwTick, formatHour } from "@/lib/format";
import type { ForecastPoint } from "@/lib/api";

const ACCENT = "#4f8bf5";
const ACTUAL = "#c7ccd6"; // neutral light - realized history
const BORDER = "#23262d";
const GRID = "#1a1d23";
const MUTED = "#8b919e";

interface Row extends ForecastPoint {
  band: [number, number] | null;
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ payload: Row }>;
}

function gw(v: number | null): string {
  return v === null ? "-" : `${(v / 1_000).toFixed(1)} GW`;
}

function ForecastTooltip({ active, payload }: TooltipProps) {
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
      <div className="mt-1 space-y-0.5">
        {p.actual !== null && (
          <div className="flex items-center justify-between gap-6">
            <span className="text-muted">Actual</span>
            <span className="font-mono tabular-nums text-text">{gw(p.actual)}</span>
          </div>
        )}
        {p.yhat !== null && (
          <div className="flex items-center justify-between gap-6">
            <span className="text-muted">Forecast</span>
            <span className="font-mono tabular-nums text-text">{gw(p.yhat)}</span>
          </div>
        )}
        {p.lower !== null && p.upper !== null && (
          <div className="flex items-center justify-between gap-6">
            <span className="text-muted">Band</span>
            <span className="font-mono tabular-nums text-muted">
              {(p.lower / 1_000).toFixed(1)}-{(p.upper / 1_000).toFixed(1)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-0.5 w-4" style={{ backgroundColor: ACTUAL }} />
        Actual
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className="inline-block h-0.5 w-4"
          style={{
            backgroundImage: `repeating-linear-gradient(90deg, ${ACCENT} 0 4px, transparent 4px 7px)`,
          }}
        />
        Forecast
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className="inline-block h-2 w-4 rounded-[1px]"
          style={{ backgroundColor: "rgba(79,139,245,0.18)" }}
        />
        Confidence band
      </span>
    </div>
  );
}

export function ForecastChart({
  points,
  boundaryT,
}: {
  points: ForecastPoint[];
  boundaryT: number | null;
}) {
  const data: Row[] = points.map((p) => ({
    ...p,
    band: p.lower !== null && p.upper !== null ? [p.lower, p.upper] : null,
  }));

  // Bridge the gap between the last actual and the first forecast: seed the
  // forecast (yhat) at the boundary - the last actual point - with the actual
  // value, so the dashed forecast line starts exactly where the solid actual
  // line ends and flows continuously through "now". Forecasts often lag the
  // latest actual by hours; without this the two segments float apart with an
  // empty hole between them.
  const boundary = boundaryT !== null ? data.find((r) => r.t === boundaryT) : undefined;
  if (boundary && boundary.yhat === null && boundary.actual !== null) {
    boundary.yhat = boundary.actual;
  }

  return (
    <div>
      <Legend />
      <div className="h-[340px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
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
              // Demand is non-negative - floor at 0 so an unstable forecast that
              // dips below zero can't open negative axis space.
              domain={[0, "auto"]}
            />
            <Tooltip
              content={<ForecastTooltip />}
              cursor={{ stroke: MUTED, strokeWidth: 1, strokeDasharray: "3 3" }}
            />
            {boundaryT !== null && (
              <ReferenceLine
                x={boundaryT}
                stroke={MUTED}
                strokeDasharray="3 3"
                label={{ value: "now", fill: MUTED, fontSize: 11, position: "insideTopRight" }}
              />
            )}
            <Area
              dataKey="band"
              stroke="none"
              fill={ACCENT}
              fillOpacity={0.14}
              isAnimationActive={false}
              connectNulls={false}
            />
            <Line
              dataKey="actual"
              stroke={ACTUAL}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
            />
            <Line
              dataKey="yhat"
              stroke={ACCENT}
              strokeWidth={1.75}
              strokeDasharray="5 3"
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
