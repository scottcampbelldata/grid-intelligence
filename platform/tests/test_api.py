"""FastAPI shape + routing tests using the testclient."""
from fastapi.testclient import TestClient

from gridintel.api.main import app


def test_app_routes_registered():
    paths = {r.path for r in app.routes if hasattr(r, "path")}
    for must in (
        "/healthz",
        "/v1/freshness",
        "/v1/ingest-runs",
        "/v1/balancing-authorities",
        "/v1/demand/latest",
        "/v1/demand/headline",
        "/v1/generation/mix",
        "/v1/generation/share",
        "/v1/interchange/flows",
        "/v1/anomalies/recent",
        "/v1/forecast/{ba_code}",
        "/v1/weather/latest",
        "/v1/europe/load",
        "/v1/europe/weather",
    ):
        assert must in paths, f"missing route {must}"


def test_openapi_schema_includes_all_endpoints():
    client = TestClient(app)
    r = client.get("/openapi.json")
    assert r.status_code == 200
    schema = r.json()
    assert schema["info"]["title"].startswith("Grid Intelligence")
    assert "/v1/demand/headline" in schema["paths"]
