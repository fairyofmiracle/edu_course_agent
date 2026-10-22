from __future__ import annotations

import re
from typing import Any

HOURS = re.compile(
    r"(\d+)\s*(?:академическ\w*\s+|ак\.?\s*)?(?:часов|часа|час\b|ч(?![а-яё]))",
    re.IGNORECASE,
)
VOLUME = re.compile(
    r"(?:объ[её]м\w*|на)\s*[:—-]?\s*(\d+)\s*"
    r"(?:академическ\w*\s+|ак\.?\s*)?(?:часов|часа|час\b|ч(?![а-яё]))",
    re.IGNORECASE,
)
SERVICE_PROMPT = re.compile(r"^(Собери |Каркас утверждён)")
LEAD = re.compile(
    r"^(?:сделайте|нужна|нужен|прошу)\s+",
    re.IGNORECASE,
)
AUDIENCE = re.compile(
    r"для\s+((?:школьник|учител|педагог|студент|сотрудник|слушател|взросл|методист)[^.,]{0,120})",
    re.IGNORECASE,
)
AUDIENCE_BARE = re.compile(
    r"((?:студенты|сотрудники|учителя|школьники|слушатели|методисты)\s+[^.,]{0,80})",
    re.IGNORECASE,
)
ATTESTATION_MARKERS = (
    (re.compile(r"защит\w+\s+отч[её]т", re.IGNORECASE), "защита отчёта о стажировке"),
    (re.compile(r"портфолио", re.IGNORECASE), "зачёт по портфолио"),
    (re.compile(r"экзамен", re.IGNORECASE), "экзамен с практическим заданием"),
    (re.compile(r"зач[её]т", re.IGNORECASE), "зачёт"),
    (
        re.compile(r"(?:защит|защищ)\w*.{0,24}(?:проект|макет)", re.IGNORECASE),
        "защита проекта",
    ),
    (
        re.compile(r"одностранич|(?:веб-)?сайт|проверк\w*.{0,24}сайт", re.IGNORECASE),
        "защита проекта",
    ),
)
KIND_MARKERS = {
    "general": re.compile(r"общеразвива|сертификат", re.IGNORECASE),
    "qualification": re.compile(
        r"повышени\w*\s+квалификац|удостоверени|профстандарт|"
        r"профессиональн\w*\s+стандарт|стажировк|(?<![а-яё])пк(?![а-яё])",
        re.IGNORECASE,
    ),
}


SAMPLE_NEAR = re.compile(r"образец|приложен|референс", re.IGNORECASE)
FILE_PTR = r"файл|образц|приложен|референс"
FIELD_WORDS = {
    "hours": r"час|объ[её]м",
    "audience": r"аудитор|слушател",
    "topic": r"тем[аеуы]|назван|предмет",
    "structure": r"структур|раздел|модул",
    "attestation": r"аттестац",
}
EXCEPT_WORDS = {
    "hours": r"час|объ[её]м",
    "audience": r"аудитор|слушател",
    "topic": r"тем|назван",
    "structure": r"структур|раздел|модул",
    "attestation": r"аттестац",
}


def sample_intents(texts: list[str]) -> set[str]:
    """Какие поля методист явно берёт из файла. Молчаливое приложение файла сюда не входит."""
    blob = " ".join(texts)
    intents: set[str] = set()
    if re.search(
        rf"(?:вс[её]|целиком|полностью).{{0,16}}(?:как в|из).{{0,12}}(?:{FILE_PTR})",
        blob,
        re.IGNORECASE,
    ):
        intents.update(FIELD_WORDS)
    for match in re.finditer(
        rf"кроме\s+({EXCEPT_WORDS['topic']}|{EXCEPT_WORDS['audience']}|"
        rf"{EXCEPT_WORDS['hours']}|{EXCEPT_WORDS['structure']}|{EXCEPT_WORDS['attestation']})\w*",
        blob,
        re.IGNORECASE,
    ):
        token = match.group(1).lower()
        for field, stem in EXCEPT_WORDS.items():
            if re.match(stem, token, re.IGNORECASE):
                intents.discard(field)
    for field, words in FIELD_WORDS.items():
        others = "|".join(stem for name, stem in FIELD_WORDS.items() if name != field)
        for match in re.finditer(
            rf"(?:{words})\w{{0,12}}(.{{0,40}})(?:как в|из)\s+(?:{FILE_PTR})",
            blob,
            re.IGNORECASE,
        ):
            gap = match.group(1)
            if not re.search(rf"(?:{others})\w*", gap, re.IGNORECASE):
                intents.add(field)
        if re.search(
            rf"(?:как в|из)\s+(?:{FILE_PTR})\w{{0,12}}.{{0,16}}только\s+(?:{words})",
            blob,
            re.IGNORECASE,
        ) or re.search(
            rf"(?:как в|из)\s+(?:{FILE_PTR}).{{0,20}}(?:{words})",
            blob,
            re.IGNORECASE,
        ):
            intents.add(field)
    if re.search(r"структур\w*.{0,24}(?:возьм|можно взять|как в)", blob, re.IGNORECASE):
        intents.add("structure")
    if re.search(r"тем[аеу]\s+друг", blob, re.IGNORECASE):
        intents.discard("topic")
    if re.search(r"аудитор\w*\s+друг", blob, re.IGNORECASE):
        intents.discard("audience")
    return intents


def wants_hours_from_sample(texts: list[str]) -> bool:
    return "hours" in sample_intents(texts)


def mentioned_hours(text: str) -> list[int]:
    hours: list[int] = []
    for match in HOURS.finditer(text):
        start, end = match.span()
        window = text[max(0, start - 28) : min(len(text), end + 28)]
        if SAMPLE_NEAR.search(window):
            continue
        value = int(match.group(1))
        if value > 0:
            hours.append(value)
    return hours


def mentioned_kind(texts: list[str]) -> str | None:
    for text in reversed(texts):
        if KIND_MARKERS["qualification"].search(text):
            return "qualification"
        if KIND_MARKERS["general"].search(text):
            return "general"
    return None


ATTESTATION_HOURS = re.compile(
    r"аттестац\w*.{0,48}?(\d{1,2})\s*(?:академическ\w*\s+)?(?:час|ч\b)",
    re.IGNORECASE,
)
ATTESTATION_HOURS_FLIP = re.compile(
    r"(\d{1,2})\s*(?:академическ\w*\s+)?(?:час|ч\b).{0,24}аттестац",
    re.IGNORECASE,
)


def attestation_hours_from_text(texts: list[str]) -> float | None:
    blob = " ".join(texts)
    for pattern in (ATTESTATION_HOURS, ATTESTATION_HOURS_FLIP):
        match = pattern.search(blob)
        if not match:
            continue
        hours = int(match.group(1))
        if 0 < hours <= 8:
            return float(hours)
    return None


def volume_from_text(texts: list[str]) -> int | None:
    for text in reversed(texts):
        match = VOLUME.search(text)
        if not match:
            continue
        start, end = match.span()
        window = text[max(0, start - 28) : min(len(text), end + 28)]
        if SAMPLE_NEAR.search(window):
            continue
        return int(match.group(1))
    for text in reversed(texts):
        large = [hour for hour in mentioned_hours(text) if hour >= 8]
        if large:
            return large[0]
    return None


def normalize_program_kind(value: Any) -> str | None:
    if value in {"general", "qualification"}:
        return value
    text = str(value or "").strip()
    if not text or text == "unset":
        return None
    if KIND_MARKERS["qualification"].search(text):
        return "qualification"
    if KIND_MARKERS["general"].search(text):
        return "general"
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
    cleaned = LEAD.sub("", text.strip())
    about = re.search(
        r"(?:курс|программ\w*)\s+по\s+([^.,]{3,80})",
        cleaned,
        flags=re.IGNORECASE,
    )
    if about:
        cleaned = about.group(1)
        cleaned = re.split(r"\s+для\s+", cleaned, maxsplit=1)[0]
        cleaned = re.split(r"\s+примерно\s+", cleaned, maxsplit=1)[0]
    cleaned = re.sub(
        r"^(?:дополнительн\w*\s+)?(?:общеразвивающ\w*\s+)?программу\s+",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )
    title = re.split(r"\s[—–-]\s|[.,;:\n]", cleaned)[0].strip()
    if title:
        title = title[0].upper() + title[1:]
    return title[:160]


def format_from_text(texts: list[str]) -> str | None:
    blob = " ".join(texts).lower()
    if "стажиров" in blob and (
        "аудиторн" in blob or "самостоятельн" in blob or "наставник" in blob
    ):
        return "workshop"
    if "очно-заоч" in blob or "дистанционн" in blob or "эо и дот" in blob:
        return "blended"
    if re.search(r"очн(?:о|ая|ой|ые)\b", blob) and "заоч" not in blob:
        return "lecture"
    return None


def audience_from_text(texts: list[str]) -> str | None:
    for text in reversed(texts):
        labeled = re.search(
            r"(?:слушател\w*|аудитори\w*)\s*[:—]\s*([^.]{6,180})",
            text,
            re.IGNORECASE,
        )
        if labeled:
            return labeled.group(1).strip()
        match = AUDIENCE.search(text)
        work = re.search(r"работают в\s+([^.,]{3,60})", text, re.IGNORECASE)
        if match and work:
            return f"{match.group(1).strip()}, {work.group(0).strip()}"
        if match:
            return match.group(1).strip()
        if work:
            return work.group(0).strip()
        intern = re.search(r"стажировку\s+в\s+([^.,]{6,80})", text, re.IGNORECASE)
        if intern:
            return f"слушатели стажировки в {intern.group(1).strip()}"
        bare = AUDIENCE_BARE.search(text)
        if bare:
            return bare.group(1).strip()
    return None


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
    if "programKind" in brief:
        kind = normalize_program_kind(brief.get("programKind"))
        if kind:
            brief["programKind"] = kind
        else:
            brief.pop("programKind", None)

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

    if "format" not in brief:
        inferred_format = format_from_text(texts)
        if inferred_format:
            brief["format"] = inferred_format
    extracted_audience = audience_from_text(texts)
    last_names_audience = bool(
        re.search(r"(?:слушател\w*|аудитори\w*)\s*[:—]", last, re.IGNORECASE)
    )
    if extracted_audience and not brief.get("audience"):
        if not current.get("audience", "").strip() or last_names_audience:
            brief["audience"] = extracted_audience
    if not current.get("attestationForm", "").strip() and not brief.get("attestationForm", "").strip():
        blob = " ".join(texts)
        for pattern, form in ATTESTATION_MARKERS:
            if pattern.search(blob):
                brief["attestationForm"] = form
                break
    if not brief.get("attestationHours") and not current.get("attestationHours"):
        att_hours = attestation_hours_from_text(texts)
        if att_hours:
            brief["attestationHours"] = att_hours
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
