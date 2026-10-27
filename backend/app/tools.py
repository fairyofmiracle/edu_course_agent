from __future__ import annotations
import math
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
        "workloadWeight": {
            "type": "number",
            "exclusiveMinimum": 0,
            "description": (
                "Относительная педагогическая трудоёмкость модуля. "
                "Чем выше значение, тем больше времени требуется "
                "на освоение материала. Это не академические часы."
            ),
        },
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


_BLOOM = {
    "remember": "remember",
    "understand": "understand",
    "apply": "apply",
    "analyze": "analyze",
    "analyse": "analyze",
    "evaluate": "evaluate",
    "create": "create",
    "знание": "remember",
    "понимание": "understand",
    "применение": "apply",
    "анализ": "analyze",
    "оценка": "evaluate",
    "создание": "create",
}


def _text_list(value: Any, fallback: str) -> list[str]:
    if isinstance(value, str):
        value = [part.strip() for part in re.split(r"[;\n]", value) if part.strip()]
    if not isinstance(value, list):
        value = []
    items = []
    for item in value:
        text = str(item.get("name") if isinstance(item, dict) else item).strip()
        if text:
            items.append(text[:240])
        if len(items) == 8:
            break
    return items or [fallback[:240]]


def _clean_competency_node(raw: dict[str, Any], index: int, drop_labor_code: bool) -> dict[str, Any]:
    name = str(raw.get("name") or f"Компетенция {index + 1}").strip()[:180] or f"Компетенция {index + 1}"
    bloom = _BLOOM.get(str(raw.get("bloomLevel") or "").strip().lower(), "apply")
    module_ids = raw.get("moduleIds") if isinstance(raw.get("moduleIds"), list) else []
    node: dict[str, Any] = {
        "id": _short_id(raw.get("id"), f"c{index + 1}"),
        "name": name,
        "bloomLevel": bloom,
        "moduleIds": [_short_id(item, f"m{i + 1}") for i, item in enumerate(module_ids[:24])],
        "knowledge": _text_list(raw.get("knowledge"), f"Знает основу: {name}"),
        "skills": _text_list(raw.get("skills"), f"Умеет применить: {name}"),
        "abilities": _text_list(raw.get("abilities"), f"Владеет приёмом: {name}"),
    }
    description = str(raw.get("description") or "").strip()
    if description:
        node["description"] = description[:400]
    code = str(raw.get("laborFunctionCode") or "").strip()
    if code and not drop_labor_code:
        node["laborFunctionCode"] = code[:40]
    return node


def coerce_competency_arguments(arguments: dict[str, Any], course: CourseDocument) -> dict[str, Any]:
    from .catalog import profile_name

    nodes = arguments.get("nodes")
    if isinstance(nodes, list) and nodes and isinstance(nodes[0], dict) and nodes[0].get("name"):
        if not all(is_stub_competency_node(node) for node in nodes if isinstance(node, dict)):
            if profile_name(course) == "generic":
                cleaned = []
                for node in nodes:
                    if not isinstance(node, dict):
                        continue
                    row = dict(node)
                    row.pop("laborFunctionCode", None)
                    cleaned.append(row)
                return {"nodes": cleaned or arguments.get("nodes")}
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
        workload_weight = raw.get("workloadWeight")
        try:
            workload_weight = float(workload_weight)
            if not math.isfinite(workload_weight) or workload_weight <= 0:
                workload_weight = None
        except (TypeError, ValueError):
            workload_weight = None
        coerced.append(
            {
                "id": raw.get("id") or f"m{index + 1}",
                "title": title,
                "hours": hours,
                "workloadWeight": workload_weight,
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
    return {"modules": coerced}


def _ensure_half_practice(modules: list[dict[str, Any]]) -> None:
    """Практике нужна половина часов. Лекцию забираем по кругу, не обнуляя первые модули."""
    total = sum(_number(module.get("hours")) for module in modules)
    practice = sum(_number(module.get("practiceHours")) for module in modules)
    leftover = total / 2 - practice
    if leftover <= 0.001 or total <= 0:
        return

    def draw(reserve: float) -> None:
        nonlocal leftover
        for _ in range(400):
            if leftover <= 0.001:
                return
            moved = False
            for module in modules:
                if leftover <= 0.001:
                    return
                lecture = _number(module.get("lectureHours"))
                room = lecture - reserve
                if room <= 0.001:
                    continue
                take = min(0.5, room, leftover)
                module["lectureHours"] = lecture - take
                module["practiceHours"] = _number(module.get("practiceHours")) + take
                leftover -= take
                moved = True
            if not moved:
                return

    draw(0.5)
    draw(0)


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
    origin = "model"
    if not isinstance(questions, list) or not questions or stubby:
        questions = fallback_questions(course, mid)
        origin = "catalog"
    cleaned: list[dict[str, Any]] = []
    outcomes = list(module.learning_outcomes) if module and module.learning_outcomes else [""]
    competency = (module.competency_ids[0] if module and module.competency_ids else "c1")
    for index, raw in enumerate(questions[:10]):
        if not isinstance(raw, dict):
            continue
        outcome = (
            outcomes[index % len(outcomes)]
            if outcomes and outcomes[0]
            else str(raw.get("learningOutcome") or "")
        )
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
    kept = len(cleaned)
    if kept < 10:
        cleaned.extend(fallback_questions(course, mid)[: 10 - kept])
        if origin == "model":
            origin = "mixed" if kept else "catalog"
    return {"moduleId": mid, "questions": cleaned[:10], "_origin": origin}


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
    model_slides = 0
    if isinstance(slides, list):
        for slide in slides:
            if not isinstance(slide, dict) or not slide.get("title"):
                continue
            bullets = slide.get("bullets")
            if not isinstance(bullets, list) or not bullets or STUB_BULLET.search(" ".join(map(str, bullets))):
                cleaned_slides.append(slides_for_topic(str(slide["title"]), course))
                continue
            model_slides += 1
            payload: dict[str, Any] = {
                "title": str(slide["title"]),
                "bullets": [str(item) for item in bullets[:6]],
            }
            if isinstance(slide.get("mermaid"), str) and slide["mermaid"].strip():
                payload["mermaid"] = slide["mermaid"].strip()[:1500]
            if isinstance(slide.get("visualPrompt"), str) and slide["visualPrompt"].strip():
                payload["visualPrompt"] = slide["visualPrompt"].strip()[:280]
            if isinstance(slide.get("speakerNotes"), str) and slide["speakerNotes"].strip():
                payload["speakerNotes"] = slide["speakerNotes"].strip()[:600]
            table = slide.get("table")
            if isinstance(table, list) and table:
                payload["table"] = [
                    [str(cell).strip()[:80] or "—" for cell in row]
                    for row in table
                    if isinstance(row, list) and row
                ]
            cleaned_slides.append(payload)
    if model_slides == 0:
        origin = "catalog"
    elif model_slides < len(cleaned_slides):
        origin = "mixed"
    else:
        origin = "model"
    if not cleaned_slides:
        built = lecture_for_module(module, course) if module else None
        cleaned_slides = built["slides"] if built else [slides_for_topic(item, course) for item in outline]
        outline = built["outline"] if built else outline
    elif module is not None:
        cleaned_slides = [
            item for item in cleaned_slides if item.get("title") != "Часы модуля" and not item.get("table")
        ]
        if len(cleaned_slides) > 12:
            visuals = [item for item in cleaned_slides if item.get("mermaid")]
            body = [item for item in cleaned_slides if item not in visuals]
            cleaned_slides = body[: 12 - len(visuals)] + visuals
    duration = _number(arguments.get("durationMin"), 45)
    if duration <= 0 or duration > 180:
        hours = module.lecture_hours if module else 1
        duration = max(30, min(90, hours * 45 or 45))
    return {
        "moduleId": mid,
        "durationMin": duration,
        "outline": outline,
        "slides": cleaned_slides,
        "_origin": origin,
    }


def coerce_seminar_arguments(
    arguments: dict[str, Any],
    course: CourseDocument,
    module_id: str | None,
) -> dict[str, Any]:
    from .kit_content import seminar_for_module

    module = _module_by_id(course, arguments.get("moduleId") or module_id)
    if module is None:
        generated = project_seminar(course) or {}
        if module_id and not generated.get("moduleId"):
            generated["moduleId"] = module_id
        generated["_origin"] = "catalog"
        return generated
    tasks = arguments.get("tasks")
    if isinstance(tasks, list) and tasks:
        try:
            value = course.as_api()
            value["seminars"] = [
                item
                for item in value["seminars"]
                if item.get("moduleId") != module.id
            ] + [{"moduleId": module.id, "tasks": tasks}]
            seminar = seminar_for_module(CourseDocument.model_validate(value), module)
            seminar["_origin"] = "model"
            return seminar
        except Exception:
            seminar = seminar_for_module(course, module)
            seminar["_origin"] = "catalog"
            return seminar
    seminar = seminar_for_module(course, module)
    seminar["_origin"] = "catalog"
    return seminar


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
        drop_labor_code = course.brief.program_kind != "qualification"
        nodes = [
            _clean_competency_node(raw, index, drop_labor_code)
            for index, raw in enumerate(arguments.get("nodes") or [])
            if isinstance(raw, dict)
        ]
        edges = []
        for edge in arguments.get("edges") or []:
            if isinstance(edge, dict) and edge.get("from") and edge.get("to"):
                edges.append(
                    {
                        "from": _short_id(edge.get("from"), "c1"),
                        "to": _short_id(edge.get("to"), "c2"),
                    }
                )
        return {
            "type": "set_competency_map",
            "competencies": {"nodes": nodes, "edges": edges[:80]},
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
        assessment = coerce_assessment_arguments(arguments, course, module_id)
        return {
            "type": "set_assessment",
            "assessment": assessment,
            "origin": assessment.pop("_origin", "model"),
        }
    if name == "set_lecture":
        lecture = coerce_lecture_arguments(arguments, course, module_id)
        return {
            "type": "set_lecture",
            "lecture": lecture,
            "origin": lecture.pop("_origin", "model"),
        }
    if name == "set_seminar":
        seminar = coerce_seminar_arguments(arguments, course, module_id)
        return {
            "type": "set_seminar",
            "seminar": seminar,
            "origin": seminar.pop("_origin", "catalog"),
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
