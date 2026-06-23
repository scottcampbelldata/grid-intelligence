// Each tab reports its data freshness/error up to the shell so the header's
// LIVE indicator and "updated N min ago" reflect the active tab.
export interface TabMeta {
  lastUpdated: Date | null;
  error: string | null;
}
