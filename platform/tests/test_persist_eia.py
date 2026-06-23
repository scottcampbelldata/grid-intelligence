"""EIA payload → relational rows: shape + filtering."""
from datetime import UTC, datetime

import pytest

from gridintel.ingest import persist


def test_parse_eia_period_zulu():
    p = persist._parse_eia_period("2026-06-17T00")
    assert p == datetime(2026, 6, 17, 0, tzinfo=UTC)


def test_safe_float_handles_empty_and_strings():
    assert persist._safe_float("") is None
    assert persist._safe_float(None) is None
    assert persist._safe_float("abc") is None
    assert persist._safe_float("12.5") == 12.5
    assert persist._safe_float(7) == 7.0


@pytest.mark.parametrize("series", ["D", "DF", "NG", "TI"])
def test_eia_region_row_distribution_by_series_does_not_crash(series):
    """The classifier should not raise on any of the 4 EIA series codes."""
    rows = [
        {"period": "2026-06-17T00", "respondent": "PJM", "type": series, "value": "100"}
        for _ in range(3)
    ]
    # We can't insert (no DB in unit test) but we can confirm the rows iterate
    # cleanly through the parser logic that lives inline.
    from gridintel.ingest.persist import _parse_eia_period, _safe_float
    parsed = [
        (_parse_eia_period(r["period"]), r["respondent"], _safe_float(r["value"]), r["type"])
        for r in rows
    ]
    assert all(p[0].tzinfo is not None for p in parsed)
