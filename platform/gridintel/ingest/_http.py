"""Shared HTTP client and retry policy for all ingestion sources."""
from __future__ import annotations

import httpx
from tenacity import (
    AsyncRetrying,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential_jitter,
)

DEFAULT_TIMEOUT = httpx.Timeout(connect=10.0, read=60.0, write=10.0, pool=10.0)
DEFAULT_LIMITS = httpx.Limits(max_connections=20, max_keepalive_connections=10)

TRANSIENT_EXCEPTIONS = (
    httpx.ConnectError,
    httpx.ReadError,
    httpx.RemoteProtocolError,
    httpx.ReadTimeout,
    httpx.WriteTimeout,
    httpx.ConnectTimeout,
    httpx.PoolTimeout,
)


def make_client(headers: dict | None = None) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=DEFAULT_TIMEOUT,
        limits=DEFAULT_LIMITS,
        headers=headers or {},
        follow_redirects=True,
        http2=False,
    )


def retry_policy(max_attempts: int = 5) -> AsyncRetrying:
    """Exponential-jitter backoff for transient network + 5xx errors."""
    return AsyncRetrying(
        reraise=True,
        stop=stop_after_attempt(max_attempts),
        wait=wait_exponential_jitter(initial=1.0, max=30.0),
        retry=retry_if_exception_type(TRANSIENT_EXCEPTIONS + (httpx.HTTPStatusError,)),
    )


def is_retryable_status(resp: httpx.Response) -> bool:
    return resp.status_code >= 500 or resp.status_code == 429
