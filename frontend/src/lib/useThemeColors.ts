"use client";

import { useTheme } from "@/components/ThemeProvider";
import { toneOf } from "./status";
import { seriesColorFrom } from "./palette";
import { THEME_COLORS, type ThemeColors } from "./theme-colors";

export interface ThemeColorApi extends ThemeColors {
  /** Color for the i-th comparison series, wrapping the active palette. */
  seriesColor: (i: number) => string;
  /** Map a raw API status string onto the active theme's status color. */
  statusColor: (raw: string) => string;
}

// The colors charts need, bound to the active theme. Re-renders when the theme
// flips (it subscribes to the provider context), so every chart/map updates in
// lockstep with the Tailwind-driven chrome.
export function useThemeColors(): ThemeColorApi {
  const { resolvedTheme } = useTheme();
  const c = THEME_COLORS[resolvedTheme];
  return {
    ...c,
    seriesColor: (i: number) => seriesColorFrom(c.series, i),
    statusColor: (raw: string) => c.status[toneOf(raw)],
  };
}
