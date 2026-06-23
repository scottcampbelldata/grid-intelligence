"""Open-Meteo Weather API client - current + short-range forecast for Europe.

Open-Meteo (https://open-meteo.com) is a free, no-key public service. We use it
to pull an hourly forecast (temperature, wind speed, cloud cover, weather code)
for the representative centroid of each European bidding zone we track via
ENTSO-E - the EU parallel to NOAA's per-BA forecasts in
:mod:`gridintel.ingest.noaa`.

Units already match :data:`raw.weather` / ``raw.eu_weather`` (degrees Celsius,
km/h, percent), so unlike NOAA we do no unit conversion. The numeric WMO weather
code is mapped to a readable string in :data:`WMO_CODE`, populating
``short_forecast`` just like NOAA's ``shortForecast``.

Licence: Open-Meteo non-commercial free tier, data under CC BY 4.0 - attributed
in the UI. Limits: best-effort retry, bounded concurrency, polite to the public
endpoint.
"""
from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any

from ..logging_setup import get_logger
from ._http import is_retryable_status, make_client, retry_policy
from .entsoe import DEFAULT_ZONES

log = get_logger(__name__)

OPENMETEO_BASE = "https://api.open-meteo.com/v1/forecast"

# Representative lat/lon for each European bidding zone tracked in
# :data:`gridintel.ingest.entsoe.DEFAULT_ZONES`. Keyed by EIC code - the EU
# analogue of :data:`gridintel.ingest.noaa.BA_CENTROIDS`. Sub-country zones use
# a sensible point inside the zone (50Hertz → NE Germany, Italy-North → Po
# valley, DK1/DK2 split west/east of the Great Belt, NO2 → southern Norway,
# SE1 → far-northern Sweden, GB → central England).
EUROPE_ZONE_CENTROIDS: dict[str, tuple[float, float]] = {
    "10YDE-VE-------2": (52.4,  13.2),   # Germany (50Hertz) - Berlin / Brandenburg
    "10YFR-RTE------C": (46.8,   2.5),   # France - geographic centre
    "10YGB----------A": (52.9,  -1.5),   # Great Britain - central England
    "10YES-REE------0": (40.4,  -3.7),   # Spain - Madrid
    "10YIT-GRTN-----B": (45.4,   9.5),   # Italy (North) - Milan / Po valley
    "10YNL----------L": (52.1,   5.3),   # Netherlands - Utrecht
    "10YBE----------2": (50.6,   4.5),   # Belgium - Brussels
    "10YPT-REN------W": (39.5,  -8.0),   # Portugal - central
    "10YPL-AREA-----S": (52.1,  19.4),   # Poland - central
    "10YAT-APG------L": (47.6,  14.1),   # Austria - central
    "10YCH-SWISSGRIDZ": (46.8,   8.2),   # Switzerland - central
    "10YDK-1--------W": (56.0,   9.5),   # Denmark DK1 - Jutland (west)
    "10YDK-2--------M": (55.6,  12.0),   # Denmark DK2 - Zealand (east)
    "10YNO-2--------T": (58.8,   6.5),   # Norway NO2 - southern Norway
    "10YSE-1--------K": (65.6,  22.0),   # Sweden SE1 - far north (Luleå)
    "10YFI-1--------U": (62.5,  25.7),   # Finland - central
    "10YIE-1001A00010": (53.3,  -7.7),   # Ireland - central
    "10YCZ-CEPS-----N": (49.8,  15.5),   # Czech Republic - central
    "10YHU-MAVIR----U": (47.2,  19.4),   # Hungary - central / Budapest
    "10YGR-HTSO-----Y": (39.0,  22.0),   # Greece - central mainland
}

# WMO weather interpretation codes (WMO 4677, as published by Open-Meteo) →
# short readable condition. Mirrors the role of NOAA's ``shortForecast``.
WMO_CODE: dict[int, str] = {
    0:  "Clear sky",
    1:  "Mainly clear",
    2:  "Partly cloudy",
    3:  "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Heavy freezing rain",
    71: "Slight snow fall",
    73: "Moderate snow fall",
    75: "Heavy snow fall",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail",
}


def wmo_to_text(code: Any) -> str | None:
    """Map a WMO weather code to a readable condition, tolerant of None/floats."""
    if code is None:
        return None
    try:
        return WMO_CODE.get(int(code), f"WMO {int(code)}")
    except (TypeError, ValueError):
        return None


class OpenMeteoClient:
    def __init__(self, base_url: str = OPENMETEO_BASE, concurrency: int = 6):
        self._client = make_client(headers={
            "User-Agent": "grid-intelligence-platform/0.1",
            "Accept": "application/json",
        })
        self._base = base_url
        self._sem = asyncio.Semaphore(concurrency)

    async def __aenter__(self) -> OpenMeteoClient:
        return self

    async def __aexit__(self, *exc):
        await self._client.aclose()

    async def close(self):
        await self._client.aclose()

    async def _get(self, params: dict[str, Any]) -> dict[str, Any] | None:
        async for attempt in retry_policy():
            with attempt:
                async with self._sem:
                    resp = await self._client.get(self._base, params=params)
                if resp.status_code in (400, 404):
                    return None
                if is_retryable_status(resp):
                    resp.raise_for_status()
                resp.raise_for_status()
                return resp.json()
        return None

    async def hourly_forecast_for_zone(self, zone_eic: str) -> list[dict[str, Any]]:
        lat_lon = EUROPE_ZONE_CENTROIDS.get(zone_eic)
        if not lat_lon:
            return []
        lat, lon = lat_lon
        data = await self._get({
            "latitude": lat,
            "longitude": lon,
            "hourly": "temperature_2m,windspeed_10m,cloudcover,weathercode",
            "windspeed_unit": "kmh",
            "forecast_days": 2,
            "timezone": "UTC",
        })
        if not data:
            return []
        hourly = data.get("hourly") or {}
        times = hourly.get("time") or []
        temps = hourly.get("temperature_2m") or []
        winds = hourly.get("windspeed_10m") or []
        clouds = hourly.get("cloudcover") or []
        codes = hourly.get("weathercode") or []

        station_id = f"EU:{zone_eic}"
        out: list[dict[str, Any]] = []
        for i, t in enumerate(times):
            if not t:
                continue
            # timezone=UTC means naive 'YYYY-MM-DDTHH:MM' strings are UTC.
            ts = datetime.fromisoformat(t).replace(tzinfo=UTC)
            out.append({
                "period_utc":      ts,
                "station_id":      station_id,
                "temperature_c":   _at(temps, i),
                "wind_speed_kph":  _at(winds, i),
                "cloud_cover_pct": _at(clouds, i),
                "short_forecast":  wmo_to_text(_at(codes, i)),
            })
        log.info(f"Open-Meteo forecast for zone={zone_eic}: {len(out)} hours")
        return out


def _at(seq: list[Any], i: int) -> Any:
    return seq[i] if i < len(seq) else None


def zone_name(zone_eic: str) -> str:
    """Friendly name for a zone EIC, falling back to the code itself."""
    return DEFAULT_ZONES.get(zone_eic, zone_eic)
