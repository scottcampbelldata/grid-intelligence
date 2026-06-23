"""ML jobs - short-horizon demand forecast + residual-based anomaly detection.

* :func:`run_demand_forecast` - per-BA SARIMAX forecast over the next
  :data:`Settings.gridintel_forecast_horizon_h` hours. Uses :mod:`statsmodels`
  (no Prophet - keeps the install Windows-friendly).
* :func:`run_anomaly_scan` - compares the most recent realised demand vs an
  expected value (EMA + diurnal naive forecast). Z-scores the residual and
  classifies severity.
"""
from __future__ import annotations

import asyncio
import warnings

import numpy as np
import pandas as pd
from sqlalchemy import text

from ..config import get_settings
from ..db import get_engine, upsert_rows
from ..logging_setup import get_logger

log = get_logger(__name__)


# ---------------------------------------------------------------------------
# Forecast (SARIMAX per BA)
# ---------------------------------------------------------------------------
async def run_demand_forecast() -> int:
    """Fit a short SARIMAX(1,0,1)(1,0,1,24) per BA on the last 14 days of
    realised demand and forecast the next horizon hours. Writes to
    ``ml.demand_forecast``.
    """
    s = get_settings()
    horizon = s.gridintel_forecast_horizon_h
    eng = get_engine()
    with eng.begin() as conn:
        bas = [r[0] for r in conn.execute(text("""
            SELECT DISTINCT ba_code
            FROM raw.demand
            WHERE series='D' AND period_utc > now() - interval '14 days'
        """)).all()]

    log.info(f"forecast: {len(bas)} BAs, horizon={horizon}h")
    if not bas:
        return 0

    # Fit concurrently - statsmodels itself is not async but we can offload
    # to a thread pool.
    sem = asyncio.Semaphore(4)
    tasks = [_forecast_one(ba, horizon, sem) for ba in bas]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    rows: list[tuple] = []
    for r in results:
        if isinstance(r, Exception):
            log.warning(f"forecast failed: {r}")
            continue
        rows.extend(r)
    if not rows:
        return 0
    n = upsert_rows(
        "ml.demand_forecast",
        ["period_utc", "ba_code", "yhat_mwh", "yhat_lower", "yhat_upper", "model_name"],
        ["period_utc", "ba_code", "model_name"],
        rows,
    )
    log.info(f"forecast persisted: {n}")
    return n


async def _forecast_one(ba: str, horizon: int, sem: asyncio.Semaphore) -> list[tuple]:
    async with sem:
        return await asyncio.to_thread(_forecast_one_sync, ba, horizon)


def _forecast_one_sync(ba: str, horizon: int) -> list[tuple]:
    eng = get_engine()
    with eng.begin() as conn:
        df = pd.read_sql(text("""
            SELECT period_utc, value_mwh
            FROM raw.demand
            WHERE ba_code = :ba AND series='D' AND period_utc > now() - interval '14 days'
            ORDER BY period_utc
        """), conn, params={"ba": ba})
    df = df.dropna()
    if len(df) < 72:
        return []
    df = df.set_index("period_utc")
    df = df[~df.index.duplicated(keep="last")]
    df = df.asfreq("h")  # fill missing hours with NaN
    df["value_mwh"] = df["value_mwh"].interpolate(method="linear").ffill().bfill()

    # Robust fit: small SARIMAX, fail-soft to seasonal-naive on convergence error.
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            from statsmodels.tsa.statespace.sarimax import SARIMAX
            model = SARIMAX(
                df["value_mwh"],
                order=(1, 0, 1),
                seasonal_order=(1, 0, 1, 24),
                enforce_stationarity=False,
                enforce_invertibility=False,
            )
            fit = model.fit(disp=False, maxiter=50)
            fc = fit.get_forecast(steps=horizon)
            mean = fc.predicted_mean
            ci = fc.conf_int(alpha=0.2)
            model_name = "SARIMAX(1,0,1)(1,0,1,24)"
    except Exception as e:
        log.debug(f"SARIMAX failed for {ba} ({e}); using seasonal-naive")
        last_24 = df["value_mwh"].tail(24).to_numpy()
        idx = pd.date_range(df.index[-1] + pd.Timedelta(hours=1), periods=horizon, freq="h")
        reps = int(np.ceil(horizon / 24))
        mean_vals = np.tile(last_24, reps)[:horizon]
        mean = pd.Series(mean_vals, index=idx, name="value_mwh")
        std = float(np.nanstd(df["value_mwh"].tail(168))) or 1.0
        ci = pd.DataFrame({
            "lower": mean.values - 1.28 * std,
            "upper": mean.values + 1.28 * std,
        }, index=mean.index)
        model_name = "seasonal-naive-24h"

    out: list[tuple] = []
    for ts, yhat in mean.items():
        if pd.isna(yhat):
            continue
        lo = float(ci.iloc[mean.index.get_loc(ts), 0])
        hi = float(ci.iloc[mean.index.get_loc(ts), 1])
        out.append((ts.to_pydatetime(), ba, float(yhat), lo, hi, model_name))
    return out


# ---------------------------------------------------------------------------
# Anomaly scan
# ---------------------------------------------------------------------------
async def run_anomaly_scan() -> int:
    """Compare every BA's most recent 24 hours of realised demand against an
    expected baseline computed from the last 14 days.

    Expected value = EMA(168h) baseline modulated by the hour-of-day diurnal
    profile from the last 14 days. Residuals are z-scored using the rolling
    std of the residual stream over 14 days. A magnitude of |z| >= 3 is
    flagged as a critical anomaly, |z| >= 2 as a warning.
    """
    eng = get_engine()
    with eng.begin() as conn:
        bas = [r[0] for r in conn.execute(text("""
            SELECT DISTINCT ba_code FROM raw.demand
            WHERE series='D' AND period_utc > now() - interval '14 days'
        """)).all()]
    log.info(f"anomaly scan: {len(bas)} BAs")

    sem = asyncio.Semaphore(8)
    tasks = [_anomaly_one(ba, sem) for ba in bas]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    rows: list[tuple] = []
    for r in results:
        if isinstance(r, Exception):
            log.warning(f"anomaly fail: {r}")
            continue
        rows.extend(r)
    if not rows:
        return 0
    n = upsert_rows(
        "ml.demand_anomaly",
        ["period_utc", "ba_code", "actual_mwh", "expected_mwh", "residual_mwh",
         "z_score", "is_anomaly", "severity"],
        ["period_utc", "ba_code"],
        rows,
    )
    log.info(f"anomalies persisted: {n}")
    return n


async def _anomaly_one(ba: str, sem: asyncio.Semaphore) -> list[tuple]:
    async with sem:
        return await asyncio.to_thread(_anomaly_one_sync, ba)


def _anomaly_one_sync(ba: str) -> list[tuple]:
    eng = get_engine()
    with eng.begin() as conn:
        df = pd.read_sql(text("""
            SELECT period_utc, value_mwh
            FROM raw.demand
            WHERE ba_code = :ba AND series='D' AND period_utc > now() - interval '14 days'
            ORDER BY period_utc
        """), conn, params={"ba": ba})
    df = df.dropna()
    if len(df) < 72:
        return []
    df = df.set_index("period_utc")
    df = df[~df.index.duplicated(keep="last")].asfreq("h")
    df["value_mwh"] = df["value_mwh"].interpolate(method="linear").ffill().bfill()

    df["hour"] = df.index.hour
    diurnal = df.groupby("hour")["value_mwh"].mean()
    baseline = df["value_mwh"].rolling(168, min_periods=24).mean()
    df["expected"] = baseline.shift(1) * (df["hour"].map(diurnal) / diurnal.mean())
    df["expected"] = df["expected"].bfill().ffill()
    df["residual"] = df["value_mwh"] - df["expected"]
    std = df["residual"].rolling(168, min_periods=24).std()
    std = std.replace(0, np.nan).bfill().ffill()
    df["z"] = (df["residual"] / std).fillna(0.0)

    # Score the most recent 24 hours only (we re-score on every run so already
    # scored hours get their z refined as more data arrives).
    recent = df.tail(24)
    out: list[tuple] = []
    for ts, row in recent.iterrows():
        z = float(row["z"])
        is_anom = abs(z) >= 2.0
        sev = (
            "critical" if abs(z) >= 3.0
            else "warn"  if abs(z) >= 2.0
            else "info"
        )
        out.append((
            ts.to_pydatetime(),
            ba,
            float(row["value_mwh"]),
            float(row["expected"]),
            float(row["residual"]),
            z,
            is_anom,
            sev,
        ))
    return out
