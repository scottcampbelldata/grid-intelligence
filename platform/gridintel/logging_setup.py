"""Structured JSON-friendly logging via loguru."""
from __future__ import annotations

import sys
from pathlib import Path

from loguru import logger

from .config import REPO_ROOT, get_settings

_CONFIGURED = False


def configure_logging(name: str | None = None) -> None:
    """Idempotently configure loguru with console + rotating file sink."""
    global _CONFIGURED
    if _CONFIGURED:
        return

    settings = get_settings()
    logs_dir = REPO_ROOT / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)

    logger.remove()
    logger.add(
        sys.stderr,
        level=settings.gridintel_log_level,
        format=(
            "<green>{time:YYYY-MM-DD HH:mm:ss}</green> | "
            "<level>{level: <8}</level> | "
            "<cyan>{name}</cyan>:<cyan>{function}</cyan> - <level>{message}</level>"
        ),
        backtrace=False,
        diagnose=False,
    )
    fname = f"{name or 'gridintel'}.log"
    logger.add(
        Path(logs_dir / fname),
        level=settings.gridintel_log_level,
        rotation="10 MB",
        retention=5,
        compression="zip",
        serialize=False,
        enqueue=True,
    )
    _CONFIGURED = True


def get_logger(name: str):
    configure_logging(name=name.split(".", maxsplit=1)[0])
    return logger.bind(component=name)
