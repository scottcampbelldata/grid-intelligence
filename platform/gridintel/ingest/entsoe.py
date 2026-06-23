"""ENTSO-E Transparency Platform API client - European grid load + generation.

ENTSO-E returns XML; we parse to a flat list of dicts for upsert.

Process types we use:
  * A65 - Actual total load
  * A75 - Actual generation per type
  * A01 - Day-ahead load forecast (used for forecast comparison)

PSR (production type) codes (B01..B20) are mapped to friendly names in
:data:`PSR_TYPE`.

Docs: https://transparency.entsoe.eu/content/static_content/Static%20content/web%20api/Guide.html
"""
from __future__ import annotations

import xml.etree.ElementTree as ET
from datetime import UTC, datetime, timedelta
from typing import Any

from ..logging_setup import get_logger
from ._http import is_retryable_status, make_client, retry_policy

log = get_logger(__name__)

ENTSOE_BASE = "https://web-api.tp.entsoe.eu/api"

# 4-letter EIC area codes for the largest European bidding zones.
DEFAULT_ZONES: dict[str, str] = {
    "10YDE-VE-------2": "Germany (50Hertz)",
    "10YFR-RTE------C": "France",
    "10YGB----------A": "Great Britain",
    "10YES-REE------0": "Spain",
    "10YIT-GRTN-----B": "Italy (North)",
    "10YNL----------L": "Netherlands",
    "10YBE----------2": "Belgium",
    "10YPT-REN------W": "Portugal",
    "10YPL-AREA-----S": "Poland",
    "10YAT-APG------L": "Austria",
    "10YCH-SWISSGRIDZ": "Switzerland",
    "10YDK-1--------W": "Denmark (DK1)",
    "10YDK-2--------M": "Denmark (DK2)",
    "10YNO-2--------T": "Norway (NO2)",
    "10YSE-1--------K": "Sweden (SE1)",
    "10YFI-1--------U": "Finland",
    "10YIE-1001A00010": "Ireland",
    "10YCZ-CEPS-----N": "Czech Republic",
    "10YHU-MAVIR----U": "Hungary",
    "10YGR-HTSO-----Y": "Greece",
}

PSR_TYPE: dict[str, str] = {
    "B01": "Biomass",
    "B02": "Fossil Brown coal/Lignite",
    "B03": "Fossil Coal-derived gas",
    "B04": "Fossil Gas",
    "B05": "Fossil Hard coal",
    "B06": "Fossil Oil",
    "B07": "Fossil Oil shale",
    "B08": "Fossil Peat",
    "B09": "Geothermal",
    "B10": "Hydro Pumped Storage",
    "B11": "Hydro Run-of-river and poundage",
    "B12": "Hydro Water Reservoir",
    "B13": "Marine",
    "B14": "Nuclear",
    "B15": "Other renewable",
    "B16": "Solar",
    "B17": "Waste",
    "B18": "Wind Offshore",
    "B19": "Wind Onshore",
    "B20": "Other",
}

NS = {"ns": "urn:iec62325.351:tc57wg16:451-6:generationloaddocument:3:0"}


def _fmt_period(dt: datetime) -> str:
    """ENTSO-E period uses 'yyyyMMddHHmm' UTC."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    dt = dt.astimezone(UTC)
    return dt.strftime("%Y%m%d%H%M")


class ENTSOEClient:
    def __init__(self, api_key: str, base_url: str = ENTSOE_BASE):
        if not api_key:
            raise ValueError("ENTSO-E API key is required - set ENTSOE_API_KEY in .env")
        self._api_key = api_key
        self._base = base_url
        self._client = make_client(headers={"User-Agent": "grid-intelligence-platform/0.1"})

    async def __aenter__(self) -> ENTSOEClient:
        return self

    async def __aexit__(self, *exc):
        await self._client.aclose()

    async def close(self):
        await self._client.aclose()

    async def _request(self, params: dict[str, Any]) -> bytes | None:
        params = {**params, "securityToken": self._api_key}
        async for attempt in retry_policy():
            with attempt:
                resp = await self._client.get(self._base, params=params)
                if resp.status_code == 200:
                    return resp.content
                if resp.status_code == 400:
                    # ENTSO-E returns 400 for "No matching data found" - treat as empty
                    body = resp.text[:300]
                    if "No matching data" in body or "Acknowledgement" in body:
                        log.debug(f"ENTSO-E: no data for {params.get('outBiddingZone_Domain') or params.get('in_Domain')}")
                        return None
                    log.warning(f"ENTSO-E 400: {body}")
                    return None
                if is_retryable_status(resp):
                    resp.raise_for_status()
                resp.raise_for_status()
        return None

    async def actual_load(
        self,
        zone_eic: str,
        start: datetime,
        end: datetime,
    ) -> list[dict[str, Any]]:
        xml = await self._request({
            "documentType": "A65",
            "processType": "A16",
            "outBiddingZone_Domain": zone_eic,
            "periodStart": _fmt_period(start),
            "periodEnd": _fmt_period(end),
        })
        if not xml:
            return []
        return _parse_timeseries(
            xml,
            zone_eic=zone_eic,
            value_key="value_mw",
            psr=False,
        )

    async def generation_per_type(
        self,
        zone_eic: str,
        start: datetime,
        end: datetime,
    ) -> list[dict[str, Any]]:
        xml = await self._request({
            "documentType": "A75",
            "processType": "A16",
            "in_Domain": zone_eic,
            "periodStart": _fmt_period(start),
            "periodEnd": _fmt_period(end),
        })
        if not xml:
            return []
        return _parse_timeseries(
            xml,
            zone_eic=zone_eic,
            value_key="value_mw",
            psr=True,
        )


def _parse_timeseries(
    xml: bytes,
    zone_eic: str,
    value_key: str,
    psr: bool,
) -> list[dict[str, Any]]:
    root = ET.fromstring(xml)
    out: list[dict[str, Any]] = []
    # ENTSO-E sometimes returns documents under different namespaces depending
    # on schema version; strip namespaces to be forgiving.
    for series in root.iter():
        if not series.tag.endswith("TimeSeries"):
            continue
        psr_type = None
        if psr:
            for child in series.iter():
                if child.tag.endswith("psrType") and child.text:
                    psr_type = child.text
                    break
        for period in series.iter():
            if not period.tag.endswith("Period"):
                continue
            start_node = None
            resolution = None
            for child in period:
                if child.tag.endswith("timeInterval"):
                    for sub in child:
                        if sub.tag.endswith("start") and sub.text:
                            start_node = sub.text
                if child.tag.endswith("resolution") and child.text:
                    resolution = child.text
            if not start_node or not resolution:
                continue
            t0 = datetime.fromisoformat(start_node.replace("Z", "+00:00"))
            step = _resolution_to_delta(resolution)
            for pt in period:
                if not pt.tag.endswith("Point"):
                    continue
                pos = None
                val = None
                for child in pt:
                    if child.tag.endswith("position") and child.text:
                        pos = int(child.text)
                    if (child.tag.endswith("quantity") or child.tag.endswith("price.amount")) and child.text:
                        val = float(child.text)
                if pos is None or val is None:
                    continue
                ts = t0 + step * (pos - 1)
                rec: dict[str, Any] = {
                    "period_utc": ts,
                    "bidding_zone": zone_eic,
                    value_key: val,
                }
                if psr_type:
                    rec["psr_type"] = psr_type
                out.append(rec)
    return out


def _local(tag: str) -> str:
    """Build a local-name XPath bit."""
    return f"local-name()='{tag}'"


def _resolution_to_delta(res: str) -> timedelta:
    # ISO-8601 duration; the only forms ENTSO-E uses are PT15M, PT30M, PT60M, PT1H.
    res = res.upper().lstrip("PT")
    if res.endswith("M"):
        return timedelta(minutes=int(res[:-1]))
    if res.endswith("H"):
        return timedelta(hours=int(res[:-1]))
    return timedelta(hours=1)
