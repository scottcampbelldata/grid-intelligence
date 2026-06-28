// Single source of truth for the status palette - the one sanctioned color
// exception in the otherwise near-monochrome theme. Used for source freshness,
// data-quality validation, and anomaly severity. These hex values mirror the
// `positive` / `caution` / `critical` tokens in tailwind.config.ts; they live
// here as plain strings too because Recharts SVG props and inline styles can't
// read Tailwind classes.
export const STATUS = {
  positive: "#5ea88a", // ok / pass / healthy
  caution: "#c9a45c", // warn / stale / high
  critical: "#d08a8a", // fail / error / critical
  neutral: "#8b919e", // muted - matches the theme `muted`
} as const;

export type StatusTone = keyof typeof STATUS;

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

export function statusColor(raw: string): string {
  return STATUS[toneOf(raw)];
}
