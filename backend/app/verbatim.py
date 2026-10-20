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


def generated_text(course: dict[str, Any]) -> str:
    parts: list[str] = []
    for lecture in course.get("lectures") or []:
        if not isinstance(lecture, dict):
            continue
        parts.extend(str(line) for line in lecture.get("outline") or [])
        for slide in lecture.get("slides") or []:
            if not isinstance(slide, dict):
                continue
            parts.append(str(slide.get("title") or ""))
            parts.extend(str(line) for line in slide.get("bullets") or [])
            parts.append(str(slide.get("speakerNotes") or ""))
    for seminar in course.get("seminars") or []:
        if not isinstance(seminar, dict):
            continue
        for task in seminar.get("tasks") or []:
            if not isinstance(task, dict):
                continue
            parts.append(str(task.get("title") or ""))
            parts.append(str(task.get("prompt") or ""))
            parts.extend(str(line) for line in task.get("steps") or [])
    for assessment in course.get("assessments") or []:
        if not isinstance(assessment, dict):
            continue
        for question in assessment.get("questions") or []:
            if not isinstance(question, dict):
                continue
            parts.append(str(question.get("stem") or ""))
            parts.append(str(question.get("explanation") or ""))
    return "\n".join(parts)


def verbatim_spans(course: dict[str, Any], size: int = _SPAN) -> list[str]:
    """Общие окна из 12 слов между текстом референса и сгенерированным комплектом."""
    reference = _spans(reference_notes(course), size)
    if not reference:
        return []
    hits: list[str] = []
    for span in _spans(generated_text(course), size):
        if span in reference:
            hits.append(span)
            if len(hits) == 3:
                break
    return hits


def stored_source_status(source: str | None) -> str:
    """Ссылка и пустой источник не становятся подтверждёнными только потому, что строка непустая."""
    text = (source or "").strip().lower()
    if not text or text.startswith("http://") or text.startswith("https://"):
        return "unconfirmed"
    return "source_attached"
