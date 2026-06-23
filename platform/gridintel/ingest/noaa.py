"""NOAA Weather API client - gridded forecasts + recent observations.

The api.weather.gov public service requires no key, only a contact
``User-Agent``. We use it to pull:

* Hourly forecast (temperature, wind speed, sky cover) for the centroid of each
  US balancing authority area we track - this lets us model demand vs weather.
* Most recent observation at a paired weather station (when one is identified).

Limits: best-effort retry, no parallel hammering - we keep concurrency low so
we stay friendly to the public endpoint.
"""
from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any

from ..logging_setup import get_logger
from ._http import is_retryable_status, make_client, retry_policy

log = get_logger(__name__)

NOAA_BASE = "https://api.weather.gov"

# Lat/lon for the population-weighted centroid of each BA we track. Approximate
# (close enough to retrieve a representative weather forecast). Pairs with
# EIA balancing-authority codes in :mod:`gridintel.ingest.eia`.
BA_CENTROIDS: dict[str, tuple[float, float]] = {
    "PJM":   (39.95, -76.0),
    "MISO":  (41.5,  -89.0),
    "ERCO":  (31.0,  -98.0),
    "CISO":  (36.0, -119.5),
    "SWPP":  (37.0,  -98.0),
    "NYIS":  (42.7,  -75.5),
    "ISNE":  (42.5,  -71.5),
    "SOCO":  (33.0,  -85.0),
    "TVA":   (35.5,  -86.0),
    "FPL":   (27.0,  -81.0),
    "BPAT":  (45.5, -121.0),
    "DUK":   (35.5,  -81.0),
    "AECI":  (37.5,  -93.5),
    "PACE":  (41.0, -111.5),
    "PACW":  (43.5, -122.5),
    "PSCO":  (39.5, -105.0),
    "AZPS":  (33.5, -112.0),
    "SRP":   (33.5, -112.0),
    "LDWP":  (34.0, -118.0),
    "NEVP":  (36.2, -115.2),
    "TEPC":  (32.2, -110.9),
    "IPCO":  (43.6, -116.3),
    "JEA":   (30.3,  -81.6),
    "TEC":   (27.9,  -82.5),
    "SCEG":  (33.7,  -81.0),
    "CPLE":  (35.7,  -78.6),
    "PSEI":  (47.6, -122.3),
    "AVA":   (47.6, -117.4),
    "PGE":   (45.5, -122.7),
    "SCL":   (47.6, -122.3),
    "NWMT":  (46.6, -112.0),
    "BANC":  (38.6, -121.5),
    "IID":   (33.0, -115.5),
}


class NOAAClient:
    def __init__(
        self,
        user_agent: str,
        base_url: str = NOAA_BASE,
        concurrency: int = 6,
    ):
        if not user_agent:
            raise ValueError("NOAA_USER_AGENT is required by api.weather.gov")
        self._client = make_client(headers={
            "User-Agent": user_agent,
            "Accept": "application/geo+json",
        })
        self._base = base_url
        self._sem = asyncio.Semaphore(concurrency)
        # Cache of (lat,lon) → gridId/gridX/gridY/observation-station lookups,
        # so we don't re-resolve each cycle.
        self._point_cache: dict[tuple[float, float], dict[str, Any]] = {}

    async def __aenter__(self) -> NOAAClient:
        return self

    async def __aexit__(self, *exc):
        await self._client.aclose()

    async def close(self):
        await self._client.aclose()

    async def _get(self, url: str) -> dict[str, Any] | None:
        async for attempt in retry_policy():
            with attempt:
                async with self._sem:
                    resp = await self._client.get(url)
                if resp.status_code in (404, 500):
                    return None
                if is_retryable_status(resp):
                    resp.raise_for_status()
                resp.raise_for_status()
                return resp.json()
        return None

    async def resolve_point(self, lat: float, lon: float) -> dict[str, Any] | None:
        key = (round(lat, 3), round(lon, 3))
        if key in self._point_cache:
            return self._point_cache[key]
        url = f"{self._base}/points/{lat:.4f},{lon:.4f}"
        data = await self._get(url)
        if not data:
            return None
        props = data.get("properties", {})
        meta = {
            "grid_id": props.get("gridId"),
            "grid_x":  props.get("gridX"),
            "grid_y":  props.get("gridY"),
            "forecast_hourly_url": props.get("forecastHourly"),
            "observation_stations_url": props.get("observationStations"),
            "tz": props.get("timeZone"),
        }
        self._point_cache[key] = meta
        return meta

    async def hourly_forecast_for_ba(self, ba_code: str) -> list[dict[str, Any]]:
        lat_lon = BA_CENTROIDS.get(ba_code)
        if not lat_lon:
            return []
        point = await self.resolve_point(*lat_lon)
        if not point or not point.get("forecast_hourly_url"):
            return []
        data = await self._get(point["forecast_hourly_url"])
        if not data:
            return []
        periods = data.get("properties", {}).get("periods", [])
        station_id = f"BA:{ba_code}"
        out = []
        for p in periods:
            start = p.get("startTime")
            if not start:
                continue
            ts = datetime.fromisoformat(start)
            ts = ts.astimezone(UTC)
            temp_f = p.get("temperature")
            temp_c = (temp_f - 32) * 5.0 / 9.0 if temp_f is not None else None
            wind_str = p.get("windSpeed") or ""
            wind_kph = _parse_wind_to_kph(wind_str)
            cloud_cover = p.get("relativeHumidity", {}).get("value") if isinstance(p.get("relativeHumidity"), dict) else None
            out.append({
                "period_utc":      ts,
                "station_id":      station_id,
                "temperature_c":   temp_c,
                "wind_speed_kph":  wind_kph,
                "cloud_cover_pct": cloud_cover,
                "short_forecast":  p.get("shortForecast"),
            })
        log.info(f"NOAA forecast for BA={ba_code}: {len(out)} hours")
        return out


def _parse_wind_to_kph(s: str) -> float | None:
    """Parse strings like '10 mph' or '10 to 15 mph' to km/h."""
    if not s:
        return None
    s = s.lower().replace("mph", "").replace("kph", "").strip()
    parts = s.replace("to", " ").split()
    nums: list[float] = []
    for part in parts:
        try:
            nums.append(float(part))
        except ValueError:
            continue
    if not nums:
        return None
    mph = sum(nums) / len(nums)
    return mph * 1.609344
