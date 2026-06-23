"""Open-Meteo client - hourly forecast parsing + WMO code mapping (EU)."""
from __future__ import annotations

import httpx
import pytest
import respx

from gridintel.ingest.openmeteo import (
    EUROPE_ZONE_CENTROIDS,
    OpenMeteoClient,
    wmo_to_text,
)

# A real EIC code from the centroid table (Spain).
SPAIN_EIC = "10YES-REE------0"

FORECAST_PAYLOAD = {
    "latitude": 40.4,
    "longitude": -3.7,
    "hourly": {
        "time": ["2026-06-19T00:00", "2026-06-19T01:00"],
        "temperature_2m": [21.4, 20.9],
        "windspeed_10m": [8.0, 9.6],
        "cloudcover": [75, 100],
        "weathercode": [2, 3],
    },
}


@pytest.mark.asyncio
@respx.mock(base_url="https://api.open-meteo.com")
async def test_openmeteo_hourly_forecast_for_zone(respx_mock):
    respx_mock.get(url__regex=r"/v1/forecast.*").mock(
        return_value=httpx.Response(200, json=FORECAST_PAYLOAD)
    )
    async with OpenMeteoClient() as cli:
        rows = await cli.hourly_forecast_for_zone(SPAIN_EIC)
    assert len(rows) == 2
    # Open-Meteo is already metric - no conversion.
    assert rows[0]["temperature_c"] == 21.4
    assert rows[1]["wind_speed_kph"] == 9.6
    assert rows[0]["cloud_cover_pct"] == 75
    # WMO code 2 → "Partly cloudy", 3 → "Overcast".
    assert rows[0]["short_forecast"] == "Partly cloudy"
    assert rows[1]["short_forecast"] == "Overcast"
    # station_id uses the 'EU:' prefix, parallel to NOAA's 'BA:'.
    assert rows[0]["station_id"] == f"EU:{SPAIN_EIC}"
    # Naive timestamps under timezone=UTC are tagged UTC.
    assert rows[0]["period_utc"].tzinfo is not None


@pytest.mark.asyncio
async def test_openmeteo_unknown_zone_returns_empty():
    async with OpenMeteoClient() as cli:
        rows = await cli.hourly_forecast_for_zone("NOT-A-ZONE")
    assert rows == []


def test_wmo_to_text_mapping():
    assert wmo_to_text(0) == "Clear sky"
    assert wmo_to_text(95) == "Thunderstorm"
    assert wmo_to_text(None) is None
    # Unknown but numeric code degrades gracefully.
    assert wmo_to_text(123) == "WMO 123"


def test_every_centroid_has_a_name():
    from gridintel.ingest.entsoe import DEFAULT_ZONES

    # Every centroid zone is a tracked ENTSO-E bidding zone.
    for eic in EUROPE_ZONE_CENTROIDS:
        assert eic in DEFAULT_ZONES
