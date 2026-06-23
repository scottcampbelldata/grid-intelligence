"""High-level ingestion jobs - what the scheduler actually runs."""
from __future__ import annotations

import asyncio
import functools
from datetime import datetime, timedelta

from sqlalchemy import text

from ..config import get_settings
from ..db import get_engine
from ..logging_setup import get_logger
from . import persist
from .eia import EIAClient, hours_ago, utc_now_floor_hour
from .entsoe import DEFAULT_ZONES, ENTSOEClient
from .noaa import BA_CENTROIDS, NOAAClient
from .openmeteo import EUROPE_ZONE_CENTROIDS, OpenMeteoClient

log = get_logger(__name__)


# ---------------------------------------------------------------------------
# Observability helpers
# ---------------------------------------------------------------------------
def _record_run(source: str, status: str, rows: int, error: str | None = None) -> None:
    eng = get_engine()
    with eng.begin() as conn:
        conn.execute(
            text("""
                INSERT INTO ops.ingest_run (source, finished_at, rows_written, status, error_message)
                VALUES (:source, now(), :rows, :status, :err)
            """),
            {"source": source, "rows": rows, "status": status, "err": error},
        )


def _update_freshness(source: str, rows: int, error: str | None = None) -> None:
    eng = get_engine()
    with eng.begin() as conn:
        last_period = _last_period_for(source, conn)
        conn.execute(
            text("""
                INSERT INTO ops.source_freshness
                    (source, last_period_utc, last_fetch_utc, last_rows, last_error)
                VALUES (:source, :lp, now(), :rows, :err)
                ON CONFLICT (source) DO UPDATE
                  SET last_period_utc = EXCLUDED.last_period_utc,
                      last_fetch_utc  = EXCLUDED.last_fetch_utc,
                      last_rows       = EXCLUDED.last_rows,
                      last_error      = EXCLUDED.last_error
            """),
            {"source": source, "lp": last_period, "rows": rows, "err": error},
        )


def _last_period_for(source: str, conn) -> datetime | None:
    queries = {
        "EIA-region":      "SELECT max(period_utc) FROM raw.demand WHERE source='EIA'",
        "EIA-fuel":        "SELECT max(period_utc) FROM raw.generation WHERE source='EIA'",
        "EIA-interchange": "SELECT max(period_utc) FROM raw.interchange WHERE source='EIA'",
        "ENTSOE-load":     "SELECT max(period_utc) FROM raw.entsoe_load",
        "ENTSOE-gen":      "SELECT max(period_utc) FROM raw.entsoe_generation",
        "NOAA":            "SELECT max(period_utc) FROM raw.weather",
        "OpenMeteo":       "SELECT max(period_utc) FROM raw.eu_weather",
    }
    q = queries.get(source)
    if not q:
        return None
    r = conn.execute(text(q)).scalar()
    return r


def _freshness_error(source: str, error: str) -> None:
    """Record an error on source_freshness WITHOUT touching last_fetch/last_period.

    Leaving ``last_fetch_utc`` frozen is deliberate: it keeps the staleness signal
    honest (a failing feed stays visibly stale) while surfacing *why* via
    ``last_error``. Success later clears the error via :func:`_update_freshness`.
    """
    eng = get_engine()
    with eng.begin() as conn:
        conn.execute(
            text("""
                INSERT INTO ops.source_freshness (source, last_error)
                VALUES (:source, :err)
                ON CONFLICT (source) DO UPDATE SET last_error = EXCLUDED.last_error
            """),
            {"source": source, "err": error},
        )


def _catchup_start(source: str, *, overlap_hours: int = 3) -> datetime:
    """Fetch-window start anchored to the latest stored period for ``source``.

    Re-fetches ``overlap_hours`` before the last stored period to absorb upstream
    revisions to recent hours, and - when the table is empty or the gap is large -
    falls back to / is capped at the configured backfill window so we never issue
    an unbounded request. This self-heals against upstream publication lag (EIA
    fuel lags ~24h) and scheduler downtime, where a fixed short rolling window
    would permanently skip data published later than the window.
    """
    max_lookback = get_settings().gridintel_backfill_hours          # default 168h
    floor_start = utc_now_floor_hour() - timedelta(hours=max_lookback)
    eng = get_engine()
    with eng.begin() as conn:
        last = _last_period_for(source, conn)
    if last is None:                       # never loaded → full backfill window
        return floor_start
    return max(last - timedelta(hours=overlap_hours), floor_start)


# Per-job wall-clock ceilings - generous enough that a healthy run never trips
# them, tight enough that a true stall can't wedge the next cycle under
# max_instances=1 (the 15-min jobs must finish well inside 900s).
_JOB_TIMEOUTS: dict[str, float] = {
    "EIA-region": 180, "EIA-fuel": 180, "EIA-interchange": 180,
    "ENTSOE-load": 240, "ENTSOE-gen": 240, "NOAA": 240, "OpenMeteo": 120,
}


def resilient_job(source: str):
    """Wrap an ingestion job so a failure is LOUD and recoverable.

    Bounds the job with a per-source timeout (so a network stall can't leave the
    instance pending forever and silently block every future fire under
    ``max_instances=1``), and on *any* exception logs at ERROR with a traceback
    and records a ``status='error'`` ``ops.ingest_run`` row plus a ``last_error``
    on ``ops.source_freshness`` - so a dead feed is visible immediately instead of
    just freezing. The exception is swallowed (returns 0) so the scheduler keeps
    firing the source on its next cycle rather than the job dying.
    """
    timeout_s = _JOB_TIMEOUTS.get(source, 240)

    def deco(fn):
        @functools.wraps(fn)
        async def wrapper(*args, **kwargs):
            try:
                return await asyncio.wait_for(fn(*args, **kwargs), timeout=timeout_s)
            except asyncio.TimeoutError:
                msg = f"timed out after {timeout_s:.0f}s"
                log.error(f"[{source}] ingestion job FAILED: {msg}")
            except Exception as e:  # noqa: BLE001 - deliberately catch-all: one feed must not kill its cycle
                msg = f"{type(e).__name__}: {e}"
                log.exception(f"[{source}] ingestion job FAILED: {msg}")
            # only reached when an exception was caught above
            _record_run(source, "error", 0, error=msg[:500])
            _freshness_error(source, msg[:500])
            return 0
        return wrapper
    return deco


# ---------------------------------------------------------------------------
# EIA jobs
# ---------------------------------------------------------------------------
@resilient_job("EIA-region")
async def run_eia_region(backfill_hours: int | None = None) -> int:
    s = get_settings()
    if not s.eia_api_key:
        log.warning("EIA_API_KEY not set - skipping EIA region job")
        return 0
    start = hours_ago(backfill_hours) if backfill_hours is not None else _catchup_start("EIA-region")
    end = utc_now_floor_hour() + timedelta(hours=1)
    async with EIAClient(s.eia_api_key) as eia:
        rows = await eia.region_data(start=start, end=end)
    counts = persist.persist_eia_region(rows)
    n = sum(counts.values())
    _record_run("EIA-region", "ok", n)
    _update_freshness("EIA-region", n)
    return n


@resilient_job("EIA-fuel")
async def run_eia_fuel(backfill_hours: int | None = None) -> int:
    s = get_settings()
    if not s.eia_api_key:
        log.warning("EIA_API_KEY not set - skipping EIA fuel job")
        return 0
    start = hours_ago(backfill_hours) if backfill_hours is not None else _catchup_start("EIA-fuel")
    end = utc_now_floor_hour() + timedelta(hours=1)
    async with EIAClient(s.eia_api_key) as eia:
        rows = await eia.fuel_type_data(start=start, end=end)
    n = persist.persist_eia_fuel(rows)
    _record_run("EIA-fuel", "ok", n)
    _update_freshness("EIA-fuel", n)
    return n


@resilient_job("EIA-interchange")
async def run_eia_interchange(backfill_hours: int | None = None) -> int:
    s = get_settings()
    if not s.eia_api_key:
        log.warning("EIA_API_KEY not set - skipping EIA interchange job")
        return 0
    start = hours_ago(backfill_hours) if backfill_hours is not None else _catchup_start("EIA-interchange")
    end = utc_now_floor_hour() + timedelta(hours=1)
    async with EIAClient(s.eia_api_key) as eia:
        rows = await eia.interchange_data(start=start, end=end)
    n = persist.persist_eia_interchange(rows)
    _record_run("EIA-interchange", "ok", n)
    _update_freshness("EIA-interchange", n)
    return n


# ---------------------------------------------------------------------------
# ENTSO-E jobs
# ---------------------------------------------------------------------------
@resilient_job("ENTSOE-load")
async def run_entsoe_load(backfill_hours: int | None = None) -> int:
    s = get_settings()
    if not s.entsoe_api_key:
        log.warning("ENTSOE_API_KEY not set - skipping ENTSO-E load job")
        return 0
    start = hours_ago(backfill_hours) if backfill_hours is not None else _catchup_start("ENTSOE-load")
    end = utc_now_floor_hour() + timedelta(hours=1)

    total = 0
    async with ENTSOEClient(s.entsoe_api_key) as cli:
        for zone in DEFAULT_ZONES:
            try:
                rows = await cli.actual_load(zone, start, end)
                total += persist.persist_entsoe_load(rows)
            except Exception as e:
                log.warning(f"ENTSO-E load zone={zone} failed: {e}")
    _record_run("ENTSOE-load", "ok", total)
    _update_freshness("ENTSOE-load", total)
    return total


@resilient_job("ENTSOE-gen")
async def run_entsoe_generation(backfill_hours: int | None = None) -> int:
    s = get_settings()
    if not s.entsoe_api_key:
        log.warning("ENTSOE_API_KEY not set - skipping ENTSO-E gen job")
        return 0
    start = hours_ago(backfill_hours) if backfill_hours is not None else _catchup_start("ENTSOE-gen")
    end = utc_now_floor_hour() + timedelta(hours=1)

    total = 0
    async with ENTSOEClient(s.entsoe_api_key) as cli:
        for zone in DEFAULT_ZONES:
            try:
                rows = await cli.generation_per_type(zone, start, end)
                total += persist.persist_entsoe_generation(rows)
            except Exception as e:
                log.warning(f"ENTSO-E gen zone={zone} failed: {e}")
    _record_run("ENTSOE-gen", "ok", total)
    _update_freshness("ENTSOE-gen", total)
    return total


# ---------------------------------------------------------------------------
# NOAA job
# ---------------------------------------------------------------------------
@resilient_job("NOAA")
async def run_noaa() -> int:
    s = get_settings()
    total = 0
    async with NOAAClient(s.noaa_user_agent) as cli:
        # Concurrency is bounded inside the client.
        results = await asyncio.gather(
            *(cli.hourly_forecast_for_ba(ba) for ba in BA_CENTROIDS),
            return_exceptions=True,
        )
        flat = []
        for r in results:
            if isinstance(r, Exception):
                log.warning(f"NOAA fetch failed: {r}")
                continue
            flat.extend(r)
        if flat:
            total = persist.persist_noaa(flat)
    _record_run("NOAA", "ok", total)
    _update_freshness("NOAA", total)
    return total


# ---------------------------------------------------------------------------
# Open-Meteo job (EU weather - parallel to NOAA)
# ---------------------------------------------------------------------------
@resilient_job("OpenMeteo")
async def run_openmeteo() -> int:
    total = 0
    async with OpenMeteoClient() as cli:
        # Concurrency is bounded inside the client; a zone that errors is
        # skipped so one bad zone never crashes the batch.
        results = await asyncio.gather(
            *(cli.hourly_forecast_for_zone(z) for z in EUROPE_ZONE_CENTROIDS),
            return_exceptions=True,
        )
        flat = []
        for r in results:
            if isinstance(r, Exception):
                log.warning(f"Open-Meteo fetch failed: {r}")
                continue
            flat.extend(r)
        if flat:
            total = persist.persist_openmeteo(flat)
    _record_run("OpenMeteo", "ok", total)
    _update_freshness("OpenMeteo", total)
    return total


# ---------------------------------------------------------------------------
# Backfill orchestrator
# ---------------------------------------------------------------------------
async def backfill_all(hours: int | None = None) -> dict[str, int]:
    hrs = hours or get_settings().gridintel_backfill_hours
    log.info(f"== Backfill: {hrs}h ==")
    results: dict[str, int] = {}
    for name, coro in [
        ("EIA-region",      run_eia_region(hrs)),
        ("EIA-fuel",        run_eia_fuel(hrs)),
        ("EIA-interchange", run_eia_interchange(hrs)),
        ("ENTSOE-load",     run_entsoe_load(hrs)),
        ("ENTSOE-gen",      run_entsoe_generation(hrs)),
        ("NOAA",            run_noaa()),
        ("OpenMeteo",       run_openmeteo()),
    ]:
        try:
            n = await coro
            results[name] = n
        except Exception as e:
            log.exception(f"backfill {name} failed: {e}")
            _record_run(name, "error", 0, error=str(e))
            results[name] = 0
    log.info(f"Backfill totals: {results}")
    return results
