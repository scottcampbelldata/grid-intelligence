// Muted, distinguishable series palette - desaturated tones across a controlled
// range (accent blue, teal, warm gold, periwinkle, sage, slate) so overlaid
// lines read clearly without becoming a rainbow. Ordered for adjacent-series
// contrast: the first entries (the comparison caps of 5/3) are the most
// distinct. Shared by the multi-BA comparison overlays on the Demand and
// Forecast tabs. (The stacked-area bands keep their own ramp in StackedAreaChart.)
export const SERIES_PALETTE = [
  "#4f8bf5", // accent blue
  "#54a39b", // teal
  "#c2a25e", // warm gold
  "#7d7fb8", // periwinkle
  "#6fa07a", // sage
  "#8b909c", // slate
];

export function seriesColor(i: number): string {
  return SERIES_PALETTE[i % SERIES_PALETTE.length];
}
