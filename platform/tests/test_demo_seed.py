"""Demo seed determinism + idempotency (property-based)."""
from __future__ import annotations

from datetime import UTC

from hypothesis import given
from hypothesis import strategies as st

from gridintel.ingest.demo_seed import BA_PROFILE, REGION_MIX, _diurnal, _weekday_factor


@given(hour=st.integers(min_value=0, max_value=23))
def test_diurnal_shape_in_unit_interval(hour: int):
    val = _diurnal(hour)
    assert 0.6 <= val <= 1.0


def test_diurnal_peaks_in_morning_and_evening():
    # Trough around 4am; peak around 8am or 19h.
    troughs = [_diurnal(h) for h in (3, 4, 5)]
    peaks = [_diurnal(h) for h in (8, 18, 19)]
    assert max(peaks) > max(troughs) + 0.15


@given(weekday=st.integers(min_value=0, max_value=6))
def test_weekday_factor_dampens_weekends(weekday: int):
    from datetime import datetime, timedelta

    base = datetime(2026, 6, 15, 12, tzinfo=UTC)  # Mon
    dt = base + timedelta(days=weekday)
    f = _weekday_factor(dt)
    if weekday >= 5:
        assert f == 0.92
    else:
        assert f == 1.0


def test_region_mix_sums_close_to_one():
    for region, mix in REGION_MIX.items():
        total = sum(mix.values())
        assert 0.95 <= total <= 1.05, f"{region}={total}"


def test_every_ba_has_profile_and_region():
    for ba, (base, peak, region) in BA_PROFILE.items():
        assert base < peak, f"{ba}: base {base} >= peak {peak}"
        assert region in REGION_MIX
