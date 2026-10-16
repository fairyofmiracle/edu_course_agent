from __future__ import annotations

import math
from typing import Any

from .domain import framework_items
from .models import CourseDocument

KIND_FIELDS = ("lectureHours", "practiceHours", "labHours", "selfStudyHours")


def _audit_item(
    item_id: str,
    label: str,
    ok: bool,
    section: str,
    details: str | None = None,
) -> dict[str, Any]:
    item = {
        "id": item_id,
        "label": label,
        "status": "pass" if ok else "fail",
        "section": section,
    }
    if details:
        item["details"] = details
    return item


def _number(value: Any) -> float:
    try:
        number = float(value or 0)
    except (TypeError, ValueError):
        return math.nan
    return number


def _half_step(value: Any) -> bool:
    number = _number(value)
    return math.isfinite(number) and number >= 0 and abs(number * 2 - round(number * 2)) < 1e-6


def _summary(items: list[dict[str, Any]]) -> dict[str, int]:
    return {
        state: sum(1 for item in items if item["status"] == state)
        for state in ("pass", "warning", "fail")
    }


def audit_course(course: dict[str, Any]) -> dict[str, Any]:
    """Проверяет формальные правила. Методическое качество остаётся человеку."""
    brief = course.get("brief") or {}
    modules = course.get("modules") or []
    assessments = course.get("assessments") or []
    seminars = course.get("seminars") or []
    lectures = course.get("lectures") or []
    competencies = (course.get("competencies") or {}).get("nodes") or []

    module_hours = sum(_number(module.get("hours")) for module in modules)
    attestation_hours = _number(brief.get("attestationHours"))
    target_hours = _number(brief.get("durationHours"))
    kinds_match = all(
        abs(
            sum(_number(module.get(field)) for field in KIND_FIELDS)
            - _number(module.get("hours"))
        )
        < 0.001
        for module in modules
    )
    hours_ok = (
        bool(modules)
        and math.isfinite(target_hours)
        and target_hours > 0
        and math.isfinite(module_hours)
        and math.isfinite(attestation_hours)
        and kinds_match
        and abs(module_hours + attestation_hours - target_hours) < 0.001
    )

    bad_steps: list[str] = []
    for name, value in (
        ("durationHours", target_hours),
        ("attestationHours", attestation_hours),
    ):
        if not _half_step(value):
            bad_steps.append(name)
    for module in modules:
        module_id = str(module.get("id") or "module")
        if not _half_step(module.get("hours")):
            bad_steps.append(f"{module_id}.hours")
        for field in KIND_FIELDS:
            if not _half_step(module.get(field)):
                bad_steps.append(f"{module_id}.{field}")

    items = [
        _audit_item(
            "framework.template",
            "Выбран шаблон программы",
            brief.get("programKind") in {"general", "qualification"},
            "framework",
        ),
        _audit_item(
            "framework.brief",
            "Есть название и аудитория",
            bool(str(brief.get("title") or "").strip())
            and bool(str(brief.get("audience") or "").strip()),
            "framework",
        ),
        _audit_item(
            "framework.hours",
            f"Часы сходятся: {module_hours + attestation_hours:g} из {target_hours:g}",
            hours_ok,
            "framework",
        ),
        _audit_item(
            "framework.hour_step",
            "Академические часы заданы с шагом 0,5",
            not bad_steps,
            "framework",
            ", ".join(bad_steps) if bad_steps else None,
        ),
    ]

    for module in modules:
        module_id = str(module.get("id") or "")
        module_outcomes = {
            str(outcome).strip() for outcome in module.get("learningOutcomes") or []
        }
        has_lecture = any(row.get("moduleId") == module_id for row in lectures)
        has_seminar = any(row.get("moduleId") == module_id for row in seminars)
        has_assessment = any(row.get("moduleId") == module_id for row in assessments)
        items.append(
            _audit_item(
                f"content.{module_id}",
                f"{module.get('title') or module_id}: лекция, задание и тест",
                has_lecture and has_seminar and has_assessment,
                "content",
            )
        )

        question_outcomes: set[str] = set()
        for assessment in assessments:
            if assessment.get("moduleId") != module_id:
                continue
            for index, question in enumerate(assessment.get("questions") or []):
                outcome = str(question.get("learningOutcome") or "").strip()
                answer = str(question.get("answer") or "").strip()
                if outcome:
                    question_outcomes.add(outcome)
                if answer and outcome in module_outcomes:
                    continue
                missing = [
                    "" if answer else "нет ключа",
                    "" if outcome in module_outcomes else "результат не найден в модуле",
                ]
                items.append(
                    _audit_item(
                        f"question.{module_id}.{index}",
                        f"Вопрос {index + 1} имеет ключ и результат обучения",
                        False,
                        "content",
                        ", ".join(part for part in missing if part),
                    )
                )

        task_outcomes: set[str] = set()
        for seminar in seminars:
            if seminar.get("moduleId") != module_id:
                continue
            for index, task in enumerate(seminar.get("tasks") or []):
                outcome = str(task.get("learningOutcome") or "").strip()
                if outcome:
                    task_outcomes.add(outcome)
                if outcome in module_outcomes:
                    continue
                items.append(
                    _audit_item(
                        f"task.{module_id}.{index}",
                        f"Задание {index + 1} привязано к результату обучения",
                        False,
                        "content",
                        "результат не найден в модуле",
                    )
                )

        for outcome in module.get("learningOutcomes") or []:
            missing = []
            if str(outcome).strip() not in question_outcomes:
                missing.append("тест")
            if str(outcome).strip() not in task_outcomes:
                missing.append("практическое задание")
            items.append(
                _audit_item(
                    f"outcome.{module_id}.{outcome}",
                    f"Результат «{outcome}» проверяется двумя способами",
                    not missing,
                    "content",
                    f"Не хватает: {' и '.join(missing)}" if missing else None,
                )
            )

    references = brief.get("references") or []
    items.append(
        {
            "id": "sources.present",
            "label": (
                "Источники и референсы указаны"
                if references
                else "Источники и референсы не указаны"
            ),
            "status": "pass" if references else "warning",
            "section": "sources",
            **(
                {}
                if references
                else {
                    "details": (
                        "Приказы и профстандарты нельзя добавлять без файла "
                        "или проверяемой ссылки."
                    )
                }
            ),
        }
    )

    labor_codes = [
        str(node.get("laborFunctionCode") or "").strip()
        for node in competencies
        if str(node.get("laborFunctionCode") or "").strip()
    ]
    if labor_codes:
        items.append(
            {
                "id": "sources.codes",
                "label": "Коды трудовых функций требуют ручной сверки",
                "status": "warning" if references else "fail",
                "section": "sources",
                "details": ", ".join(labor_codes),
            }
        )

    return {"summary": _summary(items), "items": items}


def audit_course_document(course: CourseDocument) -> dict[str, Any]:
    report = audit_course(course.as_api())
    present = {item["id"] for item in report["items"]}
    for item in framework_items(course):
        item_id = f"framework.{item['id']}"
        if item_id in present:
            continue
        report["items"].append(
            {
                "id": item_id,
                "label": item["label"],
                "status": "pass" if item["ok"] else "fail",
                "section": "framework",
            }
        )
    report["summary"] = _summary(report["items"])
    return report
