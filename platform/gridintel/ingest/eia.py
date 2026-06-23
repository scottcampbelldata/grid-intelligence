"""EIA v2 API client - hourly demand / generation / interchange by balancing authority.

EIA documents three RTO endpoints that we use here:

* ``/v2/electricity/rto/region-data/data/`` - hourly demand (D), demand forecast
  (DF), net generation (NG), and total interchange (TI) per balancing authority.
* ``/v2/electricity/rto/fuel-type-data/data/`` - hourly net generation by fuel
  type per balancing authority.
* ``/v2/electricity/rto/interchange-data/data/`` - hourly net interchange between
  pairs of balancing authorities.

EIA returns at most 5000 rows per page; we paginate.
"""
from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any

from ..logging_setup import get_logger
from ._http import is_retryable_status, make_client, retry_policy

log = get_logger(__name__)

EIA_BASE = "https://api.eia.gov/v2"
DEFAULT_PAGE = 5000

# EIA balancing authority code → friendly name. (Top US BAs by load - covers ~85%
# of conterminous-US demand. The full list of ~70 BAs is fetched lazily from
# the API metadata.)
DEFAULT_BAS: dict[str, str] = {
    "PJM":   "PJM Interconnection",
    "MISO":  "Midcontinent ISO",
    "ERCO":  "ERCOT (Texas)",
    "CISO":  "California ISO",
    "SWPP":  "Southwest Power Pool",
    "NYIS":  "New York ISO",
    "ISNE":  "ISO New England",
    "SOCO":  "Southern Company",
    "TVA":   "Tennessee Valley Authority",
    "FPL":   "Florida Power & Light",
    "BPAT":  "Bonneville Power Administration",
    "DUK":   "Duke Energy Carolinas",
    "AECI":  "Associated Electric Cooperative",
    "PACE":  "PacifiCorp East",
    "PACW":  "PacifiCorp West",
    "PSCO":  "Public Service Co of Colorado",
    "AZPS":  "Arizona Public Service",
    "WALC":  "Western Area Power Lower Colorado",
    "SRP":   "Salt River Project",
    "LDWP":  "Los Angeles Dept of Water and Power",
    "NEVP":  "Nevada Power",
    "TEPC":  "Tucson Electric Power",
    "IPCO":  "Idaho Power",
    "AEC":   "PowerSouth Energy Cooperative",
    "JEA":   "Jacksonville Electric Authority",
    "TEC":   "Tampa Electric",
    "FPC":   "Duke Energy Florida",
    "GVL":   "Gainesville Regional Utilities",
    "SCEG":  "Dominion Energy South Carolina",
    "CPLE":  "Duke Energy Progress East",
    "CPLW":  "Duke Energy Progress West",
    "OVEC":  "Ohio Valley Electric",
    "LGEE":  "Louisville Gas and Electric",
    "EPE":   "El Paso Electric",
    "PNM":   "Public Service Co of New Mexico",
    "PSEI":  "Puget Sound Energy",
    "AVA":   "Avista Corp",
    "CHPD":  "Chelan County PUD",
    "DOPD":  "Douglas County PUD",
    "GCPD":  "Grant County PUD",
    "PGE":   "Portland General Electric",
    "TPWR":  "Tacoma Power",
    "SCL":   "Seattle City Light",
    "NWMT":  "NorthWestern Energy",
    "WACM":  "Western Area Power Rocky Mountain",
    "WAUW":  "Western Area Power Upper Missouri",
    "BANC":  "Balancing Authority of Northern California",
    "TIDC":  "Turlock Irrigation District",
    "IID":   "Imperial Irrigation District",
    "GWA":   "NaturEner Power Watch",
    "SPA":   "Southwestern Power Administration",
    "GLHB":  "GridLiance",
    "EEI":   "Electric Energy Inc",
    "HST":   "Homestead",
    "NSB":   "New Smyrna Beach Utilities",
    "SEC":   "Seminole Electric Cooperative",
    "TAL":   "City of Tallahassee",
    "YAD":   "Alcoa Power Yadkin",
    "DEAA":  "Arlington Valley LLC",
    "CSTO":  "Coastal Power",
    "GRMA":  "Gila River Power",
    "GRIF":  "Griffith Energy",
    "HGMA":  "New Harquahala Generating Co",
    "MWAH":  "Modesto Irrigation District",
    "SEPA":  "Southeastern Power Administration",
    "WWA":   "NaturEner Wind Watch",
    "GRID":  "Gridforce Energy Management",
    "GRDA":  "Grand River Dam Authority",
}


class EIAClient:
    def __init__(self, api_key: str, base_url: str = EIA_BASE):
        if not api_key:
            raise ValueError("EIA API key is required - set EIA_API_KEY in .env")
        self._api_key = api_key
        self._base = base_url.rstrip("/")
        self._client = make_client(headers={"User-Agent": "grid-intelligence-platform/0.1"})

    async def __aenter__(self) -> EIAClient:
        return self

    async def __aexit__(self, *exc):
        await self._client.aclose()

    async def close(self):
        await self._client.aclose()

    # ------------------------------------------------------------------ #
    # Low-level paged fetch
    # ------------------------------------------------------------------ #
    async def _paged(
        self,
        path: str,
        params: dict[str, Any],
    ) -> AsyncIterator[dict[str, Any]]:
        offset = 0
        async for attempt in retry_policy():
            with attempt:
                while True:
                    q = {
                        **params,
                        "api_key": self._api_key,
                        "offset": offset,
                        "length": DEFAULT_PAGE,
                    }
                    url = f"{self._base}/{path.lstrip('/')}"
                    resp = await self._client.get(url, params=q)
                    if is_retryable_status(resp):
                        resp.raise_for_status()
                    resp.raise_for_status()
                    payload = resp.json()
                    rows = payload.get("response", {}).get("data") or []
                    for r in rows:
                        yield r
                    if len(rows) < DEFAULT_PAGE:
                        return
                    offset += DEFAULT_PAGE

    # ------------------------------------------------------------------ #
    # Public methods
    # ------------------------------------------------------------------ #
    async def region_data(
        self,
        start: datetime,
        end: datetime,
        series: list[str] | None = None,
        ba_codes: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        """Hourly demand (D), demand forecast (DF), net gen (NG), total interchange (TI).

        ``series`` defaults to all four; ``ba_codes`` defaults to DEFAULT_BAS.
        """
        series = series or ["D", "DF", "NG", "TI"]
        ba_codes = ba_codes or list(DEFAULT_BAS)

        params: dict[str, Any] = {
            "frequency": "hourly",
            "data[0]": "value",
            "start": _fmt(start),
            "end": _fmt(end),
            "sort[0][column]": "period",
            "sort[0][direction]": "desc",
        }
        for i, s in enumerate(series):
            params[f"facets[type][{i}]"] = s
        for i, ba in enumerate(ba_codes):
            params[f"facets[respondent][{i}]"] = ba

        out: list[dict[str, Any]] = []
        async for row in self._paged("electricity/rto/region-data/data/", params):
            out.append(row)
        log.info(f"EIA region-data: {len(out)} rows for {len(ba_codes)} BAs × {len(series)} series")
        return out

    async def fuel_type_data(
        self,
        start: datetime,
        end: datetime,
        ba_codes: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        ba_codes = ba_codes or list(DEFAULT_BAS)
        params: dict[str, Any] = {
            "frequency": "hourly",
            "data[0]": "value",
            "start": _fmt(start),
            "end": _fmt(end),
            "sort[0][column]": "period",
            "sort[0][direction]": "desc",
        }
        for i, ba in enumerate(ba_codes):
            params[f"facets[respondent][{i}]"] = ba

        out: list[dict[str, Any]] = []
        async for row in self._paged("electricity/rto/fuel-type-data/data/", params):
            out.append(row)
        log.info(f"EIA fuel-type-data: {len(out)} rows for {len(ba_codes)} BAs")
        return out

    async def interchange_data(
        self,
        start: datetime,
        end: datetime,
        ba_codes: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        ba_codes = ba_codes or list(DEFAULT_BAS)
        params: dict[str, Any] = {
            "frequency": "hourly",
            "data[0]": "value",
            "start": _fmt(start),
            "end": _fmt(end),
            "sort[0][column]": "period",
            "sort[0][direction]": "desc",
        }
        for i, ba in enumerate(ba_codes):
            params[f"facets[fromba][{i}]"] = ba

        out: list[dict[str, Any]] = []
        async for row in self._paged("electricity/rto/interchange-data/data/", params):
            out.append(row)
        log.info(f"EIA interchange-data: {len(out)} rows for {len(ba_codes)} BAs")
        return out


def _fmt(dt: datetime) -> str:
    """EIA wants 'YYYY-MM-DDTHH' (UTC, no timezone marker)."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    dt = dt.astimezone(UTC)
    return dt.strftime("%Y-%m-%dT%H")


def utc_now_floor_hour() -> datetime:
    return datetime.now(UTC).replace(minute=0, second=0, microsecond=0)


def hours_ago(h: int) -> datetime:
    return utc_now_floor_hour() - timedelta(hours=h)
