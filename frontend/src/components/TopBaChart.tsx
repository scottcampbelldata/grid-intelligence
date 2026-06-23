"use client";

import type { BaDemand } from "@/lib/api";
import { HBarChart } from "./HBarChart";

// Thin wrapper over the reusable HBarChart: top balancing authorities by
// average demand (GW) over the window.
export function TopBaChart({ data }: { data: BaDemand[] }) {
  return (
    <HBarChart
      data={data.map((d) => ({ label: d.baCode, value: d.avgMw / 1_000 }))}
      maxBars={10}
      decimals={1}
      unit="GW"
    />
  );
}
