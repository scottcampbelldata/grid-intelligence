"""Generate plausible recent grid data so the platform demonstrates end-to-end
even before live API keys (EIA / ENTSO-E) are configured.

What is real and what is synthetic:

* Balancing-authority codes, BA names, fuel-type catalog, NOAA station lookups,
  the database / dbt / ML pipeline, all dashboards: 100% the same code as
  production. Real ENTSO-E / EIA / NOAA payloads land in the SAME tables.
* The synthetic values are stamped with ``source='DEMO'`` so they can be
  trivially purged with ``DELETE ... WHERE source='DEMO'`` once live data is
  flowing.

The synthetic generator is deterministic (fixed seed) and produces hourly
data spanning a configurable number of days. Demand profiles use a realistic
diurnal shape (morning + evening peaks), a weekend dampening, BA-specific
base loads and seasonality, and a small Gaussian noise term. Generation mix
is allocated per BA from a region-style fuel-mix prior. Anomalies are
injected at ~3 random hours per BA so the anomaly scan has something to
find.
"""
from __future__ import annotations

import math
import random
from datetime import UTC, datetime, timedelta

from ..db import upsert_rows
from ..logging_setup import get_logger

log = get_logger(__name__)

RNG = random.Random(20260617)

# Base load (MW), peak load (MW), region label per BA - coarse but plausible.
BA_PROFILE: dict[str, tuple[float, float, str]] = {
    "PJM":   (75_000, 145_000, "Mid-Atlantic"),
    "MISO":  (60_000, 125_000, "Midwest"),
    "ERCO":  (45_000,  85_000, "Texas"),
    "CISO":  (22_000,  48_000, "West"),
    "SWPP":  (28_000,  55_000, "Plains"),
    "NYIS":  (15_000,  31_000, "Northeast"),
    "ISNE":  (11_000,  24_000, "Northeast"),
    "SOCO":  (24_000,  45_000, "Southeast"),
    "TVA":   (19_000,  31_000, "Southeast"),
    "FPL":   (15_000,  30_000, "Southeast"),
    "BPAT":  ( 6_000,  11_000, "Northwest"),
    "DUK":   (15_000,  25_000, "Southeast"),
    "AECI":  ( 5_000,   8_000, "Midwest"),
    "PACE":  ( 7_000,  12_000, "West"),
    "PACW":  ( 3_000,   5_500, "West"),
    "PSCO":  ( 4_500,   8_500, "West"),
    "AZPS":  ( 5_500,  10_500, "Southwest"),
    "LDWP":  ( 3_800,   6_800, "West"),
    "NEVP":  ( 3_500,   7_200, "West"),
    "SRP":   ( 4_200,   8_000, "Southwest"),
    "TEPC":  ( 1_900,   3_300, "Southwest"),
    "IPCO":  ( 1_900,   3_400, "West"),
    "PSEI":  ( 3_800,   5_500, "Northwest"),
    "SCEG":  ( 3_900,   6_300, "Southeast"),
    "CPLE":  ( 6_500,  11_000, "Southeast"),
    "PGE":   ( 2_800,   4_200, "Northwest"),
    "BANC":  ( 2_400,   4_500, "West"),
    "SCL":   ( 1_200,   1_900, "Northwest"),
    "NWMT":  ( 1_500,   2_500, "Northwest"),
    "TEC":   ( 2_500,   4_700, "Southeast"),
    "JEA":   ( 2_000,   3_500, "Southeast"),
    "AVA":   ( 1_500,   2_400, "Northwest"),
}

# Fuel mix by region (fraction). Must sum to ~1.0.
REGION_MIX: dict[str, dict[str, float]] = {
    "Mid-Atlantic": {"NG": 0.45, "NUC": 0.30, "COL": 0.10, "WND": 0.05, "SUN": 0.04, "WAT": 0.02, "OTH": 0.04},
    "Midwest":      {"COL": 0.30, "NG": 0.30, "NUC": 0.15, "WND": 0.20, "SUN": 0.02, "OTH": 0.03},
    "Texas":        {"NG": 0.40, "WND": 0.25, "COL": 0.13, "NUC": 0.10, "SUN": 0.10, "OTH": 0.02},
    "West":         {"NG": 0.35, "WND": 0.10, "SUN": 0.25, "WAT": 0.18, "NUC": 0.07, "GEO": 0.03, "OTH": 0.02},
    "Plains":       {"WND": 0.42, "NG": 0.32, "COL": 0.18, "NUC": 0.05, "SUN": 0.02, "OTH": 0.01},
    "Northeast":    {"NUC": 0.32, "NG": 0.45, "WAT": 0.08, "WND": 0.06, "SUN": 0.04, "OTH": 0.05},
    "Southeast":    {"NG": 0.45, "NUC": 0.23, "COL": 0.18, "WAT": 0.04, "SUN": 0.05, "OTH": 0.05},
    "Northwest":    {"WAT": 0.55, "NG": 0.18, "WND": 0.13, "NUC": 0.08, "COL": 0.04, "SUN": 0.02},
    "Southwest":    {"NG": 0.35, "SUN": 0.20, "COL": 0.18, "NUC": 0.16, "WND": 0.06, "OTH": 0.05},
}


def _diurnal(hour: int) -> float:
    """Two-peak diurnal shape, scaled 0.6 ... 1.0 of peak."""
    # Morning peak ~ 8:00, evening peak ~ 19:00 (local-ish), trough at 4:00.
    morning = math.exp(-((hour - 8) ** 2) / (2 * 2.4 ** 2))
    evening = math.exp(-((hour - 19) ** 2) / (2 * 3.0 ** 2))
    raw = 0.6 + 0.4 * max(0.55 * morning + 0.85 * evening, 0.0)
    return min(raw, 1.0)


def _weekday_factor(dt: datetime) -> float:
    return 0.92 if dt.weekday() >= 5 else 1.0


def _hours(start: datetime, n: int) -> list[datetime]:
    return [start + timedelta(hours=i) for i in range(n)]


def generate_demo(days: int = 14) -> dict[str, int]:
    """Generate ``days`` × 24 hourly rows for every BA in :data:`BA_PROFILE`
    and persist as ``source='DEMO'``."""
    end = datetime.now(UTC).replace(minute=0, second=0, microsecond=0)
    start = end - timedelta(hours=24 * days - 1)
    n_hours = 24 * days
    log.info(f"demo seed: {len(BA_PROFILE)} BAs × {n_hours}h = {len(BA_PROFILE) * n_hours} demand rows")

    demand_rows: list[tuple] = []
    forecast_rows: list[tuple] = []
    gen_rows: list[tuple] = []
    interchange_rows: list[tuple] = []

    for ba, (base, peak, region) in BA_PROFILE.items():
        mix = REGION_MIX.get(region, REGION_MIX["West"])
        # BA-specific phase shift so we don't get sharp aligned spikes.
        phase = RNG.uniform(-1.5, 1.5)
        # Pick 3 anomaly hours randomly distributed across the window.
        anomaly_idx = set(RNG.sample(range(n_hours), k=3))

        for i, ts in enumerate(_hours(start, n_hours)):
            shape = _diurnal((ts.hour + int(phase)) % 24) * _weekday_factor(ts)
            noise = RNG.gauss(1.0, 0.025)
            d = max(0.0, base + (peak - base) * shape) * noise
            if i in anomaly_idx:
                d *= RNG.choice([0.6, 1.4, 1.55])

            demand_rows.append((ts, ba, d, "D", "DEMO"))
            forecast = d * RNG.gauss(1.0, 0.03)
            forecast_rows.append((ts, ba, forecast, "DEMO"))

            # Generation mix - split daemand into fuels by region mix.
            for fuel, share in mix.items():
                g = d * share
                # Solar drops to ~0 between 20:00 and 06:00 UTC-ish.
                if fuel == "SUN":
                    sun_h = ts.hour
                    g *= max(0.0, math.sin((sun_h - 6) / 12 * math.pi))
                # Wind has more randomness.
                if fuel == "WND":
                    g *= RNG.gauss(1.0, 0.20)
                if g < 0:
                    g = 0.0
                gen_rows.append((ts, ba, fuel, g, "DEMO"))

    # Interchange - pick a few canonical pairs with sinusoidal net flow.
    pairs = [
        ("PJM", "MISO"), ("PJM", "NYIS"), ("MISO", "SWPP"),
        ("CISO", "BANC"), ("CISO", "LDWP"), ("BPAT", "PACW"),
        ("ERCO", "SWPP"), ("ISNE", "NYIS"), ("SOCO", "TVA"),
        ("DUK", "CPLE"), ("AZPS", "WACM"), ("NEVP", "CISO"),
    ]
    for ts in _hours(start, n_hours):
        h = ts.hour
        for a, b in pairs:
            mag = 500 + 1500 * math.sin((h - 7) / 24 * 2 * math.pi)
            interchange_rows.append((ts, a, b, mag + RNG.gauss(0, 100), "DEMO"))
            interchange_rows.append((ts, b, a, -mag + RNG.gauss(0, 100), "DEMO"))

    n_demand = upsert_rows(
        "raw.demand",
        ["period_utc", "ba_code", "value_mwh", "series", "source"],
        ["period_utc", "ba_code", "series", "source"],
        demand_rows,
    )
    n_fcast = upsert_rows(
        "raw.demand_forecast",
        ["period_utc", "ba_code", "value_mwh", "source"],
        ["period_utc", "ba_code", "source"],
        forecast_rows,
    )
    n_gen = upsert_rows(
        "raw.generation",
        ["period_utc", "ba_code", "fuel_code", "value_mwh", "source"],
        ["period_utc", "ba_code", "fuel_code", "source"],
        gen_rows,
    )
    n_int = upsert_rows(
        "raw.interchange",
        ["period_utc", "from_ba", "to_ba", "value_mwh", "source"],
        ["period_utc", "from_ba", "to_ba", "source"],
        interchange_rows,
    )

    totals = {
        "demand": n_demand,
        "demand_forecast": n_fcast,
        "generation": n_gen,
        "interchange": n_int,
    }
    log.info(f"demo seed totals: {totals}")
    return totals


def purge_demo() -> dict[str, int]:
    """Remove all rows where source='DEMO'."""
    from sqlalchemy import text

    from ..db import get_engine

    totals: dict[str, int] = {}
    eng = get_engine()
    with eng.begin() as conn:
        for tbl in ("raw.demand", "raw.demand_forecast",
                    "raw.generation", "raw.interchange"):
            r = conn.execute(text(f"DELETE FROM {tbl} WHERE source='DEMO'"))
            totals[tbl] = r.rowcount or 0
    log.info(f"purged: {totals}")
    return totals
