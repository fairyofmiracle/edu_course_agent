from __future__ import annotations

import re
from typing import Any

_WORD = re.compile(r"[a-zа-яё0-9]+", re.IGNORECASE)
_SPAN = 12


def _words(text: str) -> list[str]:
    return [word.replace("ё", "е") for word in _WORD.findall(text.casefold())]


def _spans(text: str, size: int = _SPAN) -> set[str]:
    words = _words(text)
    if len(words) < size:
        return set()
    return {" ".join(words[index : index + size]) for index in range(len(words) - size + 1)}


def reference_notes(course: dict[str, Any]) -> str:
    brief = course.get("brief") or {}
    notes = []
    for reference in brief.get("references") or []:
        if isinstance(reference, dict):
            notes.append(str(reference.get("note") or ""))
    return "\n".join(notes)


def generated_fields(course: dict[str, Any]) -> list[str]:
    """Каждое поле отдельно: окно не склеивается из хвоста одного буллета и начала другого."""
    fields: list[str] = []
    for lecture in course.get("lectures") or []:
        if not isinstance(lecture, dict):
            continue
        fields.extend(str(line) for line in lecture.get("outline") or [])
        for slide in lecture.get("slides") or []:
            if not isinstance(slide, dict):
                continue
            fields.append(str(slide.get("title") or ""))
            fields.extend(str(line) for line in slide.get("bullets") or [])
            fields.append(str(slide.get("speakerNotes") or ""))
    for seminar in course.get("seminars") or []:
        if not isinstance(seminar, dict):
            continue
        for task in seminar.get("tasks") or []:
            if not isinstance(task, dict):
                continue
            fields.append(str(task.get("title") or ""))
            fields.append(str(task.get("prompt") or ""))
            fields.extend(str(line) for line in task.get("steps") or [])
            fields.extend(str(line) for line in task.get("criteria") or [])
    for assessment in course.get("assessments") or []:
        if not isinstance(assessment, dict):
            continue
        for question in assessment.get("questions") or []:
            if not isinstance(question, dict):
                continue
            fields.append(str(question.get("stem") or ""))
            fields.append(str(question.get("answer") or ""))
            fields.append(str(question.get("explanation") or ""))
            fields.extend(str(line) for line in question.get("options") or [])
    return fields


def generated_text(course: dict[str, Any]) -> str:
    return "\n".join(generated_fields(course))


def verbatim_spans(course: dict[str, Any], size: int = _SPAN) -> list[str]:
    """Общие окна из 12 слов между текстом референса и одним полем комплекта."""
    reference = _spans(reference_notes(course), size)
    if not reference:
        return []
    hits: list[str] = []
    for field in generated_fields(course):
        for span in _spans(field, size):
            if span in reference and span not in hits:
                hits.append(span)
                if len(hits) == 3:
                    return hits
    return hits


CONFIRMED_STATUSES = frozenset({"confirmed", "source_attached"})


def is_confirmed_status(status: str | None) -> bool:
    return (status or "").strip().lower() in CONFIRMED_STATUSES


def stored_source_status(source: str | None) -> str:
    """Ссылка и пустой источник не становятся подтверждёнными только потому, что строка непустая."""
    text = (source or "").strip().lower()
    if not text or text.startswith("http://") or text.startswith("https://"):
        return "unconfirmed"
    return "confirmed"


def effective_reference_status(reference: dict[str, Any] | Any) -> str:
    """Итоговый статус референса: явный confirmed / файл методиста / иначе unconfirmed."""
    if isinstance(reference, dict):
        status = reference.get("status")
        source = reference.get("source")
    else:
        status = getattr(reference, "status", None)
        source = getattr(reference, "source", None)
    if is_confirmed_status(status if isinstance(status, str) or status is None else str(status)):
        return "confirmed"
    return stored_source_status(source if source is None or isinstance(source, str) else str(source))


def reference_is_confirmed(reference: dict[str, Any] | Any) -> bool:
    return is_confirmed_status(effective_reference_status(reference))
