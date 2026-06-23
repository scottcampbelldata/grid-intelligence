"""Export the marts the Power BI report consumes as flat CSV.

Two consumers of one well-modeled warehouse:

* The React frontend + FastAPI live ops dashboard reads the warehouse via the API.
* The Power BI executive deck reads these CSV extracts (self-contained - no
  live warehouse needed at present time).

Re-run any time the warehouse refreshes:

    python scripts/export-marts.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
from sqlalchemy import text

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from gridintel.db import get_engine  # noqa: E402

OUT = ROOT / "data" / "processed" / "marts"
OUT.mkdir(parents=True, exist_ok=True)


QUERIES: dict[str, str] = {
    # --------------------------------------------------------------------- #
    # Per-BA last 14 days of hourly demand vs forecast - the backbone fact.
    # --------------------------------------------------------------------- #
    "mart_demand_hourly": """
        SELECT
            d.period_utc,
            d.ba_code,
            d.value_mwh                                        AS demand_mwh,
            f.value_mwh                                        AS forecast_mwh,
            (d.value_mwh - f.value_mwh)                        AS forecast_error_mwh,
            CASE WHEN f.value_mwh > 0
                 THEN abs(d.value_mwh - f.value_mwh) / f.value_mwh * 100
            END                                                AS abs_forecast_error_pct
        FROM raw.demand d
        LEFT JOIN raw.demand_forecast f
          ON f.period_utc = d.period_utc AND f.ba_code = d.ba_code
        WHERE d.series='D' AND d.period_utc > now() - interval '14 days'
        ORDER BY d.period_utc, d.ba_code
    """,

    # --------------------------------------------------------------------- #
    # Per-BA per-fuel last 7 days of generation, enriched with carbon flags.
    # --------------------------------------------------------------------- #
    "mart_generation_hourly": """
        SELECT
            g.period_utc,
            g.ba_code,
            g.fuel_code,
            COALESCE(ft.fuel_name, g.fuel_code)               AS fuel_name,
            COALESCE(ft.is_renewable, false)                  AS is_renewable,
            COALESCE(ft.is_carbon_free, false)                AS is_carbon_free,
            g.value_mwh                                       AS generation_mwh
        FROM raw.generation g
        LEFT JOIN raw.fuel_type ft ON ft.fuel_code = g.fuel_code
        WHERE g.period_utc > now() - interval '7 days'
        ORDER BY g.period_utc, g.ba_code, g.fuel_code
    """,

    # --------------------------------------------------------------------- #
    # Network-wide hourly renewable + carbon-free share.
    # --------------------------------------------------------------------- #
    "mart_renewable_share_hourly": """
        WITH g AS (
          SELECT g.period_utc, g.fuel_code, g.value_mwh,
                 ft.is_renewable, ft.is_carbon_free
          FROM raw.generation g
          LEFT JOIN raw.fuel_type ft ON ft.fuel_code = g.fuel_code
          WHERE g.period_utc > now() - interval '7 days'
        )
        SELECT
            period_utc,
            sum(value_mwh)                                                AS total_mwh,
            sum(value_mwh) FILTER (WHERE is_renewable)                    AS renewable_mwh,
            sum(value_mwh) FILTER (WHERE is_carbon_free)                  AS carbon_free_mwh,
            CASE WHEN sum(value_mwh) > 0
                 THEN sum(value_mwh) FILTER (WHERE is_renewable)   / sum(value_mwh) * 100
            END                                                           AS renewable_pct,
            CASE WHEN sum(value_mwh) > 0
                 THEN sum(value_mwh) FILTER (WHERE is_carbon_free) / sum(value_mwh) * 100
            END                                                           AS carbon_free_pct
        FROM g
        GROUP BY 1
        ORDER BY 1
    """,

    # --------------------------------------------------------------------- #
    # Anomalies (last 7 days). Powers the AI Early Warning page.
    # --------------------------------------------------------------------- #
    "mart_anomalies": """
        SELECT
            period_utc,
            ba_code,
            actual_mwh,
            expected_mwh,
            residual_mwh,
            z_score,
            severity,
            is_anomaly
        FROM ml.demand_anomaly
        WHERE period_utc > now() - interval '7 days'
        ORDER BY period_utc DESC, abs(z_score) DESC
    """,

    # --------------------------------------------------------------------- #
    # ML demand forecast (next horizon, per BA, per model).
    # --------------------------------------------------------------------- #
    "mart_forecast": """
        SELECT
            f.period_utc,
            f.ba_code,
            f.yhat_mwh,
            f.yhat_lower,
            f.yhat_upper,
            f.model_name,
            f.fit_at_utc
        FROM ml.demand_forecast f
        WHERE f.fit_at_utc > now() - interval '24 hours'
        ORDER BY f.ba_code, f.period_utc
    """,

    # --------------------------------------------------------------------- #
    # Top inter-BA flows (last 7 days).
    # --------------------------------------------------------------------- #
    "mart_interchange": """
        SELECT
            period_utc,
            from_ba,
            to_ba,
            value_mwh                                          AS net_mwh
        FROM raw.interchange
        WHERE period_utc > now() - interval '7 days'
        ORDER BY period_utc, from_ba, to_ba
    """,

    # --------------------------------------------------------------------- #
    # Pipeline observability for the Health page.
    # --------------------------------------------------------------------- #
    "mart_source_freshness": """
        SELECT
            source,
            last_period_utc,
            last_fetch_utc,
            last_rows,
            last_error,
            EXTRACT(EPOCH FROM (now() - last_fetch_utc))  / 60 AS minutes_since_fetch,
            EXTRACT(EPOCH FROM (now() - last_period_utc)) / 60 AS minutes_since_period
        FROM ops.source_freshness
        ORDER BY source
    """,

    "mart_ingest_runs": """
        SELECT
            run_id, source, started_at, finished_at, rows_written, status, error_message
        FROM ops.ingest_run
        ORDER BY started_at DESC
        LIMIT 200
    """,

    # --------------------------------------------------------------------- #
    # Dimension tables - small static lookups.
    # --------------------------------------------------------------------- #
    "dim_balancing_authority": """
        SELECT DISTINCT
            d.ba_code,
            COALESCE(b.ba_name,  d.ba_code)  AS ba_name,
            COALESCE(b.region,   'Unknown')  AS region,
            COALESCE(b.country,  'US')       AS country,
            COALESCE(b.timezone, 'UTC')      AS timezone
        FROM raw.demand d
        LEFT JOIN raw.balancing_authority b ON b.ba_code = d.ba_code
        WHERE d.period_utc > now() - interval '90 days'
        ORDER BY d.ba_code
    """,

    "dim_fuel_type": """
        SELECT fuel_code, fuel_name, is_renewable, is_carbon_free
        FROM raw.fuel_type
        ORDER BY fuel_code
    """,
}


def main() -> int:
    eng = get_engine()
    print(f"Exporting {len(QUERIES)} marts to {OUT}\n")
    summary = []
    for name, sql in QUERIES.items():
        with eng.begin() as conn:
            df = pd.read_sql(text(sql), conn)
        path = OUT / f"{name}.csv"
        df.to_csv(path, index=False)
        summary.append((name, len(df), path.stat().st_size))
        print(f"  {name:35s} {len(df):>8,} rows -> {path}")
    total_rows = sum(r[1] for r in summary)
    total_bytes = sum(r[2] for r in summary)
    print(f"\n{len(summary)} files · {total_rows:,} rows · {total_bytes/1024:.1f} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
