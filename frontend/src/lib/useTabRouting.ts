"use client";

import { useCallback, useEffect, useState } from "react";

/** "Europe Weather" → "europe-weather". Stable, URL-safe, human-readable. */
export function slugify(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "-");
}

/**
 * Two-way bind the active tab to the URL hash (e.g. `#forecast`), so a tab is
 * refreshable, shareable, and back-button aware. Static-export safe: it's all
 * client-side and reads the hash only after mount (SSR renders the fallback).
 */
export function useHashTab<T extends string>(
  tabs: readonly T[],
  fallback: T,
): [T, (tab: T) => void] {
  const [active, setActive] = useState<T>(fallback);

  useEffect(() => {
    const apply = () => {
      const slug = window.location.hash.replace(/^#/, "");
      const match = tabs.find((t) => slugify(t) === slug);
      if (match) setActive(match);
    };
    apply(); // honor a deep-linked hash on first load
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [tabs]);

  const select = useCallback((tab: T) => {
    setActive(tab);
    const slug = slugify(tab);
    if (window.location.hash.replace(/^#/, "") !== slug) {
      window.history.pushState(null, "", `#${slug}`);
    }
  }, []);

  return [active, select];
}
