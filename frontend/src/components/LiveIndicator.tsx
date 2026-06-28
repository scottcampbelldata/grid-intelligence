// Honest connection/freshness state. Unlike a binary live/offline flag, this
// distinguishes four cases the dashboard actually has: still waiting on the
// first response, fresh, gone stale (data is arriving but old), and offline
// (fetch failing). The dot color and label follow the status palette.
export type Freshness = "connecting" | "live" | "stale" | "offline";

const STYLES: Record<Freshness, { dot: string; label: string; ping: boolean; pulse: boolean }> = {
  connecting: { dot: "bg-muted", label: "Connecting", ping: false, pulse: true },
  live: { dot: "bg-accent", label: "Live", ping: true, pulse: false },
  stale: { dot: "bg-caution", label: "Stale", ping: false, pulse: false },
  offline: { dot: "bg-critical", label: "Offline", ping: false, pulse: false },
};

export function LiveIndicator({ status }: { status: Freshness }) {
  const s = STYLES[status];
  return (
    <span
      className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-muted"
      role="status"
      aria-live="polite"
      aria-label={`Connection status: ${s.label}`}
    >
      <span className="relative flex h-1.5 w-1.5">
        {s.ping && (
          <span
            className={`absolute inline-flex h-full w-full rounded-full ${s.dot} animate-ping opacity-50`}
          />
        )}
        <span
          className={`relative inline-flex h-1.5 w-1.5 rounded-full ${s.dot} ${
            s.pulse ? "animate-pulse" : ""
          }`}
        />
      </span>
      {s.label}
    </span>
  );
}

/** Derive freshness from the active tab's last-updated time and error. */
export function freshnessOf(
  lastUpdated: Date | null,
  now: Date,
  error: string | null,
  staleAfterMs = 5 * 60_000,
): Freshness {
  if (error) return "offline";
  if (!lastUpdated) return "connecting";
  return now.getTime() - lastUpdated.getTime() > staleAfterMs ? "stale" : "live";
}
