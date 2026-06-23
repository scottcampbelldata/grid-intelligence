"""APScheduler service - runs every ingestion + ML job on its native cadence.

Designed to run as a long-lived foreground process under Windows. Auto-start is
wired via :file:`scripts/install-autostart.ps1`, which drops a hidden VBS
launcher into the user's Startup folder.
"""
from __future__ import annotations

import asyncio
import signal
from datetime import UTC, datetime

from apscheduler.executors.asyncio import AsyncIOExecutor
from apscheduler.jobstores.memory import MemoryJobStore
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from ..config import get_settings
from ..ingest import jobs as ingest_jobs
from ..logging_setup import get_logger
from ..ml import jobs as ml_jobs

log = get_logger(__name__)


def build_scheduler() -> AsyncIOScheduler:
    sched = AsyncIOScheduler(
        executors={"default": AsyncIOExecutor()},
        jobstores={"default": MemoryJobStore()},
        timezone="UTC",
        job_defaults={
            "coalesce": True,
            "max_instances": 1,
            "misfire_grace_time": 600,
        },
    )

    # EIA - every hour at minute 7 (EIA publishes ~minute 0-5)
    sched.add_job(
        ingest_jobs.run_eia_region,
        CronTrigger(minute=7),
        id="eia_region",
        name="EIA region (demand / NG / TI)",
    )
    sched.add_job(
        ingest_jobs.run_eia_fuel,
        CronTrigger(minute=8),
        id="eia_fuel",
        name="EIA generation by fuel type",
    )
    sched.add_job(
        ingest_jobs.run_eia_interchange,
        CronTrigger(minute=9),
        id="eia_interchange",
        name="EIA inter-BA interchange",
    )

    # ENTSO-E - every hour at minute 20 (EU TSOs publish on the hour)
    sched.add_job(
        ingest_jobs.run_entsoe_load,
        CronTrigger(minute=20),
        id="entsoe_load",
        name="ENTSO-E actual load",
    )
    sched.add_job(
        ingest_jobs.run_entsoe_generation,
        CronTrigger(minute=22),
        id="entsoe_gen",
        name="ENTSO-E generation per type",
    )

    # NOAA - every 15 minutes
    sched.add_job(
        ingest_jobs.run_noaa,
        IntervalTrigger(minutes=15),
        id="noaa",
        name="NOAA hourly forecast",
    )

    # Open-Meteo (EU weather) - every 15 minutes, offset 7 min off NOAA
    sched.add_job(
        ingest_jobs.run_openmeteo,
        IntervalTrigger(minutes=15, start_date="2000-01-01 00:07:00"),
        id="openmeteo",
        name="Open-Meteo European weather",
    )

    # ML - anomaly + forecast every 30 minutes after data lands
    sched.add_job(
        ml_jobs.run_anomaly_scan,
        CronTrigger(minute="15,45"),
        id="ml_anomaly",
        name="ML demand anomaly scan",
    )
    sched.add_job(
        ml_jobs.run_demand_forecast,
        CronTrigger(minute=30),
        id="ml_forecast",
        name="ML demand forecast",
    )

    return sched


async def run_forever() -> None:
    settings = get_settings()
    log.info(f"Grid Intelligence scheduler starting at {datetime.now(UTC).isoformat()}")
    log.info(f"  EIA key present:    {bool(settings.eia_api_key)}")
    log.info(f"  ENTSO-E key present:{bool(settings.entsoe_api_key)}")

    sched = build_scheduler()
    sched.start()
    jobs = sched.get_jobs()
    log.info(f"Scheduler registered {len(jobs)} jobs - confirm all sources present after a restart:")
    for j in jobs:
        log.info(f"  • {j.id:<16} next_run={j.next_run_time}  ({j.name})")

    stop_event = asyncio.Event()

    def _handler(*_a):
        log.info("Shutdown signal received")
        stop_event.set()

    try:
        signal.signal(signal.SIGINT, _handler)
        signal.signal(signal.SIGTERM, _handler)
    except (ValueError, AttributeError):
        # Some Windows platforms don't allow signal in non-main thread.
        pass

    try:
        await stop_event.wait()
    finally:
        sched.shutdown(wait=False)
        log.info("Scheduler stopped")
