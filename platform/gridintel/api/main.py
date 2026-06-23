"""FastAPI service - JSON endpoints powering the React frontend."""
from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from .. import __version__
from ..db import get_engine
from ..observability import evaluate_staleness

app = FastAPI(
    title="Grid Intelligence Platform - API",
    version=__version__,
    description=(
        "Streaming grid intelligence over the US (EIA) and European (ENTSO-E) "
        "electricity grids, plus correlated NOAA weather. JSON-only - the UI is a "
        "React frontend, but the API is consumable by any client."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Health / freshness
# ---------------------------------------------------------------------------
@app.get("/healthz")
def healthz() -> dict[str, Any]:
    try:
        with get_engine().begin() as conn:
            conn.execute(text("SELECT 1"))
        return {"status": "ok", "version": __version__}
    except Exception as e:
        raise HTTPException(503, detail=f"db unavailable: {e}") from e


@app.get("/v1/freshness")
def freshness() -> list[dict[str, Any]]:
    with get_engine().begin() as conn:
        rows = conn.execute(text("""
            SELECT source, last_period_utc, last_fetch_utc, last_rows, last_error,
                   EXTRACT(EPOCH FROM (now() - last_fetch_utc)) AS sec_since_fetch,
                   EXTRACT(EPOCH FROM (now() - last_period_utc)) AS sec_since_period
            FROM ops.source_freshness ORDER BY source
        """)).mappings().all()
    out: list[dict[str, Any]] = []
    for r in rows:
        d = dict(r)
        ssf = float(d["sec_since_fetch"]) if d["sec_since_fetch"] is not None else None
        ssp = float(d["sec_since_period"]) if d["sec_since_period"] is not None else None
        d["is_stale"], d["stale_reason"] = evaluate_staleness(d["source"], ssf, ssp)
        out.append(d)
    return out


@app.get("/v1/ingest-runs")
def ingest_runs(limit: int = Query(default=50, ge=1, le=500)) -> list[dict[str, Any]]:
    with get_engine().begin() as conn:
        rows = conn.execute(text("""
            SELECT source, started_at, finished_at, rows_written, status, error_message
            FROM ops.ingest_run
            ORDER BY started_at DESC LIMIT :n
        """), {"n": limit}).mappings().all()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Demand
# ---------------------------------------------------------------------------
@app.get("/v1/balancing-authorities")
def balancing_authorities() -> list[dict[str, Any]]:
    with get_engine().begin() as conn:
        rows = conn.execute(text("""
            SELECT DISTINCT ba_code
            FROM raw.demand
            WHERE series='D' AND period_utc > now() - interval '7 days'
            ORDER BY ba_code
        """)).all()
    return [{"ba_code": r[0]} for r in rows]


@app.get("/v1/demand/latest")
def demand_latest(hours: int = Query(default=24, ge=1, le=168)) -> list[dict[str, Any]]:
    with get_engine().begin() as conn:
        rows = conn.execute(text("""
            SELECT period_utc, ba_code, value_mwh
            FROM raw.demand
            WHERE series='D' AND period_utc > now() - (:h || ' hours')::interval
            ORDER BY period_utc, ba_code
        """), {"h": hours}).mappings().all()
    return [dict(r) for r in rows]


@app.get("/v1/demand/headline")
def demand_headline() -> dict[str, Any]:
    """One-shot 'what's happening on the grid right now' summary."""
    with get_engine().begin() as conn:
        row = conn.execute(text("""
            WITH latest AS (
              SELECT ba_code,
                     value_mwh    AS value_now,
                     LAG(value_mwh, 1) OVER (PARTITION BY ba_code ORDER BY period_utc) AS prev,
                     LAG(value_mwh, 24) OVER (PARTITION BY ba_code ORDER BY period_utc) AS day_ago,
                     period_utc
              FROM raw.demand
              WHERE series='D' AND period_utc > now() - interval '48 hours'
            ),
            ranked AS (
              SELECT *, ROW_NUMBER() OVER (PARTITION BY ba_code ORDER BY period_utc DESC) AS rn
              FROM latest
            )
            SELECT
              max(period_utc) FILTER (WHERE rn=1)              AS as_of_utc,
              sum(value_now) FILTER (WHERE rn=1)               AS total_mwh_now,
              sum(day_ago)   FILTER (WHERE rn=1)               AS total_mwh_24h_ago,
              count(DISTINCT ba_code) FILTER (WHERE rn=1)      AS bas
            FROM ranked
        """)).mappings().first()
    if not row:
        return {"as_of_utc": None, "total_mwh_now": None, "total_mwh_24h_ago": None, "bas": 0, "delta_pct": None}
    rec = dict(row)
    now_v = rec.get("total_mwh_now")
    day_v = rec.get("total_mwh_24h_ago")
    rec["delta_pct"] = (
        ((now_v - day_v) / day_v * 100) if (now_v is not None and day_v) else None
    )
    return rec


# ---------------------------------------------------------------------------
# Generation mix
# ---------------------------------------------------------------------------
@app.get("/v1/generation/mix")
def generation_mix(hours: int = Query(default=24, ge=1, le=168), ba_code: str | None = None) -> list[dict[str, Any]]:
    # Anchor the window to the latest AVAILABLE hour, not wall-clock now(): EIA's
    # fuel-type feed legitimately lags ~24h, so "last N hours from now()" would
    # return ~0 rows and the chart couldn't draw. "Last N available hours" keeps
    # it drawable regardless of upstream lag. Falls back to now() if empty.
    with get_engine().begin() as conn:
        if ba_code:
            rows = conn.execute(text("""
                SELECT period_utc, fuel_code, sum(value_mwh) AS value_mwh
                FROM raw.generation
                WHERE ba_code = :ba
                  AND period_utc > coalesce(
                        (SELECT max(period_utc) FROM raw.generation WHERE ba_code = :ba),
                        now()) - (:h || ' hours')::interval
                GROUP BY 1, 2 ORDER BY 1
            """), {"ba": ba_code, "h": hours}).mappings().all()
        else:
            rows = conn.execute(text("""
                SELECT period_utc, fuel_code, sum(value_mwh) AS value_mwh
                FROM raw.generation
                WHERE period_utc > coalesce(
                        (SELECT max(period_utc) FROM raw.generation), now())
                        - (:h || ' hours')::interval
                GROUP BY 1, 2 ORDER BY 1
            """), {"h": hours}).mappings().all()
    return [dict(r) for r in rows]


@app.get("/v1/generation/share")
def generation_share(hours: int = Query(default=24, ge=1, le=168)) -> list[dict[str, Any]]:
    """Per-fuel share across the network in the last N available hours, with renewable / carbon-free flags."""
    # Window anchored to the latest available hour (see /v1/generation/mix) so
    # EIA's ~24h fuel-feed lag doesn't empty the result.
    with get_engine().begin() as conn:
        rows = conn.execute(text("""
            SELECT g.fuel_code, ft.fuel_name, ft.is_renewable, ft.is_carbon_free,
                   sum(g.value_mwh) AS mwh,
                   sum(g.value_mwh) / NULLIF((
                     SELECT sum(value_mwh) FROM raw.generation
                     WHERE period_utc > coalesce(
                       (SELECT max(period_utc) FROM raw.generation), now()) - (:h || ' hours')::interval
                   ), 0) * 100 AS pct
            FROM raw.generation g
            LEFT JOIN raw.fuel_type ft ON ft.fuel_code = g.fuel_code
            WHERE g.period_utc > coalesce(
                    (SELECT max(period_utc) FROM raw.generation), now()) - (:h || ' hours')::interval
            GROUP BY 1, 2, 3, 4
            ORDER BY mwh DESC
        """), {"h": hours}).mappings().all()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Interchange
# ---------------------------------------------------------------------------
@app.get("/v1/interchange/flows")
def interchange_flows(hours: int = Query(default=24, ge=1, le=168)) -> list[dict[str, Any]]:
    with get_engine().begin() as conn:
        rows = conn.execute(text("""
            SELECT from_ba, to_ba, sum(value_mwh) AS net_mwh, count(*) AS n_obs
            FROM raw.interchange
            WHERE period_utc > now() - (:h || ' hours')::interval
            GROUP BY 1, 2
            ORDER BY abs(sum(value_mwh)) DESC NULLS LAST
        """), {"h": hours}).mappings().all()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Anomalies
# ---------------------------------------------------------------------------
@app.get("/v1/anomalies/recent")
def anomalies_recent(hours: int = Query(default=48, ge=1, le=168)) -> list[dict[str, Any]]:
    with get_engine().begin() as conn:
        rows = conn.execute(text("""
            SELECT period_utc, ba_code, actual_mwh, expected_mwh,
                   residual_mwh, z_score, severity
            FROM ml.demand_anomaly
            WHERE is_anomaly AND period_utc > now() - (:h || ' hours')::interval
            ORDER BY abs(z_score) DESC, period_utc DESC
        """), {"h": hours}).mappings().all()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Forecast
# ---------------------------------------------------------------------------
@app.get("/v1/forecast/{ba_code}")
def forecast_for(ba_code: str) -> dict[str, Any]:
    with get_engine().begin() as conn:
        actual = conn.execute(text("""
            SELECT period_utc, value_mwh
            FROM raw.demand
            WHERE ba_code = :ba AND series='D' AND period_utc > now() - interval '72 hours'
            ORDER BY period_utc
        """), {"ba": ba_code}).mappings().all()
        fc = conn.execute(text("""
            SELECT period_utc, yhat_mwh, yhat_lower, yhat_upper, model_name
            FROM ml.demand_forecast
            WHERE ba_code = :ba AND fit_at_utc > now() - interval '6 hours'
            ORDER BY period_utc
        """), {"ba": ba_code}).mappings().all()
    return {
        "ba_code": ba_code,
        "actual": [dict(r) for r in actual],
        "forecast": [dict(r) for r in fc],
    }


# ---------------------------------------------------------------------------
# Weather
# ---------------------------------------------------------------------------
@app.get("/v1/weather/latest")
def weather_latest() -> list[dict[str, Any]]:
    with get_engine().begin() as conn:
        rows = conn.execute(text("""
            WITH ranked AS (
              SELECT station_id, period_utc, temperature_c, wind_speed_kph, cloud_cover_pct,
                     short_forecast,
                     ROW_NUMBER() OVER (PARTITION BY station_id ORDER BY period_utc DESC) AS rn
              FROM raw.weather
              WHERE period_utc > now() - interval '6 hours'
            )
            SELECT r.station_id, r.period_utc, r.temperature_c, r.wind_speed_kph,
                   r.cloud_cover_pct, r.short_forecast,
                   ws.latitude, ws.longitude
            FROM ranked r
            LEFT JOIN raw.weather_station ws
                   ON ws.ba_code = replace(r.station_id, 'BA:', '')
            WHERE r.rn = 1
        """)).mappings().all()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# ENTSO-E
# ---------------------------------------------------------------------------
@app.get("/v1/europe/weather")
def europe_weather_latest() -> list[dict[str, Any]]:
    """Latest Open-Meteo weather per European bidding zone, with lat/lon.

    Same shape as ``/v1/weather/latest`` (station_id, period_utc, temperature_c,
    wind_speed_kph, cloud_cover_pct, short_forecast, latitude, longitude) so the
    frontend map can reuse the US machinery. ``zone_name`` is added for labels.
    Null-safe: a zone missing a centroid still returns with null coordinates.
    Data: Open-Meteo (CC BY 4.0).
    """
    with get_engine().begin() as conn:
        rows = conn.execute(text("""
            WITH ranked AS (
              SELECT station_id, period_utc, temperature_c, wind_speed_kph, cloud_cover_pct,
                     short_forecast,
                     ROW_NUMBER() OVER (PARTITION BY station_id ORDER BY period_utc DESC) AS rn
              FROM raw.eu_weather
              WHERE period_utc > now() - interval '6 hours'
            )
            SELECT r.station_id, r.period_utc, r.temperature_c, r.wind_speed_kph,
                   r.cloud_cover_pct, r.short_forecast,
                   z.zone_name, z.latitude, z.longitude
            FROM ranked r
            LEFT JOIN raw.eu_weather_zone z
                   ON z.zone_eic = replace(r.station_id, 'EU:', '')
            WHERE r.rn = 1
        """)).mappings().all()
    return [dict(r) for r in rows]


@app.get("/v1/europe/load")
def europe_load(hours: int = Query(default=24, ge=1, le=168)) -> list[dict[str, Any]]:
    with get_engine().begin() as conn:
        rows = conn.execute(text("""
            SELECT period_utc, bidding_zone, sum(value_mw) AS value_mw
            FROM raw.entsoe_load
            WHERE period_utc > now() - (:h || ' hours')::interval
            GROUP BY 1, 2 ORDER BY 1
        """), {"h": hours}).mappings().all()
    return [dict(r) for r in rows]
