// Single source of truth for the status palette - the one sanctioned color
// exception in the otherwise near-monochrome theme. Used for source freshness,
// data-quality validation, and anomaly severity. These hex values mirror the
// `positive` / `caution` / `critical` tokens in globals.css; they live here as
// plain strings too because Recharts SVG props and inline styles can't read
// Tailwind classes. Both themes are defined so charts/badges flip with the UI -
// the dark tones would fail WCAG AA on a light ground, so light has its own,
// deepened set. Pick the right map at runtime via useThemeColors().

export const STATUS_DARK = {
  positive: "#5ea88a", // ok / pass / healthy
  caution: "#c9a45c", // warn / stale / high
  critical: "#d08a8a", // fail / error / critical
  neutral: "#8b919e", // muted - matches the theme `muted`
} as const;

export const STATUS_LIGHT = {
  positive: "#2f7d5b", // deepened green - AA on paper
  caution: "#8a6a22", // deepened amber - the dark gold fails on white
  critical: "#b04a45", // deepened red
  neutral: "#6b7280", // matches the light theme `muted`
} as const;

export type StatusTone = keyof typeof STATUS_DARK;
export type StatusMap = Record<StatusTone, string>;

// Back-compat default (dark). Theme-aware code should prefer useThemeColors().
export const STATUS: StatusMap = STATUS_DARK;

// Map the various status vocabularies the API uses onto one tone.
export function toneOf(raw: string): StatusTone {
  const s = raw.toLowerCase();
  if (s.includes("crit") || s.includes("fail") || s.includes("err")) return "critical";
  if (
    s.includes("warn") ||
    s.includes("stale") ||
    s.includes("high") ||
    s.includes("sev") ||
    s.includes("advis")
  )
    return "caution";
  if (s.includes("ok") || s.includes("pass") || s.includes("success") || s.includes("complete"))
    return "positive";
  return "neutral";
}

export function statusColor(raw: string, map: StatusMap = STATUS_DARK): string {
  return map[toneOf(raw)];
}
