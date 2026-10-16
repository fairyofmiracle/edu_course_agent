from __future__ import annotations

import hashlib
import ipaddress
from typing import Any, Protocol
from urllib.parse import urlparse

import httpx

ProbeState = str


class _Response(Protocol):
    status_code: int


class _Stream(Protocol):
    def __enter__(self) -> _Response: ...

    def __exit__(self, *args: object) -> bool: ...


class UrlOpener(Protocol):
    def stream(self, method: str, url: str) -> _Stream: ...


def public_http_url(url: str) -> bool:
    parsed = urlparse(url.strip())
    host = (parsed.hostname or "").lower()
    if parsed.scheme not in {"http", "https"} or not host:
        return False
    if host in {"localhost", "127.0.0.1", "::1"}:
        return False
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return True
    return not (address.is_private or address.is_loopback or address.is_link_local or address.is_reserved)


_STAMP_LIMIT = 65536


def _result(
    url: str,
    state: ProbeState,
    message: str,
    fingerprint: str = "",
) -> dict[str, str]:
    return {"url": url, "state": state, "message": message, "fingerprint": fingerprint}


def page_stamp(response: object) -> str:
    """Отметка страницы без сохранения текста: заголовки и хеш первых 64 КБ."""
    headers = getattr(response, "headers", None)
    etag = ""
    modified = ""
    if headers is not None and hasattr(headers, "get"):
        etag = str(headers.get("etag") or "")
        modified = str(headers.get("last-modified") or "")
    digest = hashlib.sha256()
    read = 0
    reader = getattr(response, "iter_bytes", None)
    if callable(reader):
        for chunk in reader():
            if read >= _STAMP_LIMIT:
                break
            if not isinstance(chunk, (bytes, bytearray)):
                continue
            piece = bytes(chunk[: _STAMP_LIMIT - read])
            digest.update(piece)
            read += len(piece)
    body = digest.hexdigest() if read else ""
    if not etag and not modified and not body:
        return ""
    return f"{etag}|{modified}|{body}"


def probe_url(url: str, opener: UrlOpener | None = None) -> dict[str, str]:
    """Открывает ссылку. Текст приказа не сохраняется, остаётся только отметка страницы."""
    target = url.strip()
    if not public_http_url(target):
        return _result(
            target,
            "not_checked",
            "Проверяем только публичные http- и https-ссылки. Документ не подтверждён.",
        )

    close = opener is None
    client = opener or httpx.Client(
        timeout=httpx.Timeout(4.0, connect=3.0),
        follow_redirects=True,
        headers={"User-Agent": "edu-course-studio/0.1"},
    )
    try:
        try:
            with client.stream("GET", target) as response:
                code = response.status_code
                stamp = page_stamp(response) if 200 <= code < 400 else ""
        except httpx.TimeoutException:
            return _result(
                target,
                "unavailable",
                "Сайт не ответил за 4 секунды. Приказ не подтверждён, повторите проверку позже.",
            )
        except httpx.HTTPError:
            return _result(
                target,
                "unavailable",
                "Сайт недоступен. Приказ не подтверждён и не заменяется локальной копией.",
            )

        if code in {404, 410}:
            return _result(
                target,
                "not_found",
                f"Страница ответила {code}. Ссылка не открывает документ, приказ не подтверждён.",
            )
        if code in {401, 403, 429}:
            return _result(
                target,
                "blocked",
                f"Сайт ответил {code} и не отдал страницу. Это не подтверждение приказа.",
            )
        if 200 <= code < 400:
            return _result(
                target,
                "reachable",
                f"Сайт ответил {code}. Текст не сохранён: действующим документ признаёт методист.",
                stamp,
            )
        return _result(
            target,
            "unavailable",
            f"Сайт ответил {code}. Приказ не подтверждён.",
        )
    finally:
        if close:
            client.close()


def probe_urls(urls: list[str], opener: UrlOpener | None = None) -> list[dict[str, Any]]:
    return [probe_url(url, opener) for url in urls]
