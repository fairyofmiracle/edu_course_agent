from __future__ import annotations

import re
from typing import Any, Literal

from .domain import framework_fingerprint, framework_items
from .models import CourseDocument

TurnMode = Literal["intake", "framework", "kit", "free"]
FRAMEWORK_REQUEST = re.compile(r"^Собери (только каркас|каркас по заполненному шаблону)")
KIT_TOOLS = ("set_assessment", "set_seminar", "set_lecture")


def is_framework_approved(course: CourseDocument) -> bool:
    return (
        course.framework_approved
        and course.framework_fingerprint == framework_fingerprint(course)
        and all(item["ok"] for item in framework_items(course))
    )


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
    return missing


def plan_step(
    mode: TurnMode,
    course: CourseDocument,
    history: list[str],
    user_turns: int,
) -> dict[str, Any]:
    def tried(key: str) -> int:
        return history.count(key)

    if mode == "kit":
        for gap in content_missing(course):
            key = f"{gap['tool']}:{gap['module']['id']}"
            if tried(key) < 2:
                return {
                    "kind": "tool",
                    "tool": gap["tool"],
                    "moduleId": gap["module"]["id"],
                    "task": f"Собери недостающий материал для модуля {gap['module']['id']}.",
                }
        return {"kind": "reply", "task": "Коротко подведи итог сборки комплекта."}
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
    if not tried("set_competency_map"):
        return {
            "kind": "tool",
            "tool": "set_competency_map",
            "task": "Собери 3–8 компетенций со знаниями, умениями и навыками.",
        }
    if not tried("set_structure"):
        return {
            "kind": "tool",
            "tool": "set_structure",
            "task": "Собери 3–8 модулей, связанные с компетенциями.",
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
