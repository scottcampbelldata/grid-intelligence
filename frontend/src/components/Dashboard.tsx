"use client";

import { useCallback, useState } from "react";
import { AppHeader } from "./AppHeader";
import { TabNav, TABS, tabId, tabPanelId, type TabName } from "./TabNav";
import { DemandTab } from "./tabs/DemandTab";
import { GenerationTab } from "./tabs/GenerationTab";
import { InterchangeTab } from "./tabs/InterchangeTab";
import { AnomaliesTab } from "./tabs/AnomaliesTab";
import { ForecastTab } from "./tabs/ForecastTab";
import { WeatherTab } from "./tabs/WeatherTab";
import { EuropeTab } from "./tabs/EuropeTab";
import { EuropeWeatherTab } from "./tabs/EuropeWeatherTab";
import { DataQualityTab } from "./tabs/DataQualityTab";
import { OperationsTab } from "./tabs/OperationsTab";
import { useNow } from "@/lib/useGridData";
import { useHashTab } from "@/lib/useTabRouting";
import type { TabMeta } from "@/lib/types";

// Tabs are enabled here as they're built. All are now live.
const ENABLED: TabName[] = [...TABS];

export function Dashboard() {
  const [active, selectTab] = useHashTab(TABS, "Demand");
  const [meta, setMeta] = useState<TabMeta>({ lastUpdated: null, error: null });
  const now = useNow(30_000);

  const handleSelect = useCallback(
    (tab: TabName) => {
      // Clear freshness when switching so the header doesn't show stale info.
      setMeta({ lastUpdated: null, error: null });
      selectTab(tab);
    },
    [selectTab],
  );

  return (
    <div className="min-h-screen bg-bg">
      <AppHeader lastUpdated={meta.lastUpdated} now={now} error={meta.error} />
      <TabNav active={active} enabled={ENABLED} onSelect={handleSelect} />
      <main
        id={tabPanelId(active)}
        role="tabpanel"
        aria-labelledby={tabId(active)}
        tabIndex={0}
        className="mx-auto max-w-shell px-6 py-8 focus:outline-none"
      >
        {active === "Demand" && <DemandTab onMeta={setMeta} />}
        {active === "Generation" && <GenerationTab onMeta={setMeta} />}
        {active === "Interchange" && <InterchangeTab onMeta={setMeta} />}
        {active === "Anomalies" && <AnomaliesTab onMeta={setMeta} />}
        {active === "Forecast" && <ForecastTab onMeta={setMeta} />}
        {active === "Weather" && <WeatherTab onMeta={setMeta} />}
        {active === "Europe" && <EuropeTab onMeta={setMeta} />}
        {active === "Europe Weather" && <EuropeWeatherTab onMeta={setMeta} />}
        {active === "Data Quality" && <DataQualityTab onMeta={setMeta} />}
        {active === "Operations" && <OperationsTab onMeta={setMeta} />}
      </main>
    </div>
  );
}
