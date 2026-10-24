from __future__ import annotations

import re
from typing import Any, Literal

from .domain import framework_fingerprint, framework_items
from .catalog import block_count, is_data_analysis, is_internship
from .kit_content import has_stub_lectures, has_stub_questions, outcome_gaps
from .models import CourseDocument

TurnMode = Literal["intake", "framework", "kit", "free"]
FRAMEWORK_REQUEST = re.compile(r"^Собери (только каркас|каркас по заполненному шаблону)")
KIT_REQUEST = re.compile(r"^Каркас утверждён\.")
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


def lectured_modules(course: CourseDocument) -> list[Any]:
    return [item for item in course.modules if (item.lecture_hours or 0) > 0]


def kit_lecture_target(course: CourseDocument) -> int:
    return len(lectured_modules(course))


def kit_needed(course: CourseDocument) -> bool:
    if not course.modules:
        return False
    if question_count(course) < KIT_QUESTION_TARGET or has_stub_questions(course):
        return True
    target = kit_lecture_target(course)
    if target and (len(course.lectures) < target or has_stub_lectures(course)):
        return True
    seminar_ids = {item.module_id for item in course.seminars}
    if any(module.id not in seminar_ids for module in course.modules):
        return True
    return outcome_gaps(course)


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


def kit_request_ready(course: CourseDocument, last_user_text: str) -> bool:
    return bool(KIT_REQUEST.search(last_user_text.strip())) and all(
        item["ok"] for item in framework_items(course)
    )


EDIT_REQUEST = re.compile(
    r"(измен|замен|поправ|правь|сократ|увелич|уменьш|сделай|"
    r"продвинут|базов|аттестац|экзамен|зач[её]т|переимен|назван|"
    r"час(а|ов|ам)?\b|модул|блок)",
    re.IGNORECASE,
)


def is_edit_request(text: str) -> bool:
    cleaned = (text or "").strip()
    if not cleaned or KIT_REQUEST.search(cleaned) or FRAMEWORK_REQUEST.search(cleaned):
        return False
    return bool(EDIT_REQUEST.search(cleaned))


def decide_mode(course: CourseDocument, last_user_text: str) -> TurnMode:
    edit = is_edit_request(last_user_text)
    if is_framework_approved(course) or kit_request_ready(course, last_user_text):
        if edit:
            return "free"
        return "kit" if kit_needed(course) else "free"
    if FRAMEWORK_REQUEST.search(last_user_text.strip()):
        return "framework"
    if course.modules and edit:
        return "free"
    return "intake"


LEVEL_MARK = re.compile(
    r"курс|класс|без опыта|linux|excel|сет|базов|школьник|учитель|программ",
    re.IGNORECASE,
)


def audience_has_level(audience: str) -> bool:
    return bool(LEVEL_MARK.search(audience or ""))


def missing_brief_lines(course: CourseDocument) -> list[str]:
    brief = course.brief
    missing: list[str] = []
    if brief.program_kind == "unset":
        missing.append("тип программы")
    if brief.duration_hours <= 0:
        missing.append("точный объём в академических часах")
    if not brief.audience.strip():
        missing.append("аудитория")
    elif not audience_has_level(brief.audience) and (
        brief.program_kind == "unset" or brief.duration_hours <= 0
    ):
        missing.append("входной уровень слушателей")
    if (
        brief.attestation_status == "unset"
        and not brief.attestation_form.strip()
    ):
        missing.append("форма итоговой аттестации")
    if not brief.format_named and (brief.program_kind == "unset" or brief.duration_hours <= 0):
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
    "входной уровень слушателей": "какой входной уровень: курс, навыки, что уже умеют",
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
                outcomes = [
                    outcome
                    for item in course.modules
                    for outcome in item.learning_outcomes
                ]
                left = max(KIT_QUESTION_TARGET - question_count(course), 1)
                return {
                    "kind": "tool",
                    "tool": "set_assessment",
                    "moduleId": module.id,
                    "task": (
                        f"Собери итоговый тест: ровно {left} mcq на русском. "
                        f"Закрой результаты: {'; '.join(outcomes[:8]) or module.title}. "
                        "У каждого: stem, 4 options, answer, explanation, "
                        "competencyId, learningOutcome дословно из модуля."
                    ),
                }
        lectured = lectured_modules(course)
        if lectured and (
            len(course.lectures) < kit_lecture_target(course) or has_stub_lectures(course)
        ):
            used = {item.module_id for item in course.lectures}
            module = next((item for item in lectured if item.id not in used), lectured[0])
            key = f"set_lecture:{module.id}"
            if tried(key) < 2:
                return {
                    "kind": "tool",
                    "tool": "set_lecture",
                    "moduleId": module.id,
                    "task": (
                        f"Собери лекцию модуля «{module.title}»: outline из его тем, "
                        "слайды по 5–7 пунктов про эту тему и эту аудиторию. "
                        "Без фразы «сначала называем понятие своими словами»."
                    ),
                }
        missing_seminar = next(
            (module for module in course.modules if module.id not in {item.module_id for item in course.seminars}),
            None,
        )
        if missing_seminar is not None:
            module = missing_seminar
            key = f"set_seminar:{module.id}"
            if tried(key) < 2:
                return {
                    "kind": "tool",
                    "tool": "set_seminar",
                    "moduleId": module.id,
                    "task": (
                        f"Собери практические задания модуля «{module.title}»: "
                        "шаги и критерии. Каждое закрывает результат обучения. "
                        "Не пиши «учебное действие»."
                    ),
                }
        return {"kind": "reply", "task": "Коротко подведи итог: что уже собрано."}
    if mode == "free":
        if is_framework_approved(course):
            tools = [
                "revise_section",
                "set_lecture",
                "set_seminar",
                "set_assessment",
                "update_brief",
            ]
        else:
            tools = ["revise_section", "update_brief", "set_structure"]
        return {
            "kind": "auto",
            "tools": tools,
            "task": (
                "Измени только названную методистом часть. "
                "Обязательно вызови инструмент с новой версией данных, "
                "не ограничивайся текстом ответа."
            ),
        }
    if not tried("update_brief"):
        return {
            "kind": "tool",
            "tool": "update_brief",
            "task": "Перенеси только явно названные методистом поля брифа.",
        }
    missing = missing_brief_lines(course)
    if mode == "intake" and missing:
        return {
            "kind": "reply",
            "task": (
                f"Уточни: {', '.join(missing)}. Задай не больше пяти вопросов. "
                "«Примерно месяц» не считай точным объёмом. "
                "Компетенции и модули не собирай, пока этих данных нет."
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
    hours = course.brief.duration_hours
    total_blocks = block_count(hours) if hours > 0 else 0
    written = len(course.modules)
    passes = (total_blocks + 7) // 8 if total_blocks else 1
    if written < total_blocks and (
        tried("set_structure") == 0
        or (hours > 80 and tried("set_structure") < passes + 1)
    ):
        if hours > 80 and total_blocks > 8:
            start = written + 1
            end = min(total_blocks, written + 8)
            blocks = (
                f" Всего модулей-блоков: {total_blocks}. "
                f"Сейчас опиши только модули {start}–{end}. "
                "У каждого свои темы и часы. Уже записанные модули не повторяй."
            )
        elif hours > 80:
            blocks = (
                f" Разбей на {total_blocks} модулей-блоков, "
                "у каждого свои темы и часы. Не описывай всю программу одним текстом."
            )
        else:
            blocks = ""
        if is_internship(course):
            return {
                "kind": "tool",
                "tool": "set_structure",
                "task": (
                    f"Собери модули на {hours:g} ч. Лекции, практика и лабораторные "
                    "равны нулю, часы — самостоятельная работа. Аттестацию не растворяй "
                    "в модулях. Ошибку итоговой строки из образца не копируй."
                    + blocks
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
                    + blocks
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
                f"Собери 3 модуля по теме запроса. Практики не меньше половины. "
                f"Названия — про эту аудиторию, не «основные понятия». "
                f"Часы модулей + аттестация = {hours:g}."
                if short
                else (
                    f"Собери 3–5 модулей на {hours:g} ч по теме и аудитории запроса. "
                    "Не копируй тему и часы образца. Код трудовой функции не выдумывай."
                    + blocks
                )
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
