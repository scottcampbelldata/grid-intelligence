"use client";

import { useRef } from "react";
import { useTheme, type ThemeMode } from "./ThemeProvider";

// Segmented System / Light / Dark control in the executive style: a hairline
// pill, the active segment lifted with the accent-dim wash. WAI-ARIA radiogroup
// semantics with roving-focus arrow navigation, matching TabNav.
const OPTIONS: { mode: ThemeMode; label: string; Icon: () => JSX.Element }[] = [
  { mode: "system", label: "System", Icon: SystemIcon },
  { mode: "light", label: "Light", Icon: SunIcon },
  { mode: "dark", label: "Dark", Icon: MoonIcon },
];

export function ThemeToggle() {
  const { mode, setMode } = useTheme();
  const btnRefs = useRef(new Map<ThemeMode, HTMLButtonElement>());

  function onKeyDown(e: React.KeyboardEvent) {
    const i = OPTIONS.findIndex((o) => o.mode === mode);
    let next = i;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = (i + 1) % OPTIONS.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = (i - 1 + OPTIONS.length) % OPTIONS.length;
        break;
      default:
        return;
    }
    e.preventDefault();
    const target = OPTIONS[next].mode;
    setMode(target);
    btnRefs.current.get(target)?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      onKeyDown={onKeyDown}
      className="inline-flex items-center gap-0.5 rounded-full border border-border p-0.5"
    >
      {OPTIONS.map(({ mode: m, label, Icon }) => {
        const active = m === mode;
        return (
          <button
            key={m}
            ref={(el) => {
              if (el) btnRefs.current.set(m, el);
              else btnRefs.current.delete(m);
            }}
            type="button"
            role="radio"
            aria-checked={active}
            // Roving tabindex: only the selected segment is in the tab order.
            tabIndex={active ? 0 : -1}
            onClick={() => setMode(m)}
            title={`${label} theme`}
            className={`flex h-6 w-6 items-center justify-center rounded-full transition-colors ${
              active
                ? "bg-accent-dim text-accent"
                : "text-muted hover:text-text"
            }`}
          >
            <Icon />
            <span className="sr-only">{label} theme</span>
          </button>
        );
      })}
    </div>
  );
}

// 14px line icons, drawn in currentColor to inherit the segment's text color.
function SystemIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}
