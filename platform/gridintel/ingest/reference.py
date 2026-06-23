"""Seed static reference / dimension tables.

These are reference data, not time series:

* ``raw.balancing_authority`` - BA metadata, sourced from the dbt seed
  ``dbt/seeds/balancing_authority_meta.csv`` (the repo's canonical BA list).
* ``raw.weather_station`` - one centroid pseudo-station per BA, sourced from
  :data:`gridintel.ingest.noaa.BA_CENTROIDS` (the same coordinates the NOAA
  ingest uses to call the gridded-forecast API).
* ``raw.eu_weather_zone`` - one centroid per European bidding zone, sourced from
  :data:`gridintel.ingest.openmeteo.EUROPE_ZONE_CENTROIDS` (the same coordinates
  the Open-Meteo ingest uses) with names from
  :data:`gridintel.ingest.entsoe.DEFAULT_ZONES`. The EU parallel to
  ``raw.weather_station``.

``raw.weather_station.ba_code`` has a foreign key to
``raw.balancing_authority(ba_code)``, so the BA dimension is upserted first.

Idempotent: :func:`seed_reference` upserts all tables, so re-running is safe and
the populated tables are reproducible from a fresh clone via
``gridintel seed-reference``.
"""
from __future__ import annotations

import csv

from ..config import REPO_ROOT
from ..db import upsert_rows
from ..logging_setup import get_logger
from .entsoe import DEFAULT_ZONES
from .noaa import BA_CENTROIDS
from .openmeteo import EUROPE_ZONE_CENTROIDS

log = get_logger(__name__)

BA_META_CSV = REPO_ROOT / "dbt" / "seeds" / "balancing_authority_meta.csv"


def _load_ba_meta() -> dict[str, dict[str, str]]:
    """ba_code -> {ba_name, region, country, timezone} from the dbt seed CSV."""
    meta: dict[str, dict[str, str]] = {}
    with BA_META_CSV.open(newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            code = (row.get("ba_code") or "").strip()
            if code:
                meta[code] = row
    return meta


def seed_reference() -> dict[str, int]:
    """Upsert ``raw.balancing_authority`` then ``raw.weather_station``.

    Returns the number of rows upserted into each table.
    """
    meta = _load_ba_meta()

    # Union of BAs from the CSV and any centroid-only codes (e.g. IID, absent from
    # the CSV) so the weather_station FK to balancing_authority always resolves.
    ba_codes = sorted(set(meta) | set(BA_CENTROIDS))
    ba_rows = []
    for code in ba_codes:
        m = meta.get(code, {})
        ba_rows.append((
            code,
            (m.get("ba_name") or code).strip(),       # fall back to code if unnamed
            (m.get("region") or "").strip() or None,
            (m.get("country") or "").strip() or "US",
            (m.get("timezone") or "").strip() or None,
        ))
    n_ba = upsert_rows(
        "raw.balancing_authority",
        ["ba_code", "ba_name", "region", "country", "timezone"],
        ["ba_code"],
        ba_rows,
    )

    # station_id = 'BA:<code>' to match raw.weather.station_id; ba_code is the bare
    # code that the API joins on (after stripping the 'BA:' prefix).
    station_rows = [
        (f"BA:{code}", code, lat, lon)
        for code, (lat, lon) in sorted(BA_CENTROIDS.items())
    ]
    n_ws = upsert_rows(
        "raw.weather_station",
        ["station_id", "ba_code", "latitude", "longitude"],
        ["station_id"],
        station_rows,
    )

    # European bidding-zone centroids - EU parallel to weather_station. zone_eic
    # is the bare ENTSO-E EIC code; the API joins it to 'EU:<eic>' station ids.
    eu_rows = [
        (eic, DEFAULT_ZONES.get(eic, eic), lat, lon)
        for eic, (lat, lon) in sorted(EUROPE_ZONE_CENTROIDS.items())
    ]
    n_eu = upsert_rows(
        "raw.eu_weather_zone",
        ["zone_eic", "zone_name", "latitude", "longitude"],
        ["zone_eic"],
        eu_rows,
    )

    log.info(
        f"seed-reference: balancing_authority={n_ba}, weather_station={n_ws}, "
        f"eu_weather_zone={n_eu}"
    )
    return {
        "balancing_authority": n_ba,
        "weather_station": n_ws,
        "eu_weather_zone": n_eu,
    }
