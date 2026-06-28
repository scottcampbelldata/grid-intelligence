import type { Config } from "tailwindcss";

/**
 * Executive / Bloomberg-terminal theme.
 * Near-monochrome dark palette with exactly ONE accent (a calm blue).
 * No semantic rainbow - directionality (deltas) is expressed with glyphs in
 * primary/muted text, never with extra colors.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0a0b0e", // page background - near-black
        surface: "#131519", // cards / panels
        "surface-hover": "#1a1d23",
        border: "#23262d", // hairline dividers
        text: "#e5e7eb", // primary text - off-white, not pure white
        muted: "#8b919e", // labels, secondary text
        accent: "#4f8bf5", // the one accent: chart line, live dot, active tab
        "accent-dim": "rgba(79,139,245,0.10)",
        // Status is the one sanctioned color exception (freshness, validation,
        // anomaly severity). Muted, desaturated so they read as signal, not alarm.
        // Single source of truth - mirrored in lib/status.ts for SVG/inline use.
        positive: "#5ea88a", // ok / pass / healthy
        caution: "#c9a45c", // warn / stale / advisory
        critical: "#d08a8a", // fail / error / critical
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      maxWidth: {
        shell: "1400px",
      },
    },
  },
  plugins: [],
};

export default config;
