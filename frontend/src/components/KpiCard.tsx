import type { ReactNode } from "react";
import { formatSignedPct } from "@/lib/format";
import { Skeleton } from "./Skeleton";
import { Sparkline } from "./Sparkline";

interface Props {
  label: string;
  value: string;
  unit?: string;
  sub?: ReactNode;
  loading?: boolean;
  /** Optional 24h trend for the headline metric - rendered as an inline sparkline. */
  spark?: number[];
}

export function KpiCard({ label, value, unit, sub, loading = false, spark }: Props) {
  return (
    <div className="group rounded-md border border-border bg-surface px-5 py-4 shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-colors hover:border-border/80 hover:bg-surface-hover">
      <div className="text-xs uppercase tracking-[0.12em] text-muted">{label}</div>

      {loading ? (
        // Skeleton sized to the eventual numeral so the card doesn't resize on
        // load. Matches the value/sub rows below in height.
        <>
          <Skeleton className="mt-3 h-8 w-28" />
          <div className="mt-2 h-4">
            <Skeleton className="h-3 w-20" />
          </div>
        </>
      ) : (
        <>
          <div className="mt-3 flex items-end justify-between gap-3">
            <div className="flex items-baseline">
              <span className="font-mono text-[2rem] font-medium leading-none tracking-[-0.02em] tabular-nums text-text">
                {value}
              </span>
              {unit && <span className="ml-1.5 text-sm font-normal text-muted">{unit}</span>}
            </div>
            {spark && spark.length > 1 && (
              <Sparkline values={spark} className="mb-0.5 shrink-0 opacity-90" />
            )}
          </div>
          <div className="mt-2 h-4 text-xs text-muted">{sub}</div>
        </>
      )}
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
