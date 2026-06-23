"""Shared test fixtures."""
from __future__ import annotations

from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture(autouse=True)
def _no_loguru_pollution(monkeypatch):
    """Quiet loguru in tests so test output stays clean."""
    from loguru import logger

    logger.remove()
    yield


@pytest.fixture
def fake_env(monkeypatch):
    """Set minimum env vars so :func:`gridintel.config.get_settings` works
    without a real .env file."""
    monkeypatch.setenv("PGHOST", "localhost")
    monkeypatch.setenv("PGPORT", "5432")
    monkeypatch.setenv("PGDATABASE", "grid_intel")
    monkeypatch.setenv("PGUSER", "grid_app")
    monkeypatch.setenv("PGPASSWORD", "test")
    monkeypatch.setenv("EIA_API_KEY", "test-key")
    monkeypatch.setenv("ENTSOE_API_KEY", "test-key")
    monkeypatch.setenv("NOAA_USER_AGENT", "grid-intel-test (test@example.com)")
    # Cached settings - force reread
    from gridintel import config
    config.get_settings.cache_clear()
    yield
