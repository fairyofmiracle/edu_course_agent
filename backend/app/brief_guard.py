from __future__ import annotations

import re
from typing import Any

HOURS = re.compile(
    r"(\d{1,3})\s*-?\s*(?:академическ\w*\s+|ак\.?\s*)?(?:час|ч(?![а-яё]))",
    re.IGNORECASE,
)
VOLUME = re.compile(
    r"(?:объ[её]м\w*|на)\s*[:—-]?\s*(\d{1,3})\s*"
    r"(?:академическ\w*\s+|ак\.?\s*)?(?:час|ч(?![а-яё]))",
    re.IGNORECASE,
)
SERVICE_PROMPT = re.compile(r"^(Собери |Каркас утверждён)")
KIND_MARKERS = {
    "general": re.compile(r"общеразвива|сертификат", re.IGNORECASE),
    "qualification": re.compile(
        r"повышени\w*\s+квалификац|удостоверени|профстандарт|"
        r"профессиональн\w*\s+стандарт|стажировк",
        re.IGNORECASE,
    ),
}


def mentioned_hours(text: str) -> list[int]:
    return [int(value) for value in HOURS.findall(text) if int(value) > 0]


def mentioned_kind(texts: list[str]) -> str | None:
    for text in reversed(texts):
        if KIND_MARKERS["qualification"].search(text):
            return "qualification"
        if KIND_MARKERS["general"].search(text):
            return "general"
    return None


def volume_from_text(texts: list[str]) -> int | None:
    for text in reversed(texts):
        match = VOLUME.search(text)
        if match:
            return int(match.group(1))
    return None


def drop_empty_fields(patch: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in patch.items():
        if value is None:
            continue
        if isinstance(value, str) and (not value.strip() or value == "unset"):
            continue
        if isinstance(value, (int, float)) and value <= 0:
            continue
        if isinstance(value, list) and not value:
            continue
        result[key] = value
    return result


def title_from_request(text: str) -> str:
    quoted = re.search(r"«([^»]{3,160})»", text)
    if quoted:
        return quoted.group(1).strip()
    return re.split(r"\s[—–-]\s|[.,;:\n]", text)[0].strip()[:160]


def guard_brief(
    patch: dict[str, Any],
    current: dict[str, Any],
    user_texts: list[str],
    form_brief: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], list[str]]:
    brief = drop_empty_fields(patch)
    dropped: list[str] = []
    texts = [text for text in user_texts if not SERVICE_PROMPT.search(text.strip())]
    form = form_brief or {}
    last = user_texts[-1] if user_texts else ""

    if "durationHours" not in brief and current.get("durationHours", 0) <= 0:
        volume = volume_from_text(texts)
        if volume:
            brief["durationHours"] = volume
    if "programKind" not in brief and current.get("programKind") == "unset":
        kind = mentioned_kind(texts)
        if kind:
            brief["programKind"] = kind

    if (
        "durationHours" in brief
        and brief["durationHours"] != current.get("durationHours")
    ):
        allowed = (
            form.get("durationHours") == brief["durationHours"]
            or brief["durationHours"] in mentioned_hours(last)
            or (
                current.get("durationHours", 0) <= 0
                and any(
                    brief["durationHours"] in mentioned_hours(text) for text in texts
                )
            )
        )
        if not allowed:
            brief.pop("durationHours")
            dropped.append("durationHours")

    if brief.get("programKind") not in (None, "unset", current.get("programKind")):
        if (
            form.get("programKind") != brief["programKind"]
            and mentioned_kind(user_texts) != brief["programKind"]
        ):
            brief.pop("programKind")
            dropped.append("programKind")

    if not current.get("title", "").strip() and not brief.get("title", "").strip():
        first = next(
            (
                text
                for text in user_texts
                if text.strip() and not SERVICE_PROMPT.search(text.strip())
            ),
            "",
        )
        title = title_from_request(first)
        if title:
            brief["title"] = title
    if not brief.get("goals") and not current.get("goals"):
        title = brief.get("title") or current.get("title")
        if title:
            brief["goals"] = [f"Освоить программу «{title}»"]
    return brief, dropped
