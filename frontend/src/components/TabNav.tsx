"use client";

// The 8 planned tabs. Tabs are enabled as they're built; disabled ones render
// as non-interactive placeholders so the information architecture stays visible.
export const TABS = [
  "Demand",
  "Generation",
  "Interchange",
  "Anomalies",
  "Forecast",
  "Weather",
  "Europe",
  "Europe Weather",
  "Data Quality",
  "Operations",
] as const;

export type TabName = (typeof TABS)[number];

interface Props {
  active: TabName;
  enabled: readonly TabName[];
  onSelect: (tab: TabName) => void;
}

export function TabNav({ active, enabled, onSelect }: Props) {
  const enabledSet = new Set(enabled);
  return (
    <nav className="border-b border-border">
      <div className="mx-auto flex max-w-shell gap-1 overflow-x-auto px-4">
        {TABS.map((tab) => {
          const isActive = tab === active;
          const isEnabled = enabledSet.has(tab);
          return (
            <button
              key={tab}
              type="button"
              disabled={!isEnabled}
              onClick={() => isEnabled && onSelect(tab)}
              aria-current={isActive ? "page" : undefined}
              className={`relative whitespace-nowrap px-3 py-3 text-sm transition-colors ${
                isActive
                  ? "text-text"
                  : isEnabled
                    ? "cursor-pointer text-muted hover:text-text"
                    : "cursor-not-allowed text-muted/50"
              }`}
            >
              {tab}
              {isActive && <span className="absolute inset-x-3 -bottom-px h-px bg-accent" />}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
