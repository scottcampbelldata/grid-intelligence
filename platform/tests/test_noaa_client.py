"""NOAA client - point resolution + forecast parsing."""
from __future__ import annotations

import httpx
import pytest
import respx

from gridintel.ingest.noaa import NOAAClient

POINT_PAYLOAD = {
    "properties": {
        "gridId": "PHI",
        "gridX": 31,
        "gridY": 80,
        "forecastHourly": "https://api.weather.gov/gridpoints/PHI/31,80/forecast/hourly",
        "observationStations": "https://api.weather.gov/gridpoints/PHI/31,80/stations",
        "timeZone": "America/New_York",
    }
}

FORECAST_PAYLOAD = {
    "properties": {
        "periods": [
            {
                "startTime": "2026-06-17T12:00:00-04:00",
                "temperature": 80,
                "windSpeed": "10 mph",
                "relativeHumidity": {"value": 60},
                "shortForecast": "Sunny",
            },
            {
                "startTime": "2026-06-17T13:00:00-04:00",
                "temperature": 82,
                "windSpeed": "10 to 15 mph",
                "relativeHumidity": {"value": 55},
                "shortForecast": "Sunny",
            },
        ]
    }
}


@pytest.mark.asyncio
@respx.mock(base_url="https://api.weather.gov")
async def test_noaa_hourly_forecast_for_ba(respx_mock):
    respx_mock.get(url__regex=r"/points/.*").mock(return_value=httpx.Response(200, json=POINT_PAYLOAD))
    respx_mock.get(url__regex=r"/gridpoints/PHI/31,80/forecast/hourly").mock(
        return_value=httpx.Response(200, json=FORECAST_PAYLOAD)
    )
    async with NOAAClient(user_agent="ua") as cli:
        rows = await cli.hourly_forecast_for_ba("PJM")
    assert len(rows) == 2
    # 80°F = 26.67°C
    assert abs(rows[0]["temperature_c"] - 26.67) < 0.05
    # 10 mph ~ 16.09 km/h
    assert abs(rows[0]["wind_speed_kph"] - 16.09) < 0.05
    # "10 to 15 mph" averages to 12.5 mph ~ 20.12 km/h
    assert abs(rows[1]["wind_speed_kph"] - 20.12) < 0.05
    assert rows[0]["short_forecast"] == "Sunny"
    assert rows[0]["station_id"] == "BA:PJM"


@pytest.mark.asyncio
async def test_noaa_unknown_ba_returns_empty():
    async with NOAAClient(user_agent="ua") as cli:
        rows = await cli.hourly_forecast_for_ba("XXX-NOT-A-BA")
    assert rows == []
