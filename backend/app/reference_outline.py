from __future__ import annotations

import re
from .models import CourseDocument

HEADING = re.compile(
    r"^(?:модуль|раздел|тема)\s*\d+[.:)\s]+(.{6,90})$",
    re.IGNORECASE | re.MULTILINE,
)
NUMBERED = re.compile(
    r"^(?:\d{1,2}(?:\.\d{1,2}){0,2})[.)]\s+([«\"A-ZА-ЯЁ].{5,90})$",
    re.MULTILINE,
)
HOURS_ONLY = re.compile(
    r"^\s*(?:итого|всего)?\s*\d+(?:[.,]\d+)?\s*(?:ч|час|часов|часа)?\s*$",
    re.IGNORECASE,
)
HOUR_TOKEN = re.compile(r"\d+\s*(?:ч|час)", re.IGNORECASE)
TF_CODE = re.compile(r"\b([A-Z]/\d{2}\.\d)\b")
STANDARD_CODE = re.compile(r"\b(0\d\.\d{3})\b")
QUOTED = re.compile(r"«([^»]{3,80})»")
STOP = {
    "без",
    "для",
    "или",
    "итог",
    "итоговая",
    "как",
    "курс",
    "модуль",
    "нужна",
    "нужен",
    "опыт",
    "опыта",
    "основы",
    "программа",
    "программу",
    "раздел",
    "слушатели",
    "сотрудники",
    "тема",
    "форма",
    "час",
    "часа",
    "часов",
    "этот",
    "этой",
}


def clip_text(value: str | None, limit: int) -> str:
    text = (value or "").strip()
    if len(text) <= limit:
        return text
    clipped = text[:limit].rsplit("\n", 1)[0].strip()
    return f"{clipped}\n[...]"


def subject_name(course: CourseDocument) -> str:
    title = (course.brief.title or "").strip()
    quoted = QUOTED.search(title)
    if quoted:
        return quoted.group(1).strip()
    cleaned = re.sub(
        r"^(?:дополнительн\w*\s+)?(?:общеразвивающ\w*\s+)?"
        r"(?:программ\w*\s+)?(?:повышения\s+квалификации\s+)?"
        r"(?:в форме стажировки\s+)?",
        "",
        title,
        flags=re.IGNORECASE,
    ).strip(" .:—-")
    return cleaned or title or "курса"


def tokens(text: str) -> set[str]:
    found = set()
    for word in re.findall(r"[A-Za-zА-Яа-яёЁ0-9]{3,}", text or ""):
        lowered = word.lower()
        if lowered not in STOP:
            found.add(lowered)
    return found


def outline_headings(text: str) -> list[str]:
    headings: list[str] = []
    seen: set[str] = set()
    for match in (*HEADING.finditer(text or ""), *NUMBERED.finditer(text or "")):
        raw = re.sub(r"\s+", " ", match.group(1)).strip(" .;—-")
        raw = HOUR_TOKEN.sub("", raw).strip(" .;—-")
        if len(raw) < 6 or HOURS_ONLY.match(raw):
            continue
        if any(skip in raw.lower() for skip in ("итоговая строка", "всего часов", "подпись")):
            continue
        key = raw.lower()
        if key in seen:
            continue
        seen.add(key)
        headings.append(raw[:80])
    return headings[:12]


def labor_function_codes(text: str) -> list[str]:
    return list(dict.fromkeys(TF_CODE.findall(text or "")))


def standard_codes(text: str) -> list[str]:
    return list(dict.fromkeys(STANDARD_CODE.findall(text or "")))


def headings_match_subject(course: CourseDocument, headings: list[str]) -> bool:
    subject = tokens(
        " ".join(
            [
                course.brief.title,
                course.brief.audience,
                course.brief.attestation_form,
                *course.brief.goals,
            ]
        )
    )
    found = tokens(" ".join(headings))
    if not subject or not found:
        return False
    return bool(subject & found)


def compact_reference(text: str | None, limit: int = 3500) -> str:
    raw = (text or "").strip()
    if not raw:
        return ""
    headings = outline_headings(raw)
    codes = labor_function_codes(raw) + standard_codes(raw)
    lead: list[str] = []
    for line in raw.splitlines():
        stripped = line.strip()
        if not stripped or HOURS_ONLY.match(stripped):
            continue
        lead.append(stripped)
        if sum(len(item) for item in lead) > 1400:
            break
    parts: list[str] = []
    if headings:
        parts.append(
            "Разделы образца — повтори логику разделов, не копируй тему и часы:\n"
            + "\n".join(f"- {item}" for item in headings)
        )
    if codes:
        parts.append("Коды из файла методиста: " + ", ".join(codes))
    parts.append("\n".join(lead))
    return clip_text("\n\n".join(part for part in parts if part), limit)


HEADER_VOLUME = re.compile(
    r"(?:объ[её]м|трудо[её]мк|всего|итого|программ\w*).{0,48}?"
    r"(\d{2,})\s*(?:академическ\w*\s+)?(?:часов|часа|час\b|ч\b)",
    re.IGNORECASE,
)
PLAIN_VOLUME = re.compile(
    r"(\d{2,})\s*академических часов",
    re.IGNORECASE,
)


def volume_from_reference(text: str | None) -> int | None:
    if not (text or "").strip():
        return None
    head = text[:2500]
    for match in (*HEADER_VOLUME.finditer(head), *PLAIN_VOLUME.finditer(head)):
        value = int(match.group(1))
        if value >= 8:
            return value
    return None


def title_from_reference(text: str | None) -> str | None:
    quoted = QUOTED.search((text or "")[:1500])
    if quoted:
        return quoted.group(1).strip()[:160]
    return None


def audience_from_reference(text: str | None) -> str | None:
    from .brief_guard import audience_from_text

    return audience_from_text([text[:2500]]) if text else None


def apply_reference_hints(
    course: CourseDocument,
    references: str | None,
    user_texts: list[str] | None = None,
) -> CourseDocument:
    if not (references or "").strip():
        return course
    from .brief_guard import sample_intents

    headings = outline_headings(references)
    value = course.as_api()
    brief = value["brief"]
    texts = user_texts or []
    intents = sample_intents(texts)
    taken: list[str] = []
    if "hours" in intents:
        volume = volume_from_reference(references)
        if volume:
            previous = float(brief.get("durationHours") or 0)
            brief["durationHours"] = volume
            taken.append(f"объём {volume:g} ч")
            if value.get("modules") and abs(previous - volume) > 0.01:
                value["modules"] = []
                value["frameworkApproved"] = False
    if "topic" in intents:
        title = title_from_reference(references)
        if title:
            brief["title"] = title
            taken.append(f"тема «{title}»")
            value["modules"] = []
            value["frameworkApproved"] = False
    if "audience" in intents:
        audience = audience_from_reference(references)
        if audience:
            brief["audience"] = audience
            taken.append(f"аудитория «{audience}»")
    goals = [str(item).strip() for item in (brief.get("goals") or []) if str(item).strip()]
    same_subject = headings_match_subject(course, headings)
    if headings and (same_subject or "structure" in intents):
        if same_subject:
            brief["goals"] = list(dict.fromkeys([*goals, *headings]))[:8]
        taken.append("логика разделов")
    if taken:
        note = (
            "Из файла по просьбе методиста: "
            + ", ".join(taken)
            + ". Остальное — из запроса, молча из образца не берём."
        )
        constraints = [str(item) for item in (brief.get("constraints") or [])]
        if not any("Из файла по просьбе методиста" in item for item in constraints):
            constraints.append(note)
        brief["constraints"] = constraints[:12]
    for code in standard_codes(references):
        title = f"Профессиональный стандарт, код {code}"
        refs = brief.get("references") or []
        if not any(code in str(item.get("title") or "") for item in refs):
            refs.append(
                {
                    "title": title,
                    "source": "https://profstandart.rosmintrud.ru/",
                    "note": "Код взят из файла методиста, не выдуман.",
                }
            )
        brief["references"] = refs[:20]
    return CourseDocument.model_validate(value)


def apply_file_labor_codes(course: CourseDocument, references: str | None) -> CourseDocument:
    if course.brief.program_kind != "qualification":
        return course
    codes = labor_function_codes(references or "")
    if not codes or not course.competencies.nodes:
        return course
    nodes = [node.model_dump(by_alias=True) for node in course.competencies.nodes]
    changed = False
    unused = list(codes)
    for node in nodes:
        if str(node.get("laborFunctionCode") or "").strip():
            continue
        if not unused:
            break
        node["laborFunctionCode"] = unused.pop(0)
        changed = True
    if not changed:
        return course
    value = course.as_api()
    value["competencies"]["nodes"] = nodes
    return CourseDocument.model_validate(value)


def generic_module_titles(course: CourseDocument) -> list[str]:
    subject = subject_name(course)
    audience = (course.brief.audience or "слушателей").rstrip(" .")
    attestation = (course.brief.attestation_form or "итоговая работа").rstrip(" .")
    blob = " ".join(
        [
            course.brief.title,
            course.brief.audience,
            course.brief.attestation_form,
            *course.brief.goals,
        ]
    ).lower()
    practice = f"Практика по теме «{subject}»"
    for token, label in (
        ("афиш", "Практика: макет афиши"),
        ("макет", "Практика: учебный макет"),
        ("фонд", "Практика: описание фонда"),
        ("архив", "Практика: описание архивного фонда"),
        ("1с", "Практика: рабочая операция в 1С"),
        ("зуп", "Практика: расчёт в 1С:ЗУП"),
        ("pandas", "Практика: таблица в pandas"),
        ("figma", "Практика: макет в Figma"),
    ):
        if token in blob:
            practice = label
            break
    titles = [
        f"Введение: {subject} для {audience}",
        f"Инструменты и приёмы «{subject}»",
        practice,
        f"Итоговая работа: {attestation}",
    ]
    matching = [
        item
        for item in course.brief.goals
        if item.strip()
        and headings_match_subject(course, [item])
        and not item.strip().lower().startswith("освоить программу")
    ]
    if matching:
        titles = matching + [item for item in titles if item not in matching]
    return titles
