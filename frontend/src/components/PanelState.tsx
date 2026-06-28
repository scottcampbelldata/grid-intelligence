import type { ReactNode } from "react";
import { Skeleton } from "./Skeleton";

// The body state for a panel whose data isn't ready to render as the real
// content. Centralizes the three non-ready states so every tab handles them
// identically - and, critically, so a failed fetch shows an *error* (with retry)
// instead of a perpetual "Loading…" (the bug this replaces).
//
// Precedence: loading → skeleton, else error → error + retry, else → empty.
// (Tabs only mount this when there's no content to show; when stale data is on
// screen during a refresh error, the data stays and the ErrorBanner carries the
// error instead.)

type SkeletonVariant = "chart" | "bars" | "table";

interface Props {
  loading: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** Min height so the panel doesn't collapse and content doesn't jump on load. */
  minHeight?: number;
  /** Shown when loaded successfully but there's nothing to display. */
  empty?: ReactNode;
  /** Optional second line under the empty headline (context, e.g. publish lag). */
  emptyDetail?: ReactNode;
  variant?: SkeletonVariant;
}

export function PanelState({
  loading,
  error,
  onRetry,
  minHeight = 280,
  empty = "No data available.",
  emptyDetail,
  variant = "chart",
}: Props) {
  if (loading) {
    return (
      <div role="status" aria-busy="true" style={{ minHeight }} className="w-full">
        <span className="sr-only">Loading…</span>
        <LoadingSkeleton variant={variant} minHeight={minHeight} />
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{ minHeight }}
        className="flex flex-col items-center justify-center gap-3 px-6 text-center"
      >
        <WarningGlyph />
        <div className="space-y-1">
          <p className="text-sm text-text">Couldn&apos;t load this data</p>
          <p className="mx-auto max-w-md break-words text-xs text-muted">{error}</p>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-1 rounded border border-border px-3 py-1.5 text-xs text-accent transition-colors hover:border-accent/60 hover:bg-accent-dim"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      style={{ minHeight }}
      className="flex flex-col items-center justify-center gap-1.5 px-6 text-center"
    >
      <span className="text-sm text-muted">{empty}</span>
      {emptyDetail && <span className="max-w-md text-xs text-muted/80">{emptyDetail}</span>}
    </div>
  );
}

function LoadingSkeleton({
  variant,
  minHeight,
}: {
  variant: SkeletonVariant;
  minHeight: number;
}) {
  if (variant === "bars") {
    // A descending stack of horizontal bars, echoing the HBar charts.
    const widths = [92, 78, 64, 55, 47, 38, 30];
    return (
      <div className="flex flex-col gap-3 py-2" style={{ minHeight }}>
        {widths.map((w, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-3 w-16 shrink-0" />
            <Skeleton className="h-4" style={{ width: `${w}%` }} />
          </div>
        ))}
      </div>
    );
  }

  if (variant === "table") {
    return (
      <div className="flex flex-col gap-2" style={{ minHeight }}>
        <Skeleton className="h-6 w-full opacity-70" />
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }

  // chart: a faint axis with a large plotting-area block.
  return (
    <div className="flex h-full flex-col gap-3" style={{ minHeight }}>
      <Skeleton className="min-h-0 flex-1" />
      <div className="flex justify-between gap-2 pl-10">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-10" />
        ))}
      </div>
    </div>
  );
}

function WarningGlyph() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-critical"
      aria-hidden
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
