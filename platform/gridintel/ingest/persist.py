"""Adapters from raw API payloads → relational rows + bulk upserts."""
from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, datetime
from typing import Any

from ..db import upsert_rows
from ..logging_setup import get_logger

log = get_logger(__name__)


def _parse_eia_period(p: str) -> datetime:
    """EIA periods come as 'YYYY-MM-DDTHH' (UTC)."""
    if len(p) == 13:
        return datetime.strptime(p, "%Y-%m-%dT%H").replace(tzinfo=UTC)
    # Defensive: some series return 'YYYY-MM-DD HH'.
    return datetime.fromisoformat(p.replace(" ", "T")).replace(tzinfo=UTC)


# ---------------------------------------------------------------------------
# EIA region-data → raw.demand / raw.demand_forecast / raw.generation (NG aggregate)
# ---------------------------------------------------------------------------
def persist_eia_region(rows: Iterable[dict[str, Any]]) -> dict[str, int]:
    demand: list[tuple] = []
    forecast: list[tuple] = []
    interchange_total: list[tuple] = []

    for r in rows:
        period = _parse_eia_period(r["period"])
        ba = r.get("respondent")
        series = r.get("type")
        val = _safe_float(r.get("value"))
        if not (ba and series):
            continue
        if series == "D":
            demand.append((period, ba, val, "D", "EIA"))
        elif series == "DF":
            forecast.append((period, ba, val, "EIA"))
        elif series == "NG":
            demand.append((period, ba, val, "NG", "EIA"))
        elif series == "TI":
            demand.append((period, ba, val, "TI", "EIA"))
            interchange_total.append((period, ba, val))

    n1 = upsert_rows(
        "raw.demand",
        ["period_utc", "ba_code", "value_mwh", "series", "source"],
        ["period_utc", "ba_code", "series", "source"],
        demand,
    )
    n2 = upsert_rows(
        "raw.demand_forecast",
        ["period_utc", "ba_code", "value_mwh", "source"],
        ["period_utc", "ba_code", "source"],
        forecast,
    )
    log.info(f"EIA region persist: demand/NG/TI={n1}, forecast={n2}")
    return {"demand": n1, "forecast": n2}


# ---------------------------------------------------------------------------
# EIA fuel-type-data → raw.generation (by fuel)
# ---------------------------------------------------------------------------
def persist_eia_fuel(rows: Iterable[dict[str, Any]]) -> int:
    out: list[tuple] = []
    for r in rows:
        period = _parse_eia_period(r["period"])
        ba = r.get("respondent")
        fuel = r.get("fueltype")
        val = _safe_float(r.get("value"))
        if not (ba and fuel):
            continue
        out.append((period, ba, fuel, val, "EIA"))
    n = upsert_rows(
        "raw.generation",
        ["period_utc", "ba_code", "fuel_code", "value_mwh", "source"],
        ["period_utc", "ba_code", "fuel_code", "source"],
        out,
    )
    log.info(f"EIA fuel persist: {n}")
    return n


# ---------------------------------------------------------------------------
# EIA interchange-data → raw.interchange
# ---------------------------------------------------------------------------
def persist_eia_interchange(rows: Iterable[dict[str, Any]]) -> int:
    out: list[tuple] = []
    for r in rows:
        period = _parse_eia_period(r["period"])
        from_ba = r.get("fromba")
        to_ba = r.get("toba")
        val = _safe_float(r.get("value"))
        if not (from_ba and to_ba):
            continue
        out.append((period, from_ba, to_ba, val, "EIA"))
    n = upsert_rows(
        "raw.interchange",
        ["period_utc", "from_ba", "to_ba", "value_mwh", "source"],
        ["period_utc", "from_ba", "to_ba", "source"],
        out,
    )
    log.info(f"EIA interchange persist: {n}")
    return n


# ---------------------------------------------------------------------------
# ENTSO-E load → raw.entsoe_load
# ---------------------------------------------------------------------------
def persist_entsoe_load(rows: Iterable[dict[str, Any]]) -> int:
    out = [
        (r["period_utc"], r["bidding_zone"], r["value_mw"], "A16", "ENTSOE")
        for r in rows
    ]
    n = upsert_rows(
        "raw.entsoe_load",
        ["period_utc", "bidding_zone", "value_mw", "process_type", "source"],
        ["period_utc", "bidding_zone", "process_type", "source"],
        out,
    )
    log.info(f"ENTSO-E load persist: {n}")
    return n


def persist_entsoe_generation(rows: Iterable[dict[str, Any]]) -> int:
    out = [
        (r["period_utc"], r["bidding_zone"], r["psr_type"], r["value_mw"], "ENTSOE")
        for r in rows
        if r.get("psr_type")
    ]
    n = upsert_rows(
        "raw.entsoe_generation",
        ["period_utc", "bidding_zone", "psr_type", "value_mw", "source"],
        ["period_utc", "bidding_zone", "psr_type", "source"],
        out,
    )
    log.info(f"ENTSO-E generation persist: {n}")
    return n


# ---------------------------------------------------------------------------
# NOAA → raw.weather
# ---------------------------------------------------------------------------
def persist_noaa(rows: Iterable[dict[str, Any]]) -> int:
    out = [
        (
            r["period_utc"],
            r["station_id"],
            r.get("temperature_c"),
            r.get("wind_speed_kph"),
            r.get("cloud_cover_pct"),
            r.get("short_forecast"),
        )
        for r in rows
    ]
    n = upsert_rows(
        "raw.weather",
        ["period_utc", "station_id", "temperature_c", "wind_speed_kph",
         "cloud_cover_pct", "short_forecast"],
        ["period_utc", "station_id"],
        out,
    )
    log.info(f"NOAA persist: {n}")
    return n


# ---------------------------------------------------------------------------
# Open-Meteo → raw.eu_weather (EU parallel to persist_noaa / raw.weather)
# ---------------------------------------------------------------------------
def persist_openmeteo(rows: Iterable[dict[str, Any]]) -> int:
    out = [
        (
            r["period_utc"],
            r["station_id"],
            r.get("temperature_c"),
            r.get("wind_speed_kph"),
            r.get("cloud_cover_pct"),
            r.get("short_forecast"),
        )
        for r in rows
    ]
    n = upsert_rows(
        "raw.eu_weather",
        ["period_utc", "station_id", "temperature_c", "wind_speed_kph",
         "cloud_cover_pct", "short_forecast"],
        ["period_utc", "station_id"],
        out,
    )
    log.info(f"Open-Meteo persist: {n}")
    return n


def _safe_float(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
