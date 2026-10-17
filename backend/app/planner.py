from __future__ import annotations

import re
from typing import Any, Literal

from .domain import framework_fingerprint, framework_items
from .catalog import is_data_analysis, is_internship
from .kit_content import has_stub_lectures, has_stub_questions
from .models import CourseDocument

TurnMode = Literal["intake", "framework", "kit", "free"]
FRAMEWORK_REQUEST = re.compile(r"^Собери (только каркас|каркас по заполненному шаблону)")
KIT_TOOLS = ("set_assessment", "set_seminar", "set_lecture")
KIT_QUESTION_TARGET = 10


def is_framework_approved(course: CourseDocument) -> bool:
    return (
        course.framework_approved
        and course.framework_fingerprint == framework_fingerprint(course)
        and all(item["ok"] for item in framework_items(course))
    )


def question_count(course: CourseDocument) -> int:
    return sum(len(item.questions) for item in course.assessments)


def kit_lecture_target(course: CourseDocument) -> int:
    return min(2, len(course.modules)) if course.modules else 0


def kit_needed(course: CourseDocument) -> bool:
    if not course.modules:
        return False
    if question_count(course) < KIT_QUESTION_TARGET or has_stub_questions(course):
        return True
    if len(course.lectures) < kit_lecture_target(course) or has_stub_lectures(course):
        return True
    return not course.seminars


def content_missing(course: CourseDocument) -> list[dict[str, Any]]:
    value = course.as_api()
    existing = {
        "set_assessment": {item["moduleId"] for item in value["assessments"]},
        "set_seminar": {item["moduleId"] for item in value["seminars"]},
        "set_lecture": {item["moduleId"] for item in value["lectures"]},
    }
    return [
        {"tool": tool, "module": module}
        for module in value["modules"]
        for tool in KIT_TOOLS
        if module["id"] not in existing[tool]
    ]


def decide_mode(course: CourseDocument, last_user_text: str) -> TurnMode:
    if is_framework_approved(course):
        return "kit" if content_missing(course) else "free"
    if FRAMEWORK_REQUEST.search(last_user_text.strip()):
        return "framework"
    return "intake"


def missing_brief_lines(course: CourseDocument) -> list[str]:
    brief = course.brief
    missing: list[str] = []
    if brief.program_kind == "unset":
        missing.append("тип программы")
    if brief.duration_hours <= 0:
        missing.append("точный объём в академических часах")
    if not brief.audience.strip():
        missing.append("аудитория")
    if not brief.attestation_form.strip():
        missing.append("форма итоговой аттестации")
    if brief.program_kind == "unset" or brief.duration_hours <= 0:
        missing.append("форма обучения")
    return list(dict.fromkeys(missing))


QUESTION_LABELS = {
    "тип программы": (
        "это общеразвивающая программа с сертификатом или повышение "
        "квалификации с удостоверением"
    ),
    "точный объём в академических часах": (
        "точный объём в академических часах. «Месяц» объёмом не считается"
    ),
    "аудитория": "кто слушатели и какой у них входной уровень",
    "форма итоговой аттестации": "как хотите принимать итоговую аттестацию",
    "форма обучения": "форма обучения: очно, очно-заочно или стажировка",
}


def intake_questions(course: CourseDocument) -> str:
    missing = missing_brief_lines(course)[:5]
    lines = [
        f"{index}. {QUESTION_LABELS.get(item, item)}?"
        for index, item in enumerate(missing, start=1)
    ]
    return "Не хватает данных, чтобы собрать программу. Уточните:\n" + "\n".join(lines)


def plan_step(
    mode: TurnMode,
    course: CourseDocument,
    history: list[str],
    user_turns: int,
) -> dict[str, Any]:
    def tried(key: str) -> int:
        return history.count(key)

    if mode == "kit":
        if question_count(course) < KIT_QUESTION_TARGET and course.modules:
            used = {item.module_id for item in course.assessments}
            module = next((item for item in course.modules if item.id not in used), course.modules[-1])
            key = f"set_assessment:{module.id}"
            if tried(key) < 2:
                left = max(KIT_QUESTION_TARGET - question_count(course), 1)
                return {
                    "kind": "tool",
                    "tool": "set_assessment",
                    "moduleId": module.id,
                    "task": (
                        f"Собери итоговый тест модуля {module.id}: ровно {left} mcq. "
                        "У каждого: stem, 4 options, answer, explanation из 3 слов, "
                        "competencyId, learningOutcome."
                    ),
                }
        if len(course.lectures) < kit_lecture_target(course) or has_stub_lectures(course):
            used = {item.module_id for item in course.lectures}
            module = next((item for item in course.modules if item.id not in used), course.modules[0])
            key = f"set_lecture:{module.id}"
            if tried(key) < 2:
                return {
                    "kind": "tool",
                    "tool": "set_lecture",
                    "moduleId": module.id,
                    "task": (
                        f"Собери слайды модуля {module.id}: 5–7 коротких пунктов. "
                        "Поясни термин при первом упоминании."
                    ),
                }
        if not course.seminars and course.modules:
            module = course.modules[-1]
            key = f"set_seminar:{module.id}"
            if tried(key) < 2:
                return {
                    "kind": "tool",
                    "tool": "set_seminar",
                    "moduleId": module.id,
                    "task": (
                        f"Собери одно задание модуля {module.id}: шаги и критерии защиты проекта."
                    ),
                }
        return {"kind": "reply", "task": "Коротко подведи итог: что уже собрано."}
    if mode == "free":
        return {
            "kind": "auto",
            "tools": [
                "revise_section",
                "set_lecture",
                "set_seminar",
                "set_assessment",
                "update_brief",
            ],
            "task": "Измени только названную методистом часть.",
        }
    if not tried("update_brief"):
        return {
            "kind": "tool",
            "tool": "update_brief",
            "task": "Перенеси только явно названные методистом поля брифа.",
        }
    missing = missing_brief_lines(course)
    answered_enough = user_turns >= 2 and bool(
        course.brief.audience.strip() or course.brief.goals
    )
    if mode == "intake" and missing and not answered_enough:
        return {
            "kind": "reply",
            "task": (
                f"Уточни: {', '.join(missing)}. Задай не больше пяти вопросов. "
                "«Примерно месяц» не считай точным объёмом."
            ),
        }
    short = 0 < course.brief.duration_hours <= 24
    if not tried("set_competency_map"):
        return {
            "kind": "tool",
            "tool": "set_competency_map",
            "task": (
                "Собери 3 короткие компетенции со знаниями и умениями."
                if short
                else "Собери 3–5 компетенций со знаниями, умениями и навыками. "
                "Код трудовой функции не выдумывай."
            ),
        }
    if not tried("set_structure"):
        hours = course.brief.duration_hours
        if is_internship(course):
            return {
                "kind": "tool",
                "tool": "set_structure",
                "task": (
                    f"Собери модули на {hours:g} ч. Лекции, практика и лабораторные "
                    "равны нулю, часы — самостоятельная работа. Аттестацию не растворяй "
                    "в модулях. Ошибку итоговой строки из образца не копируй."
                ),
            }
        if is_data_analysis(course):
            return {
                "kind": "tool",
                "tool": "set_structure",
                "task": (
                    f"Собери модули на {hours:g} ч: сначала Python для тех, кто был "
                    "в Excel, затем pandas, визуализация, SQL и статистика. "
                    "Текст образца не копируй."
                ),
            }
        if course.brief.program_kind == "qualification" and 24 < hours <= 40:
            return {
                "kind": "tool",
                "tool": "set_structure",
                "task": (
                    f"Собери 4 модуля на {hours:g} ч. Один модуль — риски, этика и "
                    "персональные данные учеников. Не копируй чужую стажировку. "
                    "Программирование не ставь. Очные и дистанционные часы раздели явно. "
                    "Сервисы только из России."
                ),
            }
        return {
            "kind": "tool",
            "tool": "set_structure",
            "task": (
                f"Собери 3 модуля. Практики не меньше половины. "
                f"Часы модулей + аттестация = {hours:g}."
                if short
                else "Собери 3–5 модулей, связанные с компетенциями."
            ),
        }
    failed = [item["id"] for item in framework_items(course) if not item["ok"]]
    return {
        "kind": "reply",
        "task": (
            f"Попроси проверить каркас. Не пройдены: {', '.join(failed)}."
            if failed
            else "Попроси проверить часы и утвердить каркас."
        ),
    }
