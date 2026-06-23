"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getDemand,
  getDemandHeadline,
  getGenerationShare,
  getRecentAnomalies,
  type Anomaly,
  type BaDemand,
  type DemandHeadline,
  type DemandSeriesPoint,
  type GenerationSummary,
} from "./api";

export interface DemandData {
  headline: DemandHeadline | null;
  series: DemandSeriesPoint[];
  byBa: BaDemand[];
  byBaSeries: Record<string, Record<number, number>>;
  times: number[];
  generation: GenerationSummary | null;
  anomalies: Anomaly[];
}

export interface UseDemandDataResult {
  data: DemandData;
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  refresh: () => void;
}

const EMPTY: DemandData = {
  headline: null,
  series: [],
  byBa: [],
  byBaSeries: {},
  times: [],
  generation: null,
  anomalies: [],
};

/**
 * Fetches everything the Demand tab needs, client-side, in parallel, and
 * re-polls on an interval. On refresh, stale data is kept on screen until the
 * new data lands (no flash to empty). Errors are surfaced but don't clear data.
 */
export function useDemandData(refreshMs = 60_000): UseDemandDataResult {
  const [data, setData] = useState<DemandData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const [headline, demand, generation, anomalies] = await Promise.all([
          getDemandHeadline(controller.signal),
          getDemand(24, controller.signal),
          getGenerationShare(24, controller.signal),
          getRecentAnomalies(24, controller.signal),
        ]);
        if (cancelled) return;
        setData({
          headline,
          series: demand.series,
          byBa: demand.byBa,
          byBaSeries: demand.byBaSeries,
          times: demand.times,
          generation,
          anomalies,
        });
        setError(null);
        setLastUpdated(new Date());
      } catch (e) {
        if (cancelled || (e as Error).name === "AbortError") return;
        setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [tick]);

  useEffect(() => {
    if (refreshMs <= 0) return;
    const id = setInterval(() => setTick((t) => t + 1), refreshMs);
    return () => clearInterval(id);
  }, [refreshMs]);

  return { data, loading, error, lastUpdated, refresh };
}

export interface PollingResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  refresh: () => void;
}

/**
 * Generic client-side polling hook used by every tab. Fetches once on mount,
 * re-polls on an interval, keeps stale data on screen during refresh, and
 * surfaces errors without clearing data. The fetcher is held in a ref so an
 * inline arrow doesn't retrigger the effect on every render.
 */
export function usePolling<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  refreshMs = 60_000,
  deps: readonly unknown[] = [],
): PollingResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [tick, setTick] = useState(0);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const result = await fetcherRef.current(controller.signal);
        if (cancelled) return;
        setData(result);
        setError(null);
        setLastUpdated(new Date());
      } catch (e) {
        if (cancelled || (e as Error).name === "AbortError") return;
        setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);

  useEffect(() => {
    if (refreshMs <= 0) return;
    const id = setInterval(() => setTick((t) => t + 1), refreshMs);
    return () => clearInterval(id);
  }, [refreshMs]);

  return { data, loading, error, lastUpdated, refresh };
}

/** A clock that re-renders on an interval - drives the "updated N min ago" label. */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
