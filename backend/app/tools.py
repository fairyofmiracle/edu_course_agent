from __future__ import annotations

import json
import re
from typing import Any

from .brief_guard import guard_brief
from .domain import apply_patch
from .kit_content import (
    STUB_BULLET,
    STUB_QUESTION,
    default_competencies,
    fallback_questions,
    is_stub_competency_node,
    lecture_for_module,
    project_seminar,
    slides_for_topic,
)
from .models import CourseDocument
from .planner import is_framework_approved

COURSE_TOOL_NAMES = (
    "update_brief",
    "set_competency_map",
    "set_structure",
    "set_lecture",
    "set_seminar",
    "set_assessment",
    "revise_section",
)

BRIEF_PROPERTIES = {
    "title": {"type": "string"},
    "audience": {"type": "string"},
    "level": {"type": "string", "enum": ["beginner", "intermediate", "advanced"]},
    "durationHours": {"type": "number"},
    "format": {"type": "string", "enum": ["lecture", "blended", "workshop"]},
    "programKind": {"type": "string", "enum": ["general", "qualification"]},
    "attestationHours": {"type": "number"},
    "attestationForm": {"type": "string"},
    "goals": {"type": "array", "items": {"type": "string"}},
    "constraints": {"type": "array", "items": {"type": "string"}},
}

MODULE_SCHEMA = {
    "type": "object",
    "properties": {
        "id": {"type": "string"},
        "title": {"type": "string"},
        "hours": {"type": "number"},
        "lectureHours": {"type": "number"},
        "practiceHours": {"type": "number"},
        "labHours": {"type": "number"},
        "selfStudyHours": {"type": "number"},
        "topics": {"type": "array", "items": {"type": "string"}},
        "plan": {"type": "array", "items": {"type": "object"}},
        "learningOutcomes": {"type": "array", "items": {"type": "string"}},
        "competencyIds": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["id", "title", "topics", "learningOutcomes"],
}


def _function(name: str, description: str, parameters: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": parameters,
        },
    }


def course_tools() -> list[dict[str, Any]]:
    object_schema = {"type": "object", "additionalProperties": True}
    module_content = {
        "type": "object",
        "properties": {
            "moduleId": {"type": "string"},
        },
        "required": ["moduleId"],
        "additionalProperties": True,
    }
    return [
        _function(
            "update_brief",
            "Обновляет только явно названные поля брифа.",
            {"type": "object", "properties": BRIEF_PROPERTIES},
        ),
        _function(
            "set_competency_map",
            "Записывает карту компетенций со знаниями, умениями и навыками.",
            {
                "type": "object",
                "properties": {
                    "nodes": {"type": "array", "items": object_schema},
                    "edges": {"type": "array", "items": object_schema},
                },
                "required": ["nodes"],
            },
        ),
        _function(
            "set_structure",
            "Записывает учебный план с академическими часами шагом 0,5.",
            {
                "type": "object",
                "properties": {"modules": {"type": "array", "items": MODULE_SCHEMA}},
                "required": ["modules"],
            },
        ),
        _function("set_lecture", "Записывает лекцию одного модуля.", module_content),
        _function("set_seminar", "Записывает семинар одного модуля.", module_content),
        _function("set_assessment", "Записывает тест одного модуля.", module_content),
        _function(
            "revise_section",
            "Точечно заменяет одну секцию документа.",
            {
                "type": "object",
                "properties": {
                    "section": {
                        "type": "string",
                        "enum": [
                            "brief",
                            "competencies",
                            "structure",
                            "lecture",
                            "seminar",
                            "assessment",
                        ],
                    },
                    "moduleId": {"type": "string"},
                    "data": {"type": "object"},
                },
                "required": ["section", "data"],
            },
        ),
    ]


TOOL_ALIASES = {
    "set_brief": "update_brief",
    "updateBrief": "update_brief",
    "set_competencies": "set_competency_map",
    "set_competency": "set_competency_map",
    "set_modules": "set_structure",
    "set_plan": "set_structure",
}


def _number(value: Any, default: float = 0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def coerce_competency_arguments(arguments: dict[str, Any], course: CourseDocument) -> dict[str, Any]:
    nodes = arguments.get("nodes")
    if isinstance(nodes, list) and nodes and isinstance(nodes[0], dict) and nodes[0].get("name"):
        if not all(is_stub_competency_node(node) for node in nodes if isinstance(node, dict)):
            return arguments
    return {"nodes": default_competencies(course)}


def coerce_structure_arguments(arguments: dict[str, Any]) -> dict[str, Any]:
    modules = arguments.get("modules")
    if not isinstance(modules, list):
        modules = []
    coerced: list[dict[str, Any]] = []
    for index, raw in enumerate(modules):
        if not isinstance(raw, dict):
            continue
        title = str(raw.get("title") or f"Модуль {index + 1}").strip()
        hours = _number(raw.get("hours"), _number(raw.get("academicHours")))
        lecture = _number(raw.get("lectureHours"), _number(raw.get("lecturesHours")))
        practice = _number(raw.get("practiceHours"), _number(raw.get("practicesHours")))
        lab = _number(raw.get("labHours"))
        self_study = _number(raw.get("selfStudyHours"))
        if hours <= 0:
            hours = lecture + practice + lab + self_study
        if hours > 0 and lecture + practice + lab + self_study <= 0:
            practice = round(hours / 2 * 2) / 2
            lecture = hours - practice
        topics = raw.get("topics") if isinstance(raw.get("topics"), list) else []
        topics = [str(item).strip() for item in topics if str(item).strip()]
        if not topics:
            description = str(raw.get("description") or "").strip()
            topics = [description[:160]] if description else [title]
        outcomes = raw.get("learningOutcomes") if isinstance(raw.get("learningOutcomes"), list) else []
        outcomes = [str(item).strip() for item in outcomes if str(item).strip()]
        if not outcomes:
            outcomes = [f"Выполняет задания модуля «{title}»"]
        if hours > 0 and lecture + practice + lab + self_study - hours > 0.001:
            extra = lecture + practice + lab + self_study - hours
            take = min(lecture, extra)
            lecture -= take
        coerced.append(
            {
                "id": raw.get("id") or f"m{index + 1}",
                "title": title,
                "hours": hours,
                "lectureHours": lecture,
                "practiceHours": practice,
                "labHours": lab,
                "selfStudyHours": self_study,
                "topics": topics[:8],
                "learningOutcomes": outcomes[:6],
                "competencyIds": raw.get("competencyIds") or [],
                "plan": raw.get("plan") or [],
            }
        )
    _ensure_half_practice(coerced)
    return {"modules": coerced}


def _ensure_half_practice(modules: list[dict[str, Any]]) -> None:
    total = sum(_number(module.get("hours")) for module in modules)
    practice = sum(_number(module.get("practiceHours")) for module in modules)
    need = total / 2
    leftover = need - practice
    if leftover <= 0 or total <= 0:
        return
    for module in modules:
        if leftover <= 0:
            break
        lecture = _number(module.get("lectureHours"))
        take = min(lecture, leftover)
        if take <= 0:
            continue
        module["lectureHours"] = lecture - take
        module["practiceHours"] = _number(module.get("practiceHours")) + take
        leftover -= take


def _module_by_id(course: CourseDocument, module_id: str | None) -> Any:
    if module_id:
        found = next((item for item in course.modules if item.id == module_id), None)
        if found:
            return found
    return course.modules[0] if course.modules else None


def coerce_assessment_arguments(
    arguments: dict[str, Any],
    course: CourseDocument,
    module_id: str | None,
) -> dict[str, Any]:
    module = _module_by_id(course, arguments.get("moduleId") or module_id)
    mid = module.id if module else (module_id or "m1")
    questions = arguments.get("questions")
    stubby = isinstance(questions, list) and any(
        STUB_QUESTION.search(str(item.get("stem") or ""))
        for item in questions
        if isinstance(item, dict)
    )
    if not isinstance(questions, list) or len(questions) < 10 or stubby:
        questions = fallback_questions(course, mid)
    cleaned: list[dict[str, Any]] = []
    outcomes = list(module.learning_outcomes) if module and module.learning_outcomes else [""]
    competency = (module.competency_ids[0] if module and module.competency_ids else "c1")
    for index, raw in enumerate(questions[:10]):
        if not isinstance(raw, dict):
            continue
        outcome = str(raw.get("learningOutcome") or outcomes[index % len(outcomes)])
        cleaned.append(
            {
                "type": raw.get("type") or "mcq",
                "stem": str(raw.get("stem") or f"Вопрос {index + 1}"),
                "options": raw.get("options")
                if isinstance(raw.get("options"), list)
                else ["Да", "Нет", "Не знаю", "Другое"],
                "answer": str(raw.get("answer") or (raw.get("options") or ["Да"])[0]),
                "explanation": str(raw.get("explanation") or "По материалу модуля"),
                "competencyId": raw.get("competencyId") or competency,
                "learningOutcome": outcome,
            }
        )
    if len(cleaned) < 10:
        cleaned.extend(fallback_questions(course, mid)[: 10 - len(cleaned)])
    return {"moduleId": mid, "questions": cleaned[:10]}


def coerce_lecture_arguments(
    arguments: dict[str, Any],
    course: CourseDocument,
    module_id: str | None,
) -> dict[str, Any]:
    module = _module_by_id(course, arguments.get("moduleId") or module_id)
    mid = module.id if module else (module_id or "m1")
    outline = arguments.get("outline")
    if isinstance(outline, str) and outline.strip():
        outline = [outline.strip()]
    if not isinstance(outline, list) or not outline:
        outline = list(module.topics[:6]) if module and module.topics else ["Тема занятия"]
    outline = [str(item).strip() for item in outline if str(item).strip()][:7]
    slides = arguments.get("slides")
    cleaned_slides: list[dict[str, Any]] = []
    if isinstance(slides, list):
        for slide in slides:
            if not isinstance(slide, dict) or not slide.get("title"):
                continue
            bullets = slide.get("bullets")
            if not isinstance(bullets, list) or not bullets or STUB_BULLET.search(" ".join(map(str, bullets))):
                cleaned_slides.append(slides_for_topic(str(slide["title"]), course))
                continue
            cleaned_slides.append(
                {"title": str(slide["title"]), "bullets": [str(item) for item in bullets[:6]]}
            )
    if not cleaned_slides:
        built = lecture_for_module(module, course) if module else None
        cleaned_slides = built["slides"] if built else [slides_for_topic(item, course) for item in outline]
        outline = built["outline"] if built else outline
    duration = _number(arguments.get("durationMin"), 45)
    if duration <= 0 or duration > 180:
        hours = module.lecture_hours if module else 1
        duration = max(30, min(90, hours * 45 or 45))
    return {
        "moduleId": mid,
        "durationMin": duration,
        "outline": outline,
        "slides": cleaned_slides,
    }


def coerce_seminar_arguments(
    arguments: dict[str, Any],
    course: CourseDocument,
    module_id: str | None,
) -> dict[str, Any]:
    generated = project_seminar(course) or {}
    tasks = arguments.get("tasks")
    if isinstance(tasks, list) and tasks:
        generated = {**generated, "tasks": tasks, "moduleId": arguments.get("moduleId") or generated.get("moduleId")}
    if module_id and not generated.get("moduleId"):
        generated["moduleId"] = module_id
    return generated


def _short_id(value: Any, fallback: str) -> str:
    clean = re.sub(r"[^a-zA-Z0-9_-]+", "-", str(value or "").strip()).strip("-")
    return (clean or fallback)[:40]


def execute_tool(
    name: str,
    arguments: dict[str, Any],
    course: CourseDocument,
    user_texts: list[str],
    form_brief: dict[str, Any] | None = None,
    module_id: str | None = None,
) -> dict[str, Any]:
    name = TOOL_ALIASES.get(name, name)
    allow_content = is_framework_approved(course)
    if name in {"set_lecture", "set_seminar", "set_assessment"} and not allow_content:
        return {
            "type": "tool_error",
            "message": "Каркас должен утвердить методист до сборки комплекта.",
        }
    if name == "update_brief":
        brief, _ = guard_brief(
            arguments,
            course.brief.model_dump(by_alias=True),
            user_texts,
            form_brief,
        )
        return {"type": "update_brief", "brief": brief}
    if name == "set_competency_map":
        arguments = coerce_competency_arguments(arguments, course)
        nodes = []
        for index, raw in enumerate(arguments.get("nodes") or []):
            node = dict(raw)
            node["id"] = _short_id(node.get("id"), f"c{index + 1}")
            node.setdefault("bloomLevel", "apply")
            node.setdefault("moduleIds", [])
            node.setdefault("knowledge", [f"Знает: {node.get('name', 'компетенция')}"])
            node.setdefault("skills", [f"Умеет применить: {node.get('name', 'компетенция')}"])
            node.setdefault("abilities", [f"Владеет: {node.get('name', 'компетенция')}"])
            nodes.append(node)
        return {
            "type": "set_competency_map",
            "competencies": {"nodes": nodes, "edges": arguments.get("edges") or []},
        }
    if name == "set_structure":
        arguments = coerce_structure_arguments(arguments)
        modules = []
        seen: set[str] = set()
        for index, raw in enumerate(arguments.get("modules") or []):
            module = dict(raw)
            module_id = _short_id(module.get("id"), f"m{index + 1}")
            if module_id in seen:
                module_id = f"{module_id}-{index + 1}"[:40]
            seen.add(module_id)
            module["id"] = module_id
            module.setdefault("hours", 0)
            module.setdefault("lectureHours", 0)
            module.setdefault("practiceHours", 0)
            module.setdefault("labHours", 0)
            module.setdefault("selfStudyHours", 0)
            module.setdefault("plan", [])
            module.setdefault("competencyIds", [])
            modules.append(module)
        return {"type": "set_structure", "modules": modules}
    if name == "set_assessment":
        return {
            "type": "set_assessment",
            "assessment": coerce_assessment_arguments(arguments, course, module_id),
        }
    if name == "set_lecture":
        return {
            "type": "set_lecture",
            "lecture": coerce_lecture_arguments(arguments, course, module_id),
        }
    if name == "set_seminar":
        return {
            "type": "set_seminar",
            "seminar": coerce_seminar_arguments(arguments, course, module_id),
        }
    if name.startswith("set_"):
        return {"type": name, name.removeprefix("set_"): arguments}
    if name == "revise_section":
        data = arguments.get("data")
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except json.JSONDecodeError:
                pass
        return {
            "type": "revise_section",
            "section": arguments.get("section"),
            "moduleId": arguments.get("moduleId"),
            "data": data,
        }
    return {"type": "tool_error", "message": f"Неизвестный инструмент: {name}"}


def apply_tool_output(course: CourseDocument, output: dict[str, Any]) -> CourseDocument:
    return apply_patch(course, output)
