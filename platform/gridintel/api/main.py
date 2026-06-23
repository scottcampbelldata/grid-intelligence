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


def _f(v: Any) -> float | None:
    """Coerce a DB numeric (float / Decimal / None) to float or None."""
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _pct_status(pct: float, warn: float, fail: float) -> str:
    """pass / warn / fail from a signed percentage and absolute thresholds."""
    a = abs(pct)
    if a > fail:
        return "fail"
    if a > warn:
        return "warn"
    return "pass"


def _rollup(details: list[dict[str, Any]]) -> tuple[str, str]:
    """Overall pass/warn/fail + a summary value for a per-BA check.

    A single outlier BA should not turn a whole check red: warn when any BA is
    flagged, fail only when a meaningful share (>25%) are beyond the fail band.
    """
    n = len(details)
    fails = sum(1 for x in details if x["status"] == "fail")
    flagged = sum(1 for x in details if x["status"] != "pass")
    if n == 0:
        status = "pass"
    elif fails / n > 0.25:
        status = "fail"
    elif flagged > 0:
        status = "warn"
    else:
        status = "pass"
    value = f"{flagged} of {n} BAs outside +/-5%"
    if fails:
        value += f" ({fails} beyond +/-15%)"
    return status, value


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
# NOTE: this static route MUST be declared before "/v1/forecast/{ba_code}",
# otherwise FastAPI matches "accuracy" as a ba_code path parameter.
@app.get("/v1/forecast/accuracy")
def forecast_accuracy(
    hours: int = Query(default=168, ge=1, le=720),
    ba_code: str | None = None,
) -> dict[str, Any]:
    """Out-of-sample accuracy of our SARIMAX vs EIA's day-ahead forecast.

    For each source, realized forecast hours within the trailing window are
    joined to actual demand (``raw.demand`` series 'D') and scored with MAPE and
    RMSE, both overall and per balancing authority. Lower is better.
    """
    # Only bind :ba when a BA is requested. Comparing a bind to NULL ("IS NULL")
    # leaves its type undetermined for Postgres, and ":ba::text" collides with
    # SQLAlchemy's ":name" bind syntax, so build the filter conditionally.
    ba_clause = "AND ba_code = :ba" if ba_code else ""
    sarimax_subq = f"""
        SELECT DISTINCT ON (ba_code, period_utc) ba_code, period_utc, yhat_mwh AS yhat
        FROM ml.demand_forecast
        WHERE period_utc > now() - (:h || ' hours')::interval AND period_utc <= now()
          {ba_clause}
        ORDER BY ba_code, period_utc, fit_at_utc DESC
    """
    eia_subq = f"""
        SELECT ba_code, period_utc, value_mwh AS yhat
        FROM raw.demand_forecast
        WHERE source = 'EIA' AND period_utc > now() - (:h || ' hours')::interval
          AND period_utc <= now() {ba_clause}
    """
    score_tmpl = """
        WITH f AS ({subq})
        SELECT f.ba_code AS ba_code,
               count(*) AS pairs,
               avg(abs(a.value_mwh - f.yhat) / NULLIF(a.value_mwh, 0)) * 100 AS mape_pct,
               sqrt(avg(power(a.value_mwh - f.yhat, 2))) AS rmse_mwh
        FROM f
        JOIN raw.demand a
          ON a.ba_code = f.ba_code AND a.period_utc = f.period_utc AND a.series = 'D'
        WHERE a.value_mwh IS NOT NULL AND f.yhat IS NOT NULL
        GROUP BY GROUPING SETS ((), (f.ba_code))
    """

    def parse(rows: list[dict[str, Any]]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        overall = {"pairs": 0, "mape_pct": None, "rmse_mwh": None}
        per_ba: list[dict[str, Any]] = []
        for r in rows:
            rec = {"pairs": int(r["pairs"] or 0), "mape_pct": _f(r["mape_pct"]), "rmse_mwh": _f(r["rmse_mwh"])}
            if r["ba_code"] is None:
                overall = rec
            else:
                per_ba.append({"ba_code": r["ba_code"], **rec})
        per_ba.sort(key=lambda x: (x["mape_pct"] is None, x["mape_pct"] or 0.0))
        return overall, per_ba

    params: dict[str, Any] = {"h": hours}
    if ba_code:
        params["ba"] = ba_code
    with get_engine().begin() as conn:
        s_rows = [dict(r) for r in conn.execute(text(score_tmpl.format(subq=sarimax_subq)), params).mappings().all()]
        e_rows = [dict(r) for r in conn.execute(text(score_tmpl.format(subq=eia_subq)), params).mappings().all()]
    s_overall, s_per = parse(s_rows)
    e_overall, e_per = parse(e_rows)
    return {
        "window": {"hours": hours},
        "ba_code": ba_code,
        "metric_notes": (
            "MAPE and RMSE over realized forecast hours in the trailing window, "
            "joined to actual demand (EIA series D). Lower is better."
        ),
        "sources": [
            {"source": "sarimax", **s_overall, "per_ba": s_per},
            {"source": "eia_day_ahead", **e_overall, "per_ba": e_per},
        ],
    }


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


# ---------------------------------------------------------------------------
# Data quality / validation
# ---------------------------------------------------------------------------
@app.get("/v1/validation")
def validation() -> dict[str, Any]:
    """Data-quality checks across the ingested grid data.

    Each check carries a pass/warn/fail status plus either per-BA detail rows
    (energy balance, fuel-mix reconciliation) or count rollups (freshness,
    demand plausibility). All windows are the last 24h. Strings are plain ASCII
    so the frontend renders them verbatim.
    """
    checks: list[dict[str, Any]] = []
    with get_engine().begin() as conn:
        as_of = conn.execute(
            text("SELECT max(period_utc) FROM raw.demand WHERE series = 'D'")
        ).scalar()

        # 1. Freshness - are all ingestion sources within their staleness SLA?
        fr = conn.execute(text("""
            SELECT source,
                   EXTRACT(EPOCH FROM (now() - last_fetch_utc))  AS ssf,
                   EXTRACT(EPOCH FROM (now() - last_period_utc)) AS ssp
            FROM ops.source_freshness
        """)).mappings().all()
        total_src = len(fr)
        stale = sum(
            1 for r in fr
            if evaluate_staleness(r["source"], _f(r["ssf"]), _f(r["ssp"]))[0]
        )
        fresh = total_src - stale
        checks.append({
            "name": "freshness",
            "status": "pass" if stale == 0 else ("fail" if total_src and stale == total_src else "warn"),
            "value": f"{fresh} of {total_src} sources fresh",
            "threshold": "all sources within their staleness SLA",
            "unit": "",
            "explanation": (
                "Every ingestion source must have fetched recently and carry a "
                "recent data period (per-source SLA)."
            ),
            "counts": {"sources": total_src, "fresh": fresh, "stale": stale},
            "details": [],
        })

        # 2. Demand plausibility - present and strictly positive (last 24h).
        dp = dict(conn.execute(text("""
            SELECT count(*)                                  AS observations,
                   count(*) FILTER (WHERE value_mwh IS NULL) AS nulls,
                   count(*) FILTER (WHERE value_mwh <= 0)    AS non_positive,
                   count(DISTINCT ba_code)                   AS bas
            FROM raw.demand
            WHERE series = 'D' AND period_utc > now() - interval '24 hours'
        """)).mappings().first() or {})
        obs = int(dp.get("observations") or 0)
        nulls = int(dp.get("nulls") or 0)
        nonpos = int(dp.get("non_positive") or 0)
        bad_frac = (nulls + nonpos) / obs if obs else 0
        checks.append({
            "name": "demand_plausibility",
            "status": "fail" if bad_frac > 0.02 else ("warn" if (nulls or nonpos) else "pass"),
            "value": f"{obs} demand observations, {nulls} null, {nonpos} non-positive",
            "threshold": "0 ideal; warn if any, fail if >2% null or non-positive",
            "unit": "",
            "explanation": (
                "Hourly demand in the last 24h should be present and strictly "
                "positive for every balancing authority."
            ),
            "counts": {"observations": obs, "nulls": nulls, "non_positive": nonpos, "bas": int(dp.get("bas") or 0)},
            "details": [],
        })

        # 3. Energy balance per BA (last 24h): EIA identity demand = NG - TI.
        #    Align per hour first - D, NG and TI can have different hour coverage
        #    (feeds lag independently); summing each over the window separately
        #    would compare mismatched hour counts. Only hours where all three
        #    are present contribute.
        eb = conn.execute(text("""
            WITH per_hour AS (
                SELECT period_utc, ba_code,
                       max(value_mwh) FILTER (WHERE series = 'D')  AS d,
                       max(value_mwh) FILTER (WHERE series = 'NG') AS ng,
                       max(value_mwh) FILTER (WHERE series = 'TI') AS ti
                FROM raw.demand
                WHERE series IN ('D', 'NG', 'TI') AND period_utc > now() - interval '24 hours'
                GROUP BY period_utc, ba_code
            )
            SELECT ba_code,
                   sum(d)  AS demand_mwh,
                   sum(ng) AS net_generation_mwh,
                   sum(ti) AS total_interchange_mwh,
                   count(*) AS hours
            FROM per_hour
            WHERE d IS NOT NULL AND ng IS NOT NULL AND ti IS NOT NULL
            GROUP BY ba_code
            ORDER BY ba_code
        """)).mappings().all()
        eb_details: list[dict[str, Any]] = []
        for r in eb:
            d, ng, ti = _f(r["demand_mwh"]), _f(r["net_generation_mwh"]), _f(r["total_interchange_mwh"])
            if d is None or ng is None or ti is None or d == 0:
                continue
            residual = ng - ti - d
            pct = residual / d * 100
            eb_details.append({
                "ba_code": r["ba_code"], "status": _pct_status(pct, 5, 15),
                "demand_mwh": round(d, 1), "net_generation_mwh": round(ng, 1),
                "total_interchange_mwh": round(ti, 1), "residual_mwh": round(residual, 1),
                "residual_pct": round(pct, 2), "hours": int(r["hours"] or 0),
            })
        eb_status, eb_value = _rollup(eb_details)
        checks.append({
            "name": "energy_balance",
            "status": eb_status,
            "value": eb_value,
            "threshold": "+/-5% warn, +/-15% fail (per BA); check fails if >25% of BAs breach",
            "unit": "%",
            "explanation": (
                "EIA identity: demand = net generation - total interchange. "
                "Residual = net generation - total interchange - demand, as a "
                "percent of demand, summed over hours where D, NG and TI are all "
                "present in the last 24h (NG/TI feeds are sparse; see Hours)."
            ),
            "counts": {},
            "details": eb_details,
        })

        # 4. Fuel-mix reconciliation per BA (last 24h): sum of fuel-level
        #    generation vs reported net generation (series 'NG').
        # Align per hour: the fuel feed and the NG feed lag independently, so
        # join on (ba_code, period_utc) and only count hours present in both.
        fs = conn.execute(text("""
            WITH ng AS (
                SELECT period_utc, ba_code, max(value_mwh) AS ng
                FROM raw.demand
                WHERE series = 'NG' AND period_utc > now() - interval '24 hours'
                GROUP BY period_utc, ba_code
            ),
            fuel AS (
                SELECT period_utc, ba_code, sum(value_mwh) AS fuel_sum
                FROM raw.generation
                WHERE period_utc > now() - interval '24 hours'
                GROUP BY period_utc, ba_code
            )
            SELECT ng.ba_code,
                   sum(ng.ng)        AS net_generation_mwh,
                   sum(fuel.fuel_sum) AS fuel_sum_mwh,
                   count(*)          AS hours
            FROM ng
            JOIN fuel ON fuel.ba_code = ng.ba_code AND fuel.period_utc = ng.period_utc
            WHERE ng.ng IS NOT NULL AND fuel.fuel_sum IS NOT NULL
            GROUP BY ng.ba_code
            ORDER BY ng.ba_code
        """)).mappings().all()
        fs_details: list[dict[str, Any]] = []
        for r in fs:
            ng, fsum = _f(r["net_generation_mwh"]), _f(r["fuel_sum_mwh"])
            if ng is None or fsum is None or ng == 0:
                continue
            residual = fsum - ng
            pct = residual / ng * 100
            fs_details.append({
                "ba_code": r["ba_code"], "status": _pct_status(pct, 5, 15),
                "fuel_sum_mwh": round(fsum, 1), "net_generation_mwh": round(ng, 1),
                "residual_mwh": round(residual, 1), "residual_pct": round(pct, 2),
                "hours": int(r["hours"] or 0),
            })
        fs_status, fs_value = _rollup(fs_details)
        checks.append({
            "name": "fuel_shares",
            "status": fs_status,
            "value": fs_value,
            "threshold": "+/-5% warn, +/-15% fail (per BA); check fails if >25% of BAs breach",
            "unit": "%",
            "explanation": (
                "Sum of fuel-level generation should reconcile with reported net "
                "generation per BA. Residual = fuel sum - net generation, as a "
                "percent, summed over hours present in both feeds in the last 24h "
                "(see Hours)."
            ),
            "counts": {},
            "details": fs_details,
        })

    summary = {"pass": 0, "warn": 0, "fail": 0}
    for c in checks:
        summary[c["status"]] = summary.get(c["status"], 0) + 1
    return {"as_of_utc": as_of, "summary": summary, "checks": checks}
