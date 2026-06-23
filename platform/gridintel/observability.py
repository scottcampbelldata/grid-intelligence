"""Per-source freshness SLAs for the Operations tab.

Two distinct signals per source, so a genuinely dead/lagging feed is flagged
loudly without crying wolf on feeds that legitimately lag:

* ``fetch_sla_s``  - max age of the last *successful* fetch before the job is
  considered dead. Tuned to ~2-3x the job's cadence. This catches a stopped feed
  uniformly and fast, and is unaffected by upstream data lag because every run
  updates ``last_fetch_utc`` even when it writes 0 rows.
* ``period_sla_s`` - max age of the latest *data* hour before the data itself is
  stale. ``None`` skips the check (forecast feeds are future-dated). EIA's
  fuel-type and interchange feeds publish ~24h behind real time, so their data
  threshold is ~30h while their liveness threshold stays tight.
"""
from __future__ import annotations

HOUR = 3600.0

# source -> (fetch_sla_s, period_sla_s | None)
SOURCE_SLA: dict[str, tuple[float, float | None]] = {
    "EIA-region":      (3 * HOUR, 3 * HOUR),
    "EIA-fuel":        (3 * HOUR, 30 * HOUR),   # EIA fuel-type lags ~24h - realistic, no false alarm
    # EIA interchange (TI by pair) publishes much later than demand - observed
    # frontier ~47h behind while the job runs clean. Generous data-age SLA so we
    # don't flag EIA's normal frontier. TODO: tune once a few days of cadence are
    # observed; the fetch-liveness SLA still catches a truly stopped job in ~3h.
    "EIA-interchange": (3 * HOUR, 54 * HOUR),
    "ENTSOE-load":     (3 * HOUR, 6 * HOUR),
    "ENTSOE-gen":      (3 * HOUR, 6 * HOUR),
    "NOAA":            (0.75 * HOUR, None),     # 15-min cadence; forecast = future-dated, liveness only
    "OpenMeteo":       (0.75 * HOUR, None),
}
DEFAULT_SLA: tuple[float, float | None] = (3 * HOUR, None)


def evaluate_staleness(
    source: str,
    sec_since_fetch: float | None,
    sec_since_period: float | None,
) -> tuple[bool, str | None]:
    """Return ``(is_stale, reason)`` for a source given the ages (in seconds) of
    its last successful fetch and its latest data hour. ``reason`` is a short
    human string for the Operations tab, or ``None`` when healthy."""
    fetch_sla, period_sla = SOURCE_SLA.get(source, DEFAULT_SLA)
    reasons: list[str] = []

    if sec_since_fetch is None:
        reasons.append("never fetched")
    elif sec_since_fetch > fetch_sla:
        reasons.append(
            f"no successful fetch in {sec_since_fetch / HOUR:.1f}h (SLA {fetch_sla / HOUR:.0f}h)"
        )

    if period_sla is not None and sec_since_period is not None and sec_since_period > period_sla:
        reasons.append(
            f"data {sec_since_period / HOUR:.1f}h old (SLA {period_sla / HOUR:.0f}h)"
        )

    return (bool(reasons), "; ".join(reasons) or None)
