"""Детерминированный чеклист смысла: пустое / шаблон / дубли."""

from __future__ import annotations

import re
from typing import Any

TEMPLATE_PHRASES = (
    "будет описано",
    "будет добавлено",
    "заполнить позже",
    "текст лекции",
    "lorem ipsum",
    "lorem",
    "placeholder",
    "todo",
    "tbd",
    "coming soon",
    "в разработке",
    "пример текста",
    "insert text",
    "добавить содержание",
)

_WORD = re.compile(r"[^\w\s]+", re.UNICODE)


def _norm(value: str) -> str:
    text = (value or "").lower().replace("ё", "е")
    text = _WORD.sub(" ", text)
    return re.sub(r"\s+", " ", text).strip()


def _tokens(value: str) -> list[str]:
    return [part for part in _norm(value).split(" ") if len(part) > 2]


def text_similarity(a: str, b: str) -> float:
    left = set(_tokens(a))
    right = set(_tokens(b))
    if not left or not right:
        return 0.0
    inter = len(left & right)
    return inter / (len(left) + len(right) - inter)


def _find_template(text: str) -> str | None:
    n = _norm(text)
    if not n:
        return None
    for phrase in TEMPLATE_PHRASES:
        if _norm(phrase) in n:
            return phrase
    return None


def _title_as_body(title: str, body: str) -> bool:
    t = _norm(title)
    b = _norm(body)
    if not t or not b:
        return False
    if b == t:
        return True
    return len(b) <= len(t) + 8 and b.startswith(t)


def _collect_blocks(course: dict[str, Any]) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    for lecture in course.get("lectures") or []:
        module_id = str(lecture.get("moduleId") or "")
        outline = "\n".join(
            str(line).strip() for line in (lecture.get("outline") or []) if str(line).strip()
        )
        blocks.append(
            {
                "id": f"lecture.{module_id}.outline",
                "moduleId": module_id,
                "place": f"Лекция модуля {module_id}: план",
                "title": "План лекции",
                "body": outline,
            }
        )
        for index, slide in enumerate(lecture.get("slides") or []):
            if not isinstance(slide, dict):
                continue
            body = "\n".join(
                [
                    *(str(b) for b in (slide.get("bullets") or [])),
                    str(slide.get("speakerNotes") or ""),
                ]
            ).strip()
            title = str(slide.get("title") or f"Слайд {index + 1}")
            blocks.append(
                {
                    "id": f"lecture.{module_id}.slide.{index}",
                    "moduleId": module_id,
                    "place": f"Слайд «{title}»",
                    "title": title,
                    "body": body,
                }
            )

    for seminar in course.get("seminars") or []:
        module_id = str(seminar.get("moduleId") or "")
        for index, task in enumerate(seminar.get("tasks") or []):
            if not isinstance(task, dict):
                continue
            title = str(task.get("title") or f"Задание {index + 1}")
            body = "\n".join(
                [
                    str(task.get("prompt") or ""),
                    *(str(step) for step in (task.get("steps") or [])),
                    *(str(c) for c in (task.get("criteria") or [])),
                ]
            ).strip()
            blocks.append(
                {
                    "id": f"seminar.{module_id}.task.{index}",
                    "moduleId": module_id,
                    "place": f"Задание «{title}»",
                    "title": title,
                    "body": body,
                }
            )

    for assessment in course.get("assessments") or []:
        module_id = str(assessment.get("moduleId") or "")
        for index, question in enumerate(assessment.get("questions") or []):
            if not isinstance(question, dict):
                continue
            stem = str(question.get("stem") or "")
            body = "\n".join(
                [
                    stem,
                    *(str(opt) for opt in (question.get("options") or [])),
                    str(question.get("answer") or ""),
                    str(question.get("explanation") or ""),
                ]
            ).strip()
            blocks.append(
                {
                    "id": f"assessment.{module_id}.q.{index}",
                    "moduleId": module_id,
                    "place": f"Вопрос {index + 1}",
                    "title": stem[:80],
                    "body": body,
                }
            )

    for module in course.get("modules") or []:
        if not isinstance(module, dict):
            continue
        module_id = str(module.get("id") or "")
        title = str(module.get("title") or module_id)
        body = "\n".join(
            [
                *(str(t) for t in (module.get("topics") or [])),
                *(str(o) for o in (module.get("learningOutcomes") or [])),
            ]
        ).strip()
        blocks.append(
            {
                "id": f"module.{module_id}.topics",
                "moduleId": module_id,
                "place": f"Модуль «{title}»",
                "title": title,
                "body": body,
            }
        )
    return blocks


def meaning_hits(course: dict[str, Any]) -> list[dict[str, Any]]:
    hits: list[dict[str, Any]] = []
    blocks = _collect_blocks(course)
    for block in blocks:
        if not str(block.get("body") or "").strip():
            hits.append(
                {
                    "id": f"meaning.empty.{block['id']}",
                    "kind": "empty",
                    "label": f"Пустой блок: {block['place']}",
                    "details": "Нет связного текста — методист или модель должны заполнить содержание.",
                    "moduleId": block.get("moduleId"),
                    "severity": "fail",
                }
            )
            continue
        template = _find_template(str(block["body"]))
        if template:
            hits.append(
                {
                    "id": f"meaning.template.{block['id']}",
                    "kind": "template",
                    "label": f"Шаблонная фраза в «{block['place']}»",
                    "details": f"Найдено: «{template}». Замените на содержательный текст.",
                    "moduleId": block.get("moduleId"),
                    "severity": "fail",
                }
            )
        if _title_as_body(str(block["title"]), str(block["body"])):
            hits.append(
                {
                    "id": f"meaning.titlebody.{block['id']}",
                    "kind": "title-as-body",
                    "label": f"Заголовок повторён как тело: {block['place']}",
                    "details": "Текст совпадает с названием — это не содержание.",
                    "moduleId": block.get("moduleId"),
                    "severity": "warning",
                }
            )

    comparable = [b for b in blocks if len(_tokens(str(b.get("body") or ""))) >= 6]
    for i, left in enumerate(comparable):
        for right in comparable[i + 1 :]:
            if left.get("moduleId") and left.get("moduleId") == right.get("moduleId"):
                if str(left["id"]).startswith("lecture.") and str(right["id"]).startswith(
                    "lecture."
                ):
                    continue
            score = text_similarity(str(left["body"]), str(right["body"]))
            if score < 0.82:
                continue
            hits.append(
                {
                    "id": f"meaning.dup.{left['id']}.{right['id']}",
                    "kind": "duplicate",
                    "label": "Похожие тексты в разных блоках",
                    "details": (
                        f"{left['place']} ≈ {right['place']} "
                        f"(сходство {score * 100:.0f}%)."
                    ),
                    "moduleId": left.get("moduleId"),
                    "severity": "warning",
                }
            )
    return hits


def meaning_audit_items(course: dict[str, Any]) -> list[dict[str, Any]]:
    """Пункты аудита секции meaning + заглушка LLM (disabled без вызова)."""
    items: list[dict[str, Any]] = []
    hits = meaning_hits(course)
    for hit in hits:
        items.append(
            {
                "id": hit["id"],
                "label": hit["label"],
                "status": hit["severity"],
                "section": "meaning",
                "details": hit.get("details"),
            }
        )
    if not hits:
        items.append(
            {
                "id": "meaning.clear",
                "label": "Пустых и шаблонных блоков не найдено",
                "status": "pass",
                "section": "meaning",
                "details": "Детерминированный чеклист: пустое, шаблонные фразы, дубли.",
            }
        )
    items.append(
        {
            "id": "meaning.llm",
            "label": "LLM-ревью смысла",
            "status": "disabled",
            "section": "meaning",
            "details": (
                "Опционально: запросите ревью через /api/audit/meaning-review. "
                "Без ключа шлюза пункт остаётся disabled и не блокирует выгрузку."
            ),
        }
    )
    return items
