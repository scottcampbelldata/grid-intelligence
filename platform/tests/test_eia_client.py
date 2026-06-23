"""EIA client unit tests - mocked HTTP via respx."""
from __future__ import annotations

from datetime import UTC, datetime

import httpx
import pytest
import respx

from gridintel.ingest.eia import DEFAULT_BAS, EIAClient


@pytest.mark.asyncio
@respx.mock(base_url="https://api.eia.gov/v2")
async def test_eia_region_data_paginates_and_assembles(respx_mock):
    """Two pages × 5000 rows then a short page that terminates iteration."""
    pages = [
        {"response": {"data": [
            {"period": "2026-06-17T00", "respondent": "PJM", "type": "D", "value": str(100_000 + i)}
            for i in range(5000)
        ]}},
        {"response": {"data": [
            {"period": "2026-06-17T00", "respondent": "PJM", "type": "D", "value": "1"}
        ]}},
    ]
    seq = iter(pages)
    respx_mock.get("/electricity/rto/region-data/data/").mock(
        side_effect=lambda req: httpx.Response(200, json=next(seq))
    )
    async with EIAClient(api_key="test") as cli:
        rows = await cli.region_data(
            start=datetime(2026, 6, 17, 0, tzinfo=UTC),
            end=datetime(2026, 6, 17, 1, tzinfo=UTC),
            series=["D"],
            ba_codes=["PJM"],
        )
    assert len(rows) == 5001
    assert rows[0]["respondent"] == "PJM"


@pytest.mark.asyncio
async def test_eia_client_rejects_empty_key():
    with pytest.raises(ValueError, match="EIA API key is required"):
        EIAClient(api_key="")


def test_default_bas_includes_major_isos():
    for ba in ("PJM", "MISO", "ERCO", "CISO", "NYIS"):
        assert ba in DEFAULT_BAS
