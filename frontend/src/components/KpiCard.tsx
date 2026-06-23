import type { ReactNode } from "react";
import { formatSignedPct } from "@/lib/format";

interface Props {
  label: string;
  value: string;
  unit?: string;
  sub?: ReactNode;
  loading?: boolean;
}

export function KpiCard({ label, value, unit, sub, loading = false }: Props) {
  return (
    <div className="rounded-md border border-border bg-surface px-5 py-4">
      <div className="text-xs uppercase tracking-[0.12em] text-muted">{label}</div>
      <div
        className={`mt-3 flex items-baseline transition-opacity ${
          loading ? "opacity-40" : "opacity-100"
        }`}
      >
        <span className="font-mono text-[2rem] font-medium leading-none tracking-[-0.02em] tabular-nums text-text">
          {value}
        </span>
        {unit && <span className="ml-1.5 text-sm font-normal text-muted">{unit}</span>}
      </div>
      <div className="mt-2 h-4 text-xs text-muted">{sub}</div>
    </div>
  );
}

/**
 * Directional delta in single-accent style: the magnitude is rendered in
 * primary text with a ▲/▼ glyph (no green/red - restraint over semantics).
 */
export function Delta({ pct, suffix = "vs 24h ago" }: { pct: number | null; suffix?: string }) {
  if (pct === null) return <span className="text-muted">- {suffix}</span>;
  const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "■";
  return (
    <span className="text-muted">
      <span className="text-text">
        {arrow} {formatSignedPct(pct)}
      </span>{" "}
      {suffix}
    </span>
  );
}
