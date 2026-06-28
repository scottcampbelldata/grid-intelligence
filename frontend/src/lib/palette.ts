// Muted, distinguishable series palette - desaturated tones across a controlled
// range (accent blue, teal, warm gold, periwinkle, sage, slate) so overlaid
// lines read clearly without becoming a rainbow. Ordered for adjacent-series
// contrast: the first entries (the comparison caps of 5/3) are the most
// distinct. Shared by the multi-BA comparison overlays on the Demand and
// Forecast tabs. The light set is deepened so the same lines hold contrast on a
// white ground. (The stacked-area bands keep their own ramp in theme-colors.ts.)
export const SERIES_DARK = [
  "#4f8bf5", // accent blue
  "#54a39b", // teal
  "#c2a25e", // warm gold
  "#7d7fb8", // periwinkle
  "#6fa07a", // sage
  "#8b909c", // slate
];

export const SERIES_LIGHT = [
  "#2f6fe0", // accent blue
  "#157d72", // teal
  "#9a6b1f", // warm gold
  "#5d5fa6", // periwinkle
  "#3f7d54", // sage
  "#5b6470", // slate
];

// Back-compat default (dark). Theme-aware code should prefer useThemeColors().
export const SERIES_PALETTE = SERIES_DARK;

export function seriesColorFrom(palette: readonly string[], i: number): string {
  return palette[i % palette.length];
}

export function seriesColor(i: number): string {
  return seriesColorFrom(SERIES_DARK, i);
}
