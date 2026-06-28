"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatHour } from "@/lib/format";

// Overlays the demand curves of a handful of balancing authorities (2-5). Each
// BA is a restrained, distinct line from the shared series palette; the
// caller caps the count so the overlay stays legible rather than spaghetti.
const BORDER = "#23262d";
const GRID = "#1a1d23";
const MUTED = "#8b919e";

export interface CompareLine {
  ba: string;
  color: string;
}

// Rows are wide-format: { t, [ba]: mwh, ... }. A missing BA value at an hour
// renders as a gap (connectNulls keeps the line continuous across it).
export type CompareRow = { t: number } & Record<string, number | null>;

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number | null; payload: CompareRow }>;
  lines: CompareLine[];
}

function CompareTooltip({ active, payload, lines }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const t = payload[0]?.payload?.t;
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
        {lines.map((l) => {
          const v = payload.find((p) => p.dataKey === l.ba)?.value;
          return (
            <div key={l.ba} className="flex items-center justify-between gap-6">
              <span className="inline-flex items-center gap-1.5 text-muted">
                <span
                  className="inline-block h-2 w-2 rounded-[1px]"
                  style={{ backgroundColor: l.color }}
                />
                {l.ba}
              </span>
              <span className="font-mono tabular-nums text-text">
                {v == null ? "-" : `${(v / 1_000).toFixed(1)} GW`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DemandCompareChart({
  rows,
  lines,
}: {
  rows: CompareRow[];
  lines: CompareLine[];
}) {
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1.5">
        {lines.map((l) => (
          <span key={l.ba} className="inline-flex items-center gap-1.5 text-xs text-muted">
            <span
              className="inline-block h-2 w-2 rounded-[1px]"
              style={{ backgroundColor: l.color }}
            />
            {l.ba}
          </span>
        ))}
      </div>
      <div className="h-[320px] w-full" role="img" aria-label="Line chart comparing electricity demand across balancing authorities">
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
              tickFormatter={(v) => `${Math.round(v / 1_000)}`}
              tick={{ fontSize: 11, fill: MUTED }}
              tickLine={false}
              tickMargin={8}
              axisLine={false}
              width={44}
              domain={["auto", "auto"]}
            />
            <Tooltip
              content={<CompareTooltip lines={lines} />}
              cursor={{ stroke: MUTED, strokeWidth: 1, strokeDasharray: "3 3" }}
            />
            {lines.map((l) => (
              <Line
                key={l.ba}
                type="monotone"
                dataKey={l.ba}
                stroke={l.color}
                strokeWidth={1.75}
                dot={false}
                activeDot={{ r: 3, fill: l.color, stroke: "none" }}
                isAnimationActive={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
