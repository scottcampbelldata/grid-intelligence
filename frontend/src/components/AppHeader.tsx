import { timeAgo } from "@/lib/format";
import { LiveIndicator } from "./LiveIndicator";

interface Props {
  live: boolean;
  lastUpdated: Date | null;
  now: Date;
}

export function AppHeader({ live, lastUpdated, now }: Props) {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-shell items-center justify-between px-6 py-4">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[15px] font-semibold tracking-tight text-text">
            Grid intelligence
          </h1>
          <span className="hidden text-xs text-muted sm:inline">
            US &amp; European electricity grids
          </span>
        </div>
        <div className="flex items-center gap-5">
          <span className="text-xs text-muted">Updated {timeAgo(lastUpdated, now)}</span>
          <LiveIndicator live={live} />
        </div>
      </div>
    </header>
  );
}
