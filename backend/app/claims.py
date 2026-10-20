"""Реквизиты в комплекте должны встречаться в тексте методиста."""

from __future__ import annotations

import re
from typing import Any

ORDER_RE = re.compile(r"№\s*(\d+)", re.IGNORECASE)
LABOR_RE = re.compile(r"\b([A-ZА-ЯЁ]/\d{2}\.\d)\b")
# Номера, которые в программу ставит код правовой основы, а не модель.
KNOWN_ORDERS = frozenset({"629", "266", "499", "273"})
SKIP_KEYS = frozenset(
    {
        "id",
        "moduleId",
        "competencyId",
        "competencyIds",
        "moduleIds",
        "laborFunctionCode",
        "type",
        "bloomLevel",
        "format",
        "level",
        "programKind",
    }
)


def _strings(value: Any, *, skip_keys: bool) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        rows: list[str] = []
        for key, item in value.items():
            if skip_keys and key in SKIP_KEYS:
                continue
            rows.extend(_strings(item, skip_keys=skip_keys))
        return rows
    if isinstance(value, list):
        rows = []
        for item in value:
            rows.extend(_strings(item, skip_keys=skip_keys))
        return rows
    return []


def allowed_corpus(course: dict[str, Any]) -> str:
    brief = course.get("brief") if isinstance(course.get("brief"), dict) else {}
    chunks: list[Any] = [
        brief.get("title"),
        brief.get("audience"),
        *(brief.get("goals") or []),
        *(brief.get("constraints") or []),
    ]
    for reference in brief.get("references") or []:
        if isinstance(reference, dict):
            chunks.extend(
                [reference.get("title"), reference.get("note"), reference.get("source")]
            )
    return "\n".join(str(item) for item in chunks if item)


def generated_text(course: dict[str, Any]) -> str:
    chunks: list[str] = []
    for key in ("modules", "lectures", "seminars", "assessments"):
        chunks.extend(_strings(course.get(key), skip_keys=True))
    competencies = course.get("competencies")
    if isinstance(competencies, dict):
        chunks.extend(_strings(competencies.get("nodes"), skip_keys=True))
    return "\n".join(chunks)


def labor_codes(course: dict[str, Any]) -> list[str]:
    competencies = course.get("competencies")
    nodes = competencies.get("nodes") if isinstance(competencies, dict) else []
    codes: list[str] = []
    for node in nodes or []:
        if not isinstance(node, dict):
            continue
        code = str(node.get("laborFunctionCode") or "").strip()
        if code and code not in codes:
            codes.append(code)
    return codes


def order_grounded(number: str, allowed: str) -> bool:
    """Номер из «72 часа» или даты «27.07» приказом не считается."""
    if number in KNOWN_ORDERS:
        return True
    return re.search(rf"№\s*{re.escape(number)}(?!\d)", allowed, re.IGNORECASE) is not None


def code_grounded(code: str, allowed: str) -> bool:
    return re.search(rf"(?<![\w/]){re.escape(code)}(?!\d)", allowed) is not None


def invented_requisites(course: dict[str, Any]) -> list[str]:
    """Номера приказов и коды трудовых функций, которых нет у методиста."""
    allowed = allowed_corpus(course)
    found: list[str] = []
    for number in ORDER_RE.findall(generated_text(course)):
        if order_grounded(number, allowed):
            continue
        label = f"№ {number}"
        if label not in found:
            found.append(label)
    for code in LABOR_RE.findall(generated_text(course)):
        if not code_grounded(code, allowed) and code not in found:
            found.append(code)
    for code in labor_codes(course):
        if not code_grounded(code, allowed) and code not in found:
            found.append(code)
    return found
