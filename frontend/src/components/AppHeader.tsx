import { timeAgo } from "@/lib/format";
import { freshnessOf, LiveIndicator } from "./LiveIndicator";
import { ThemeToggle } from "./ThemeToggle";

interface Props {
  lastUpdated: Date | null;
  now: Date;
  error: string | null;
}

export function AppHeader({ lastUpdated, now, error }: Props) {
  const status = freshnessOf(lastUpdated, now, error);
  return (
    <div className="border-b border-border">
      <div className="mx-auto flex max-w-shell flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 py-3">
        <p className="text-sm text-muted">
          US and European electricity grids, refreshed from public sources
        </p>
        <div className="flex items-center gap-5">
          <span className="hidden text-sm text-muted sm:inline">
            Updated {timeAgo(lastUpdated, now)}
          </span>
          <LiveIndicator status={status} />
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}
