import type { Config } from "tailwindcss";

/**
 * Executive / Bloomberg-terminal theme.
 * Near-monochrome palette with exactly ONE accent (a calm blue). No semantic
 * rainbow - directionality (deltas) is expressed with glyphs in primary/muted
 * text, never with extra colors.
 *
 * Colors resolve to CSS custom properties (RGB channel triples) defined per
 * theme in globals.css - dark on :root, light on `html.light` - so a single set
 * of utilities serves both modes. The `rgb(var(--x) / <alpha-value>)` form is
 * what keeps opacity modifiers like `text-muted/40` working across themes.
 */
const channel = (v: string) => `rgb(var(${v}) / <alpha-value>)`;

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: channel("--c-bg"), // page background
        surface: channel("--c-surface"), // cards / panels
        "surface-hover": channel("--c-surface-hover"),
        border: channel("--c-border"), // hairline dividers
        text: channel("--c-text"), // primary text
        muted: channel("--c-muted"), // labels, secondary text
        accent: channel("--c-accent"), // the one accent: chart line, live dot, active tab
        "accent-dim": "rgb(var(--c-accent) / 0.10)",
        // Status is the one sanctioned color exception (freshness, validation,
        // anomaly severity). Muted, desaturated so they read as signal, not alarm.
        // Single source of truth - mirrored in lib/theme-colors.ts for SVG/inline use.
        positive: channel("--c-positive"), // ok / pass / healthy
        caution: channel("--c-caution"), // warn / stale / advisory
        critical: channel("--c-critical"), // fail / error / critical
      },
      boxShadow: {
        // Card lift that softens to near-nothing in light mode (the shadow color
        // is theme-driven), instead of a hard black drop on white.
        card: "0 1px 2px var(--c-card-shadow)",
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
