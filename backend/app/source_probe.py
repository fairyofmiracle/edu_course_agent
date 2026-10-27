from __future__ import annotations

import hashlib
import ipaddress
import socket
from typing import Any, Protocol
from urllib.parse import urljoin, urlparse

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
    return _public_ip(address)


_CGNAT = ipaddress.ip_network("100.64.0.0/10")


def _public_ip(address: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
        return _public_ip(address.ipv4_mapped)
    if isinstance(address, ipaddress.IPv4Address) and address in _CGNAT:
        return False
    return not (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_reserved
        or address.is_multicast
        or address.is_unspecified
    )


def host_is_public(url: str) -> bool:
    """Имя хоста режется по DNS. Внутренний адрес не открываем."""
    host = (urlparse(url).hostname or "").strip("[]")
    if not host:
        return False
    try:
        addresses = {ipaddress.ip_address(host)}
    except ValueError:
        try:
            infos = socket.getaddrinfo(host, None)
        except socket.gaierror:
            return False
        addresses = set()
        for info in infos:
            raw = str(info[4][0]).split("%", 1)[0]
            try:
                addresses.add(ipaddress.ip_address(raw))
            except ValueError:
                return False
    return bool(addresses) and all(_public_ip(item) for item in addresses)


_STAMP_LIMIT = 65536


def _result(
    url: str,
    state: ProbeState,
    message: str,
    fingerprint: str = "",
    requisites: str = "unchecked",
) -> dict[str, str]:
    return {
        "url": url,
        "state": state,
        "message": message,
        "fingerprint": fingerprint,
        "requisites": requisites,
    }


def _needle(expect: str) -> str:
    return "".join(ch for ch in expect.casefold() if ch.isalnum())


def page_stamp(response: object, expect: str = "") -> tuple[str, str]:
    """Отметка страницы без сохранения текста. Номер документа ищется и тут же забывается."""
    headers = getattr(response, "headers", None)
    etag = ""
    modified = ""
    if headers is not None and hasattr(headers, "get"):
        etag = str(headers.get("etag") or "")
        modified = str(headers.get("last-modified") or "")
    digest = hashlib.sha256()
    read = 0
    needle = _needle(expect)
    requisites = "missing" if needle else "unchecked"
    carry = ""
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
            if needle and requisites != "found":
                text = piece.decode("utf-8", errors="ignore").casefold()
                window = carry + text
                if needle in window:
                    requisites = "found"
                carry = window[-80:]
    body = digest.hexdigest() if read else ""
    if not etag and not modified and not body:
        return "", "unchecked" if not needle else requisites
    return f"{etag}|{modified}|{body}", requisites


def probe_url(
    url: str,
    opener: UrlOpener | None = None,
    expect: str = "",
    _hops: int = 0,
) -> dict[str, str]:
    """Открывает ссылку. Текст приказа не сохраняется, остаётся только отметка страницы."""
    target = url.strip()
    if _hops > 3:
        return _result(
            target,
            "unavailable",
            "Слишком много перенаправлений. Приказ не подтверждён.",
        )
    if not public_http_url(target):
        return _result(
            target,
            "not_checked",
            "Проверяем только публичные http- и https-ссылки. Документ не подтверждён.",
        )
    real_client = opener is None or isinstance(opener, httpx.Client)
    if real_client and not host_is_public(target):
        return _result(
            target,
            "not_checked",
            "Адрес ведёт во внутреннюю сеть. Документ не подтверждён.",
        )

    close = opener is None
    client = opener or httpx.Client(
        timeout=httpx.Timeout(4.0, connect=3.0),
        follow_redirects=False,
        headers={"User-Agent": "edu-course-studio/0.1"},
    )
    try:
        try:
            with client.stream("GET", target) as response:
                code = response.status_code
                location = ""
                if 300 <= code < 400:
                    headers = getattr(response, "headers", None)
                    if headers is not None and hasattr(headers, "get"):
                        location = str(headers.get("location") or "")
                    stamp, requisites = "", "unchecked"
                else:
                    stamp, requisites = (
                        page_stamp(response, expect) if 200 <= code < 400 else ("", "unchecked")
                    )
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

        if 300 <= code < 400:
            if not location:
                return _result(
                    target,
                    "unavailable",
                    "Сайт перенаправил без адреса. Приказ не подтверждён.",
                )
            return probe_url(urljoin(target, location), client, expect, _hops + 1)

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
            if requisites == "missing":
                return _result(
                    target,
                    "reachable",
                    f"Сайт ответил {code}, но номер документа на странице не найден. Источник не подтверждён.",
                    stamp,
                    requisites,
                )
            if requisites == "found":
                return _result(
                    target,
                    "reachable",
                    f"Сайт ответил {code}. Номер документа на странице есть. Текст не сохранён, действующим документ признаёт методист.",
                    stamp,
                    requisites,
                )
            return _result(
                target,
                "reachable",
                f"Сайт ответил {code}. Текст не сохранён: действующим документ признаёт методист.",
                stamp,
                requisites,
            )
        return _result(
            target,
            "unavailable",
            f"Сайт ответил {code}. Приказ не подтверждён.",
        )
    finally:
        if close:
            client.close()


def probe_urls(
    urls: list[str],
    opener: UrlOpener | None = None,
    expect: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    numbers = expect or {}
    return [probe_url(url, opener, expect=str(numbers.get(url) or "")[:40]) for url in urls]
