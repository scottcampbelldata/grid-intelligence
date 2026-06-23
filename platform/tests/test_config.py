"""Settings + URL composition."""
from gridintel.config import get_settings


def test_settings_compose_sqlalchemy_url(fake_env):
    s = get_settings()
    assert "postgresql+psycopg://" in s.sqlalchemy_url
    assert "grid_app:test@localhost:5432/grid_intel" in s.sqlalchemy_url


def test_settings_compose_psycopg_dsn(fake_env):
    s = get_settings()
    assert "dbname=grid_intel" in s.psycopg_dsn
    assert "user=grid_app" in s.psycopg_dsn
    assert "host=localhost" in s.psycopg_dsn
    assert "port=5432" in s.psycopg_dsn
