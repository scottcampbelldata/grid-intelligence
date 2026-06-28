"use client";

import { useRef, useState } from "react";
import { ComposableMap, Geographies, Geography, Marker } from "react-simple-maps";
import { useThemeColors } from "@/lib/useThemeColors";
import type { WeatherStation } from "@/lib/api";

// us-atlas states topojson is geographic (lon/lat), so geoAlbersUsa projects it
// - and the markers, which take [lon, lat] - into the same accurate space.
const GEO_URL = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";

// Land styling (lift off the panel, state borders, the ring around each dot) is
// theme-aware and shared with EuropeWeatherMap via lib/theme-colors.ts so the
// two maps read as a set in both light and dark.
const LAND_STROKE_WIDTH = 0.9;
const MARKER_STROKE_WIDTH = 1.25;
const DOT_R = 4.5; // resting dot radius
const DOT_R_ACTIVE = 6.5; // hovered dot radius

// Muted cool → neutral → warm ramp (no garish hues). This is a data colormap
// (temperature), not chrome, so it stays constant across themes.
type RGB = [number, number, number];
const COOL: RGB = [74, 127, 168];
const MID: RGB = [150, 150, 134];
const WARM: RGB = [200, 116, 95];

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
function tempColor(c: number | null, min: number, max: number, nullFill: string): string {
  if (c === null) return nullFill;
  const t = clamp01((c - min) / (max - min || 1));
  const [r, g, b] = t < 0.5 ? mix(COOL, MID, t * 2) : mix(MID, WARM, (t - 0.5) * 2);
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

function fmtTime(d: Date | null): string {
  if (!d) return "-";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

interface Hover {
  s: WeatherStation;
  x: number;
  y: number;
}

export function WeatherMap({ stations }: { stations: WeatherStation[] }) {
  const { map } = useThemeColors();
  const placed = stations.filter((s) => s.lat !== null && s.lon !== null);
  const unplaced = stations.length - placed.length;
  const temps = placed.map((s) => s.tempC).filter((t): t is number => t !== null);
  const min = temps.length ? Math.min(...temps) : 0;
  const max = temps.length ? Math.max(...temps) : 1;

  const [hover, setHover] = useState<Hover | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  function track(s: WeatherStation, e: React.MouseEvent) {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({ s, x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  return (
    <div ref={ref} className="relative">
      <ComposableMap
        projection="geoAlbersUsa"
        projectionConfig={{ scale: 1000 }}
        width={975}
        height={500}
        style={{ width: "100%", height: "auto" }}
      >
        <Geographies geography={GEO_URL}>
          {({ geographies }) =>
            geographies.map((geo) => (
              <Geography
                key={geo.rsmKey}
                geography={geo}
                fill={map.land}
                stroke={map.landStroke}
                strokeWidth={LAND_STROKE_WIDTH}
                style={{
                  default: { outline: "none" },
                  hover: { outline: "none", fill: map.land },
                  pressed: { outline: "none", fill: map.land },
                }}
              />
            ))
          }
        </Geographies>
        {placed.map((s) => {
          const active = hover?.s.baCode === s.baCode;
          return (
            <Marker
              key={s.baCode}
              coordinates={[s.lon as number, s.lat as number]}
              onMouseEnter={(e) => track(s, e)}
              onMouseMove={(e) => track(s, e)}
              onMouseLeave={() => setHover(null)}
            >
              <circle
                r={active ? DOT_R_ACTIVE : DOT_R}
                fill={tempColor(s.tempC, min, max, map.nullFill)}
                stroke={active ? map.markerActiveStroke : map.markerStroke}
                strokeWidth={active ? 1.5 : MARKER_STROKE_WIDTH}
                style={{ cursor: "pointer", transition: "r 80ms" }}
              />
            </Marker>
          );
        })}
      </ComposableMap>

      {/* Temperature legend */}
      <div className="mt-2 flex items-center gap-3">
        <span className="font-mono text-xs tabular-nums text-muted">{min.toFixed(0)}°C</span>
        <span
          className="h-2 w-40 rounded-[1px]"
          style={{
            backgroundImage: `linear-gradient(to right, rgb(${COOL.join(",")}), rgb(${MID.join(",")}), rgb(${WARM.join(",")}))`,
          }}
        />
        <span className="font-mono text-xs tabular-nums text-muted">{max.toFixed(0)}°C</span>
        <span className="text-xs text-muted">forecast temperature</span>
        {unplaced > 0 && (
          <span className="ml-auto text-xs text-muted">
            {unplaced} station{unplaced === 1 ? "" : "s"} without coordinates (see table)
          </span>
        )}
      </div>

      {hover && (
        <div
          className="pointer-events-none absolute z-10 w-56 rounded border border-border bg-bg px-3 py-2 text-xs shadow-none"
          style={{
            left: Math.min(hover.x + 12, (ref.current?.clientWidth ?? 0) - 232),
            top: hover.y + 12,
          }}
        >
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm text-text">{hover.s.baCode}</span>
            <span className="font-mono tabular-nums text-text">
              {hover.s.tempC !== null ? `${hover.s.tempC.toFixed(1)}°C` : "-"}
            </span>
          </div>
          <div className="space-y-0.5 text-muted">
            <div className="flex justify-between gap-4">
              <span>Wind</span>
              <span className="font-mono tabular-nums">
                {hover.s.windKph !== null ? `${hover.s.windKph.toFixed(0)} km/h` : "-"}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span>Cloud</span>
              <span className="font-mono tabular-nums">
                {hover.s.cloudPct !== null ? `${hover.s.cloudPct.toFixed(0)}%` : "-"}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span>Conditions</span>
              <span className="text-right text-text">{hover.s.conditions}</span>
            </div>
            <div className="flex justify-between gap-4 border-t border-border pt-0.5">
              <span>Forecast for</span>
              <span>{fmtTime(hover.s.periodUtc)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
