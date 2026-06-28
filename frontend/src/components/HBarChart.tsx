"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useThemeColors } from "@/lib/useThemeColors";

// Reusable ranked horizontal bar chart in the executive style: single accent,
// value labels at bar ends, quiet vertical gridlines. Used by the Demand
// (top BAs) and Generation (fuel share) tabs, and any future ranked breakdown.
const ROW_HEIGHT = 30; // px per bar

export interface HBarDatum {
  label: string;
  value: number;
}

interface Props {
  data: HBarDatum[];
  maxBars?: number;
  decimals?: number;
  unit?: string; // shown in the tooltip (e.g. "GW", "%")
  labelWidth?: number; // width of the category (y) axis
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ payload: HBarDatum }>;
  decimals: number;
  unit: string;
}

function ChartTooltip({ active, payload, decimals, unit }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded border border-border bg-bg px-3 py-2 text-xs">
      <div className="text-muted">{p.label}</div>
      <div className="mt-0.5 font-mono tabular-nums text-text">
        {p.value.toFixed(decimals)}
        {unit ? ` ${unit}` : ""}
      </div>
    </div>
  );
}

export function HBarChart({
  data,
  maxBars = 12,
  decimals = 1,
  unit = "",
  labelWidth = 64,
}: Props) {
  const { accent, border, grid, muted, text, overlay } = useThemeColors();
  const rows = data.slice(0, maxBars);
  const height = rows.length * ROW_HEIGHT + 24;

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 4, right: 44, bottom: 4, left: 8 }}
          barCategoryGap={8}
        >
          <CartesianGrid stroke={grid} horizontal={false} />
          <XAxis
            type="number"
            allowDecimals={false}
            tickFormatter={(v) => `${Math.round(v)}`}
            tick={{ fontSize: 11, fill: muted }}
            tickLine={false}
            tickMargin={10}
            axisLine={{ stroke: border }}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={labelWidth}
            tick={{ fontSize: 11, fill: muted }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            content={<ChartTooltip decimals={decimals} unit={unit} />}
            cursor={{ fill: overlay.barCursor }}
          />
          <Bar
            dataKey="value"
            fill={accent}
            fillOpacity={0.9}
            radius={[0, 2, 2, 0]}
            isAnimationActive={false}
          >
            <LabelList
              dataKey="value"
              position="right"
              formatter={(v: number) => v.toFixed(decimals)}
              style={{ fill: text, fontSize: 11, fontFamily: "var(--font-mono)" }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
