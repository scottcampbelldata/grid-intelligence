"use client";

import { useRef } from "react";
import { slugify } from "@/lib/useTabRouting";

// The 8+ planned tabs. Tabs are enabled as they're built; disabled ones render
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

/** Stable ids so the tabpanel can be associated back to its tab for a11y. */
export const tabId = (tab: TabName) => `tab-${slugify(tab)}`;
export const tabPanelId = (tab: TabName) => `tabpanel-${slugify(tab)}`;

interface Props {
  active: TabName;
  enabled: readonly TabName[];
  onSelect: (tab: TabName) => void;
}

export function TabNav({ active, enabled, onSelect }: Props) {
  const enabledSet = new Set(enabled);
  const btnRefs = useRef(new Map<TabName, HTMLButtonElement>());

  // Roving-focus arrow-key navigation across the *enabled* tabs (WAI-ARIA
  // tablist pattern, automatic activation). Left/Right wrap; Home/End jump.
  function onKeyDown(e: React.KeyboardEvent) {
    const order = TABS.filter((t) => enabledSet.has(t));
    if (order.length === 0) return;
    const i = order.indexOf(active);
    let next = i;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = (i + 1) % order.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = (i - 1 + order.length) % order.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = order.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    const target = order[next];
    onSelect(target);
    btnRefs.current.get(target)?.focus();
  }

  return (
    // The fade overlays hint that the bar scrolls horizontally when tabs overflow
    // (notably on mobile, where all 10 don't fit).
    <nav className="relative border-b border-border" aria-label="Dashboard sections">
      <div
        className="mx-auto flex max-w-shell gap-1 overflow-x-auto px-4"
        role="tablist"
        aria-label="Dashboard sections"
        onKeyDown={onKeyDown}
      >
        {TABS.map((tab) => {
          const isActive = tab === active;
          const isEnabled = enabledSet.has(tab);
          return (
            <button
              key={tab}
              ref={(el) => {
                if (el) btnRefs.current.set(tab, el);
                else btnRefs.current.delete(tab);
              }}
              type="button"
              role="tab"
              id={tabId(tab)}
              aria-controls={tabPanelId(tab)}
              aria-selected={isActive}
              aria-disabled={!isEnabled || undefined}
              // Roving tabindex: only the active tab is in the tab order; arrows
              // move between the rest.
              tabIndex={isActive ? 0 : -1}
              disabled={!isEnabled}
              onClick={() => isEnabled && onSelect(tab)}
              className={`relative whitespace-nowrap px-3 py-3 text-sm transition-colors ${
                isActive
                  ? "text-text"
                  : isEnabled
                    ? "cursor-pointer text-muted hover:text-text"
                    : "cursor-not-allowed text-muted/40"
              }`}
            >
              {tab}
              {isActive && <span className="absolute inset-x-3 -bottom-px h-px bg-accent" />}
            </button>
          );
        })}
      </div>
      {/* Edge fades - pure affordance, never intercept clicks. */}
      <span className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-bg to-transparent" />
      <span className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-bg to-transparent" />
    </nav>
  );
}
