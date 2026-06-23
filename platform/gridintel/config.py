"""Centralized configuration loaded from environment + .env."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    """Process-wide settings.

    Values override in priority order: environment > .env > defaults.
    """

    model_config = SettingsConfigDict(
        env_file=str(REPO_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    pghost: str = "localhost"
    pgport: int = 5432
    pgdatabase: str = "grid_intel"
    pguser: str = "grid_app"
    pgpassword: str = ""

    eia_api_key: str = ""
    entsoe_api_key: str = ""
    noaa_user_agent: str = "grid-intelligence-platform (contact@example.com)"

    gridintel_api_port: int = Field(default=8787, alias="GRIDINTEL_API_PORT")
    gridintel_log_level: str = Field(default="INFO", alias="GRIDINTEL_LOG_LEVEL")
    gridintel_backfill_hours: int = Field(default=168, alias="GRIDINTEL_BACKFILL_HOURS")
    gridintel_forecast_horizon_h: int = Field(default=24, alias="GRIDINTEL_FORECAST_HORIZON_H")

    @property
    def sqlalchemy_url(self) -> str:
        return (
            f"postgresql+psycopg://{self.pguser}:{self.pgpassword}"
            f"@{self.pghost}:{self.pgport}/{self.pgdatabase}"
        )

    @property
    def psycopg_dsn(self) -> str:
        return (
            f"host={self.pghost} port={self.pgport} dbname={self.pgdatabase} "
            f"user={self.pguser} password={self.pgpassword}"
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
