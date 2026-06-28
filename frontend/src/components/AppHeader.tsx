import { timeAgo } from "@/lib/format";
import { freshnessOf, LiveIndicator } from "./LiveIndicator";

interface Props {
  lastUpdated: Date | null;
  now: Date;
  error: string | null;
}

export function AppHeader({ lastUpdated, now, error }: Props) {
  const status = freshnessOf(lastUpdated, now, error);
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-shell items-center justify-between gap-4 px-6 py-4">
        <div className="flex items-center gap-3">
          <GridMark />
          <div className="flex items-baseline gap-3">
            <h1 className="text-[15px] font-semibold tracking-tight text-text">
              Grid intelligence
            </h1>
            <span className="hidden text-xs text-muted sm:inline">
              US &amp; European electricity grids
            </span>
          </div>
        </div>
        <div className="flex items-center gap-5">
          <span className="hidden text-xs text-muted sm:inline">
            Updated {timeAgo(lastUpdated, now)}
          </span>
          <LiveIndicator status={status} />
        </div>
      </div>
    </header>
  );
}

// Minimal product mark: an upward signal/grid glyph in the single accent. Small
// enough to read as identity, not decoration; aria-hidden since the wordmark
// beside it carries the name.
function GridMark() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-accent"
      aria-hidden
    >
      <path d="M3 17l5-6 4 3 5-7" />
      <path d="M3 21h18" opacity="0.4" />
      <circle cx="17" cy="7" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}
