from __future__ import annotations

import re
from datetime import date
from typing import Any, Protocol

import httpx

SOURCE = "https://endoflife.date"
_LIMIT = 6

# Версия обязательна: слово «Python» без номера не считается устаревшим.
_PRODUCTS: tuple[tuple[str, str, re.Pattern[str]], ...] = (
    ("python", "Python", re.compile(r"\bpython\s*(\d+\.\d+)", re.IGNORECASE)),
    ("nodejs", "Node.js", re.compile(r"\bnode(?:\.js)?\s*(\d+)\b", re.IGNORECASE)),
    ("java", "Java", re.compile(r"\b(?:java|openjdk)\s*(\d+)\b", re.IGNORECASE)),
    ("php", "PHP", re.compile(r"\bphp\s*(\d+\.\d+)", re.IGNORECASE)),
    ("postgresql", "PostgreSQL", re.compile(r"\bpostgres(?:ql)?\s*(\d+)\b", re.IGNORECASE)),
    ("mysql", "MySQL", re.compile(r"\bmysql\s*(\d+\.\d+)", re.IGNORECASE)),
    ("ubuntu", "Ubuntu", re.compile(r"\bubuntu\s*(\d+\.\d+)", re.IGNORECASE)),
    ("angular", "Angular", re.compile(r"\bangular\s*(\d+)\b", re.IGNORECASE)),
    ("dotnet", ".NET", re.compile(r"\b(?:\.net|dotnet)\s*(\d+)\b", re.IGNORECASE)),
    ("kubernetes", "Kubernetes", re.compile(r"\bkubernetes\s*(\d+\.\d+)", re.IGNORECASE)),
)


class CycleSource(Protocol):
    def cycles(self, slug: str) -> list[dict[str, Any]]: ...


class _HttpCycles:
    def __init__(self, client: httpx.Client) -> None:
        self._client = client

    def cycles(self, slug: str) -> list[dict[str, Any]]:
        response = self._client.get(f"{SOURCE}/api/{slug}.json")
        response.raise_for_status()
        body = response.json()
        if not isinstance(body, list):
            return []
        return [item for item in body if isinstance(item, dict)]


def find_versions(texts: list[str]) -> list[dict[str, str]]:
    found: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for text in texts:
        snippet = " ".join(text.split())
        if not snippet:
            continue
        for slug, label, pattern in _PRODUCTS:
            for match in pattern.finditer(snippet):
                version = match.group(1)
                key = (slug, version)
                if key in seen:
                    continue
                seen.add(key)
                found.append(
                    {
                        "slug": slug,
                        "label": label,
                        "version": version,
                        "place": snippet[:240],
                    }
                )
                if len(found) >= _LIMIT:
                    return found
    return found


def _status(cycles: list[dict[str, Any]], version: str, today: date) -> tuple[str, str]:
    for cycle in cycles:
        name = str(cycle.get("cycle") or "")
        if name != version and not version.startswith(f"{name}."):
            continue
        eol = cycle.get("eol")
        if eol is False:
            return "supported", f"Ветка {name} ещё поддерживается."
        if eol is True:
            return "eol", f"Ветка {name} снята с поддержки."
        if isinstance(eol, str):
            try:
                end = date.fromisoformat(eol[:10])
            except ValueError:
                return "unknown", "Дата в ответе сайта не разобрана. Срок поддержки не подтверждён."
            if end < today:
                return "eol", f"Срок поддержки ветки {name} закончился {end.isoformat()}."
            return "supported", f"Ветка {name} поддерживается до {end.isoformat()}."
    return "unknown", f"Ветки {version} нет в каталоге. Срок поддержки не подтверждён."


def check_stack(
    texts: list[str],
    today: date | None = None,
    source: CycleSource | None = None,
) -> dict[str, Any]:
    current = today or date.today()
    mentions = find_versions(texts[:80])
    if not mentions:
        return {"state": "empty", "source": SOURCE, "hits": []}

    close = source is None
    client = None
    cycles_source = source
    if cycles_source is None:
        client = httpx.Client(
            timeout=httpx.Timeout(4.0, connect=3.0),
            follow_redirects=True,
            headers={"User-Agent": "edu-course-studio/0.1", "Accept": "application/json"},
        )
        cycles_source = _HttpCycles(client)

    cache: dict[str, list[dict[str, Any]] | None] = {}
    hits: list[dict[str, str]] = []
    try:
        for mention in mentions:
            slug = mention["slug"]
            if slug not in cache:
                try:
                    cache[slug] = cycles_source.cycles(slug)
                except (httpx.HTTPError, ValueError):
                    cache[slug] = None
            cycles = cache[slug]
            page = f"{SOURCE}/{slug}"
            if cycles is None:
                status, detail = (
                    "unavailable",
                    "Сайт endoflife.date не ответил. Срок поддержки не подтверждён и не заменяется локальной догадкой.",
                )
            else:
                status, detail = _status(cycles, mention["version"], current)
            hits.append(
                {
                    "id": f"{slug}-{mention['version']}",
                    "label": f"{mention['label']} {mention['version']}",
                    "status": status,
                    "place": mention["place"],
                    "detail": detail,
                    "source": page,
                }
            )
    finally:
        if close and client is not None:
            client.close()
    return {"state": "ready", "source": SOURCE, "hits": hits}
