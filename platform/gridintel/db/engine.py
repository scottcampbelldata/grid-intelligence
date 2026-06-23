"""Postgres connection helpers - SQLAlchemy engine + raw psycopg + bulk upsert."""
from __future__ import annotations

from collections.abc import Iterable, Iterator, Sequence
from contextlib import contextmanager
from functools import lru_cache
from typing import Any

import psycopg
from psycopg.rows import dict_row
from sqlalchemy import Engine, create_engine

from ..config import get_settings


@lru_cache
def get_engine() -> Engine:
    s = get_settings()
    return create_engine(
        s.sqlalchemy_url,
        pool_size=5,
        max_overflow=10,
        pool_pre_ping=True,
        future=True,
    )


@contextmanager
def get_sync_conn() -> Iterator[psycopg.Connection]:
    s = get_settings()
    conn = psycopg.connect(s.psycopg_dsn, autocommit=False, row_factory=dict_row)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def upsert_rows(
    table: str,
    columns: Sequence[str],
    conflict_cols: Sequence[str],
    rows: Iterable[Sequence[Any]],
    update_cols: Sequence[str] | None = None,
) -> int:
    """ON CONFLICT UPSERT using executemany. Returns row count attempted."""
    rows = list(rows)
    if not rows:
        return 0
    update_cols = update_cols or [c for c in columns if c not in conflict_cols]
    col_list = ", ".join(f'"{c}"' for c in columns)
    placeholders = ", ".join(["%s"] * len(columns))
    conflict_list = ", ".join(f'"{c}"' for c in conflict_cols)
    update_assign = ", ".join(f'"{c}" = EXCLUDED."{c}"' for c in update_cols)
    sql = (
        f'INSERT INTO {table} ({col_list}) VALUES ({placeholders}) '
        f'ON CONFLICT ({conflict_list}) DO UPDATE SET {update_assign}'
    )
    with get_sync_conn() as conn, conn.cursor() as cur:
        cur.executemany(sql, rows)
    return len(rows)


def copy_rows(
    table: str,
    columns: Sequence[str],
    rows: Iterable[Sequence[Any]],
) -> int:
    """Fast COPY for append-only loads. Returns rows inserted."""
    col_list = ", ".join(f'"{c}"' for c in columns)
    sql = f'COPY {table} ({col_list}) FROM STDIN'
    n = 0
    with get_sync_conn() as conn, conn.cursor() as cur, cur.copy(sql) as cp:
        for r in rows:
            cp.write_row(r)
            n += 1
    return n
