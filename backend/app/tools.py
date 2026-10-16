from __future__ import annotations

import json
import re
from typing import Any

from .brief_guard import guard_brief
from .domain import apply_patch
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
            "Записывает учебный план с целыми академическими часами.",
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


def _short_id(value: Any, fallback: str) -> str:
    clean = re.sub(r"[^a-zA-Z0-9_-]+", "-", str(value or "").strip()).strip("-")
    return (clean or fallback)[:40]


def execute_tool(
    name: str,
    arguments: dict[str, Any],
    course: CourseDocument,
    user_texts: list[str],
    form_brief: dict[str, Any] | None = None,
) -> dict[str, Any]:
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
