from __future__ import annotations

from typing import Any


def _hours(value: Any) -> str:
    number = round(float(value or 0) * 2) / 2
    if float(number).is_integer():
        return str(int(number))
    return str(number).replace(".", ",")


def _plan_flag(module: dict[str, Any]) -> str:
    plan = module.get("plan") or []
    if not plan:
        return "0"
    keys = ("lectureHours", "practiceHours", "labHours", "selfStudyHours")
    for key in keys:
        total = 0.0
        for row in plan:
            if isinstance(row, dict):
                total += float(row.get(key) or 0)
        if abs(total - float(module.get(key) or 0)) > 0.001:
            return "0"
    return "1"


def passport_stamp(text: str) -> str:
    """FNV-1a, 32 бита. Одинаковый на Python и в браузере."""
    value = 2166136261
    for byte in text.encode("utf-8"):
        value ^= byte
        value = (value * 16777619) & 0xFFFFFFFF
    return f"{value:08x}"


def module_rationales(course: dict[str, Any]) -> list[dict[str, str]]:
    """Почему модуль такой. Считает код по часам и связям, не модель."""
    brief = course.get("brief") if isinstance(course.get("brief"), dict) else {}
    duration = _hours(brief.get("durationHours"))
    questions: dict[str, set[str]] = {}
    for assessment in course.get("assessments") or []:
        if not isinstance(assessment, dict):
            continue
        module_id = str(assessment.get("moduleId") or "")
        known = questions.setdefault(module_id, set())
        for question in assessment.get("questions") or []:
            if isinstance(question, dict):
                outcome = str(question.get("learningOutcome") or "").strip()
                if outcome:
                    known.add(outcome)
    tasks: dict[str, set[str]] = {}
    for seminar in course.get("seminars") or []:
        if not isinstance(seminar, dict):
            continue
        module_id = str(seminar.get("moduleId") or "")
        known = tasks.setdefault(module_id, set())
        for task in seminar.get("tasks") or []:
            if isinstance(task, dict):
                outcome = str(task.get("learningOutcome") or "").strip()
                if outcome:
                    known.add(outcome)
    rows: list[dict[str, str]] = []
    for module in course.get("modules") or []:
        if not isinstance(module, dict):
            continue
        module_id = str(module.get("id") or "")
        covered: list[str] = []
        for outcome in module.get("learningOutcomes") or []:
            text = str(outcome).strip()
            if not text:
                continue
            has_question = text in questions.get(module_id, set())
            has_task = text in tasks.get(module_id, set())
            if has_question and has_task:
                covered.append(f"«{text}» закрыт тестом и заданием")
            else:
                missing = [name for name, present in (("тест", has_question), ("задание", has_task)) if not present]
                covered.append(f"«{text}»: не хватает {' и '.join(missing)}")
        sentence = (
            f"«{module.get('title') or 'Модуль'}»: {_hours(module.get('hours'))} ч "
            f"(лекции {_hours(module.get('lectureHours'))}, практика {_hours(module.get('practiceHours'))}, "
            f"лабораторные {_hours(module.get('labHours'))}, самостоятельная работа {_hours(module.get('selfStudyHours'))}). "
            f"Объём {duration} ч задал методист. "
            + ("; ".join(covered) + "." if covered else "Результаты задаёт каркас.")
        )
        rows.append({"id": module_id, "text": sentence})
    return rows


def result_passport(course: dict[str, Any]) -> str:
    """Вид, часы и штамп. Формулировки модели сюда не входят."""
    brief = course.get("brief") if isinstance(course.get("brief"), dict) else {}
    parts = [
        f"вид={brief.get('programKind') or 'unset'}",
        f"объём={_hours(brief.get('durationHours'))}",
        f"аттестация={_hours(brief.get('attestationHours'))}",
        f"форма={brief.get('format') or ''}",
    ]
    rows: list[str] = []
    for module in course.get("modules") or []:
        if not isinstance(module, dict):
            continue
        outcomes = module.get("learningOutcomes") or []
        rows.append(
            ":".join(
                [
                    str(module.get("id") or ""),
                    _hours(module.get("hours")),
                    _hours(module.get("lectureHours")),
                    _hours(module.get("practiceHours")),
                    _hours(module.get("labHours")),
                    _hours(module.get("selfStudyHours")),
                    str(len(outcomes) if isinstance(outcomes, list) else 0),
                    _plan_flag(module),
                ]
            )
        )
    parts.append("модули=" + ";".join(rows))
    body = " | ".join(parts)
    return f"{body} | штамп={passport_stamp(body)}"
