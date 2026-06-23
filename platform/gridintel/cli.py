"""``gridintel`` - top-level CLI.

::

    gridintel init-db           # create schemas / tables / hypertables
    gridintel backfill --hours 168
    gridintel ingest eia | entsoe | noaa | openmeteo | all
    gridintel ml forecast | anomaly
    gridintel scheduler         # run the long-lived APScheduler service
    gridintel api               # run the FastAPI service (uvicorn)
    gridintel status            # one-page freshness / health report
"""
from __future__ import annotations

import asyncio
import subprocess
import sys
from pathlib import Path
from typing import Annotated

import typer
from rich.console import Console
from rich.table import Table

from .config import REPO_ROOT, get_settings
from .ingest import jobs as ingest_jobs
from .logging_setup import configure_logging, get_logger
from .ml import jobs as ml_jobs
from .scheduler import run_forever

app = typer.Typer(no_args_is_help=True, add_completion=False, help="Grid Intelligence Platform CLI")
ingest_app = typer.Typer(no_args_is_help=True)
ml_app = typer.Typer(no_args_is_help=True)
app.add_typer(ingest_app, name="ingest", help="Run one-off ingestion jobs")
app.add_typer(ml_app,     name="ml",     help="Run ML / analytics jobs")

console = Console()
log = get_logger(__name__)


# ---------------------------------------------------------------------------
# init-db
# ---------------------------------------------------------------------------
@app.command("seed-demo")
def seed_demo(days: int = 14):
    """Seed plausible synthetic recent grid data (source='DEMO') for end-to-end
    demonstration before live API keys are configured. Idempotent (upsert)."""
    from .ingest.demo_seed import generate_demo

    configure_logging("seed-demo")
    totals = generate_demo(days=days)
    _print_kv("Demo seed totals (rows)", totals)


@app.command("purge-demo")
def purge_demo_cmd():
    """Delete all rows marked source='DEMO'."""
    from .ingest.demo_seed import purge_demo

    configure_logging("purge-demo")
    totals = purge_demo()
    _print_kv("Purged demo rows", totals)


@app.command("seed-reference")
def seed_reference_cmd():
    """Upsert static reference data (balancing authorities + weather-station
    centroids) into raw.balancing_authority and raw.weather_station. Idempotent;
    reproducible from a fresh clone."""
    from .ingest.reference import seed_reference

    configure_logging("seed-reference")
    totals = seed_reference()
    _print_kv("Reference rows upserted", totals)


@app.command()
def init_db():
    """Apply schema.sql + policies.sql against the configured PostgreSQL."""
    import psycopg

    s = get_settings()
    schema = (Path(__file__).parent / "db" / "schema.sql").read_text(encoding="utf-8")
    policies = (Path(__file__).parent / "db" / "policies.sql").read_text(encoding="utf-8")
    with psycopg.connect(s.psycopg_dsn, autocommit=True) as conn, conn.cursor() as cur:
        console.print("[cyan]applying schema.sql ...[/]")
        cur.execute(schema)
        console.print("[cyan]applying policies.sql ...[/]")
        cur.execute(policies)
    console.print("[green]init-db OK[/]")


# ---------------------------------------------------------------------------
# backfill
# ---------------------------------------------------------------------------
@app.command()
def backfill(
    hours: Annotated[int, typer.Option("--hours", "-h", help="How far back to fetch")] = 168
):
    """Backfill all sources for the last N hours (default: 168 = 1 week)."""
    configure_logging("backfill")
    res = asyncio.run(ingest_jobs.backfill_all(hours))
    _print_kv("Backfill totals", res)


# ---------------------------------------------------------------------------
# ingest …
# ---------------------------------------------------------------------------
@ingest_app.command("eia")
def ingest_eia(hours: int = 6):
    """Run EIA region + fuel + interchange jobs once."""
    configure_logging("ingest-eia")
    total = 0
    for fn in (ingest_jobs.run_eia_region, ingest_jobs.run_eia_fuel, ingest_jobs.run_eia_interchange):
        total += asyncio.run(fn(hours))
    console.print(f"[green]EIA total rows persisted:[/] {total}")


@ingest_app.command("entsoe")
def ingest_entsoe(hours: int = 6):
    """Run ENTSO-E load + generation jobs once."""
    configure_logging("ingest-entsoe")
    n_load = asyncio.run(ingest_jobs.run_entsoe_load(hours))
    n_gen  = asyncio.run(ingest_jobs.run_entsoe_generation(hours))
    console.print(f"[green]ENTSO-E:[/] load={n_load} gen={n_gen}")


@ingest_app.command("noaa")
def ingest_noaa():
    """Run NOAA forecast pull once."""
    configure_logging("ingest-noaa")
    n = asyncio.run(ingest_jobs.run_noaa())
    console.print(f"[green]NOAA rows:[/] {n}")


@ingest_app.command("openmeteo")
def ingest_openmeteo():
    """Run the Open-Meteo European weather pull once."""
    configure_logging("ingest-openmeteo")
    n = asyncio.run(ingest_jobs.run_openmeteo())
    console.print(f"[green]Open-Meteo (EU) rows:[/] {n}")


@ingest_app.command("all")
def ingest_all(hours: int = 6):
    """Run all ingestion sources once."""
    configure_logging("ingest-all")
    res = asyncio.run(ingest_jobs.backfill_all(hours))
    _print_kv("Ingest totals", res)


# ---------------------------------------------------------------------------
# ml …
# ---------------------------------------------------------------------------
@ml_app.command("forecast")
def ml_forecast():
    configure_logging("ml-forecast")
    n = asyncio.run(ml_jobs.run_demand_forecast())
    console.print(f"[green]Forecast rows:[/] {n}")


@ml_app.command("anomaly")
def ml_anomaly():
    configure_logging("ml-anomaly")
    n = asyncio.run(ml_jobs.run_anomaly_scan())
    console.print(f"[green]Anomaly rows:[/] {n}")


# ---------------------------------------------------------------------------
# Long-running services
# ---------------------------------------------------------------------------
@app.command()
def scheduler():
    """Run the long-lived APScheduler service (foreground)."""
    configure_logging("scheduler")
    asyncio.run(run_forever())


@app.command()
def api(
    host: str = "127.0.0.1",
    port: int | None = None,
    reload: bool = False,
):
    """Run the FastAPI service via uvicorn."""
    s = get_settings()
    port = port or s.gridintel_api_port
    cmd = [
        sys.executable, "-m", "uvicorn",
        "gridintel.api.main:app",
        "--host", host, "--port", str(port),
    ]
    if reload:
        cmd.append("--reload")
    console.print(f"[cyan]gridintel api on {host}:{port}[/]")
    subprocess.run(cmd, check=False)


# ---------------------------------------------------------------------------
# status
# ---------------------------------------------------------------------------
@app.command()
def status():
    """Print a one-page health / freshness report."""
    from sqlalchemy import text

    from .db import get_engine

    eng = get_engine()
    with eng.begin() as conn:
        fresh = conn.execute(text("""
            SELECT source, last_period_utc, last_fetch_utc, last_rows, last_error
            FROM ops.source_freshness ORDER BY source
        """)).all()
        counts = conn.execute(text("""
            SELECT 'raw.demand'             AS tbl, count(*), max(period_utc) FROM raw.demand
            UNION ALL SELECT 'raw.demand_forecast',  count(*), max(period_utc) FROM raw.demand_forecast
            UNION ALL SELECT 'raw.generation',       count(*), max(period_utc) FROM raw.generation
            UNION ALL SELECT 'raw.interchange',      count(*), max(period_utc) FROM raw.interchange
            UNION ALL SELECT 'raw.entsoe_load',      count(*), max(period_utc) FROM raw.entsoe_load
            UNION ALL SELECT 'raw.entsoe_generation',count(*), max(period_utc) FROM raw.entsoe_generation
            UNION ALL SELECT 'raw.weather',          count(*), max(period_utc) FROM raw.weather
            UNION ALL SELECT 'raw.eu_weather',       count(*), max(period_utc) FROM raw.eu_weather
            UNION ALL SELECT 'ml.demand_forecast',   count(*), max(period_utc) FROM ml.demand_forecast
            UNION ALL SELECT 'ml.demand_anomaly',    count(*), max(period_utc) FROM ml.demand_anomaly
        """)).all()

    t = Table(title="Source freshness", show_lines=False)
    t.add_column("Source"); t.add_column("Last period UTC"); t.add_column("Fetched UTC")
    t.add_column("Rows", justify="right"); t.add_column("Error")
    for s, lp, lf, n, err in fresh:
        t.add_row(s, str(lp), str(lf), str(n or 0), (err or "")[:60])
    console.print(t)

    t2 = Table(title="Table counts")
    t2.add_column("Table"); t2.add_column("Rows", justify="right"); t2.add_column("Latest UTC")
    for tbl, n, latest in counts:
        t2.add_row(tbl, f"{n:,}", str(latest))
    console.print(t2)


def _print_kv(title: str, d: dict):
    t = Table(title=title)
    t.add_column("Job"); t.add_column("Rows", justify="right")
    for k, v in d.items():
        t.add_row(k, f"{v:,}")
    console.print(t)


if __name__ == "__main__":
    app()
