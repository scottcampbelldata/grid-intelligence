// Runtime color source for everything that can't read a Tailwind class: Recharts
// SVG props, react-simple-maps geographies, and inline-styled chart legends.
// These values mirror the CSS custom properties in globals.css (chrome) plus the
// status/series palettes, resolved per theme. UI chrome stays driven by Tailwind
// tokens; this is the parallel set for charts, selected by the useThemeColors
// hook so charts flip exactly with the rest of the shell.
import { SERIES_DARK, SERIES_LIGHT } from "./palette";
import { STATUS_DARK, STATUS_LIGHT, type StatusMap } from "./status";

export interface ThemeColors {
  bg: string; // tooltip/popover backgrounds (matches page bg token)
  surface: string;
  border: string; // axis baselines, panel hairlines
  grid: string; // gridlines - recede behind the data
  muted: string; // axis ticks, secondary text
  text: string; // value labels on charts
  accent: string; // the single accent line/bar
  accentLine: string; // "actual / realized history" line (neutral, not accent)
  /** Translucent accent fills for inline-styled overlays. */
  overlay: {
    band: string; // forecast confidence-band legend swatch / now-band
    barCursor: string; // hovered-bar background in the ranked bar chart
  };
  /** Map base styling, shared by the US + Europe weather maps. */
  map: {
    land: string;
    landStroke: string;
    markerStroke: string; // resting ring separating a dot from the land
    markerActiveStroke: string; // ring on the hovered dot
    nullFill: string; // dot with no temperature reading
  };
  status: StatusMap;
  series: readonly string[]; // multi-BA comparison lines
  bands: readonly string[]; // stacked-area generation bands (up to 8)
  bandOther: string; // the "Other" rollup band
}

const DARK: ThemeColors = {
  bg: "#13191b",
  surface: "#182023",
  border: "#2b3539",
  grid: "#222c30",
  muted: "#a6b4b9",
  text: "#e6ecee",
  accent: "#8cc1d6",
  accentLine: "#c7ccd6",
  overlay: {
    band: "rgba(140,193,214,0.18)",
    barCursor: "rgba(140,193,214,0.06)",
  },
  map: {
    land: "#26302f",
    landStroke: "#5b6575",
    markerStroke: "#13191b",
    markerActiveStroke: "#e5e7eb",
    nullFill: "#6b7280",
  },
  status: STATUS_DARK,
  series: SERIES_DARK,
  bands: [
    "#4f8bf5", // blue
    "#54a39b", // teal
    "#8b909c", // slate
    "#c2a25e", // gold
    "#6fa07a", // sage
    "#7d7fb8", // periwinkle
    "#bd8a6b", // clay
    "#b3859b", // mauve
  ],
  bandOther: "#3f4654",
};

const LIGHT: ThemeColors = {
  bg: "#ffffff", // tooltips read as white cards on paper
  surface: "#ffffff",
  border: "#d9dfe0",
  grid: "#e6eaeb",
  muted: "#4d5d63",
  text: "#1b2a30",
  accent: "#28566b",
  accentLine: "#9aa0ac", // neutral grey realized-history line on white
  overlay: {
    band: "rgba(40,86,107,0.14)",
    barCursor: "rgba(40,86,107,0.07)",
  },
  map: {
    land: "#e9eeef", // land lifted just off the white panel
    landStroke: "#b9c4c7",
    markerStroke: "#ffffff", // light ring separates a dot from the land
    markerActiveStroke: "#1b2a30",
    nullFill: "#9ca3af",
  },
  status: STATUS_LIGHT,
  series: SERIES_LIGHT,
  bands: [
    "#2f6fe0", // blue
    "#157d72", // teal
    "#5b6470", // slate
    "#9a6b1f", // gold
    "#3f7d54", // sage
    "#5d5fa6", // periwinkle
    "#a35a39", // clay
    "#8a5066", // mauve
  ],
  bandOther: "#b7b3aa",
};

export const THEME_COLORS: Record<"light" | "dark", ThemeColors> = {
  dark: DARK,
  light: LIGHT,
};
