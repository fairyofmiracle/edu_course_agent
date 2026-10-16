from __future__ import annotations

import json
import math
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any

from pydantic import ValidationError

from .models import CourseDocument

KIND_KEYS = ("lectureHours", "practiceHours", "labHours", "selfStudyHours")
PATCH_TYPES = {
    "update_brief",
    "set_competency_map",
    "set_structure",
    "set_lecture",
    "set_seminar",
    "set_assessment",
    "revise_section",
}


def academic_hours(value: Any) -> int:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0
    return round(number) if math.isfinite(number) and number > 0 else 0


def allocate_integer(
    target: float, weights: list[float], *, keep_zero: bool = True
) -> list[int]:
    if not weights:
        return []
    goal = academic_hours(target)
    if goal <= 0:
        return [0] * len(weights)
    raw = [value if math.isfinite(value) and value > 0 else 0 for value in weights]
    usable = [
        (index, value)
        for index, value in enumerate(raw)
        if value > 0 or not keep_zero
    ]
    if not usable:
        each, remainder = divmod(goal, len(raw))
        return [
            each + (1 if index >= len(raw) - remainder else 0)
            for index in range(len(raw))
        ]
    total = sum(value for _, value in usable)
    exact = [(index, goal * value / total) for index, value in usable]
    result = [0] * len(raw)
    for index, value in exact:
        result[index] = math.floor(value)
    remainder = goal - sum(result)
    ranked = sorted(
        exact,
        key=lambda pair: (
            -(pair[1] - math.floor(pair[1])),
            -raw[pair[0]],
            pair[0],
        ),
    )
    for cursor in range(remainder):
        result[ranked[cursor % len(ranked)][0]] += 1
    return result


def _kind_sum(value: dict[str, Any]) -> int:
    return sum(academic_hours(value.get(key, 0)) for key in KIND_KEYS)


def _fill_plan(module: dict[str, Any]) -> dict[str, Any]:
    result = deepcopy(module)
    title = str(result.get("title") or "").strip() or "Модуль"
    topics = [
        str(value).strip()
        for value in result.get("topics") or []
        if str(value).strip()
    ] or [title]
    hours = academic_hours(result.get("hours")) or _kind_sum(result) or 1
    weights = [academic_hours(result.get(key)) for key in KIND_KEYS]
    kinds = allocate_integer(
        hours,
        weights if any(weights) else [1, 2, 0, 1],
        keep_zero=True,
    )
    result.update({"title": title, "hours": hours, "topics": topics})
    result.update(dict(zip(KIND_KEYS, kinds)))
    outcomes = [
        str(value).strip()
        for value in result.get("learningOutcomes") or []
        if str(value).strip()
    ]
    result["learningOutcomes"] = outcomes or [f"Осваивает: {title}"]

    plan = result.get("plan") or []
    matches = bool(plan) and all(
        sum(academic_hours(row.get(key)) for row in plan) == result[key]
        for key in KIND_KEYS
    )
    if matches:
        result["plan"] = [
            {
                **row,
                **{key: academic_hours(row.get(key)) for key in KIND_KEYS},
            }
            for row in plan
        ]
        return result

    rows = [{"title": topic, **{key: 0 for key in KIND_KEYS}} for topic in topics]
    for key in KIND_KEYS:
        allocation = allocate_integer(result[key], [1] * len(rows), keep_zero=False)
        for index, value in enumerate(allocation):
            rows[index][key] = value
    result["plan"] = rows
    return result


def balance_modules(
    modules: list[dict[str, Any]], duration_hours: float, attestation_hours: float
) -> list[dict[str, Any]]:
    if not modules:
        return []
    filled = [_fill_plan(module) for module in modules]
    target = academic_hours(max(0, duration_hours - attestation_hours))
    if target <= 0:
        return filled
    hours = allocate_integer(
        target,
        [float(module.get("hours") or 0) for module in filled],
        keep_zero=False,
    )
    return [_fill_plan({**module, "hours": hours[index]}) for index, module in enumerate(filled)]


def _link_competencies(course: dict[str, Any]) -> None:
    nodes = course["competencies"]["nodes"]
    modules = course["modules"]
    if not nodes or not modules:
        return
    node_ids = {str(node["id"]).lower(): node["id"] for node in nodes}
    module_ids = {str(module["id"]).lower(): module["id"] for module in modules}
    for module in modules:
        module["competencyIds"] = list(
            dict.fromkeys(
                node_ids[str(value).lower()]
                for value in module.get("competencyIds", [])
                if str(value).lower() in node_ids
            )
        )
    for node in nodes:
        node["moduleIds"] = list(
            dict.fromkeys(
                module_ids[str(value).lower()]
                for value in node.get("moduleIds", [])
                if str(value).lower() in module_ids
            )
        )
    for index, module in enumerate(modules):
        if not module["competencyIds"]:
            module["competencyIds"] = [nodes[index % len(nodes)]["id"]]
    for node in nodes:
        linked = [
            module["id"]
            for module in modules
            if node["id"] in module["competencyIds"]
        ]
        if not linked:
            host = modules[nodes.index(node) % len(modules)]
            host["competencyIds"].append(node["id"])
            linked = [host["id"]]
        node["moduleIds"] = linked


def rebalance_course(course: CourseDocument) -> CourseDocument:
    value = course.as_api()
    if not value["modules"] or value["brief"]["durationHours"] <= 0:
        return course
    _link_competencies(value)
    value["modules"] = balance_modules(
        value["modules"],
        value["brief"]["durationHours"],
        value["brief"]["attestationHours"],
    )
    return CourseDocument.model_validate(value)


def _upsert(items: list[dict[str, Any]], value: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        *(item for item in items if item.get("moduleId") != value.get("moduleId")),
        value,
    ]


def apply_patch(course: CourseDocument, patch: dict[str, Any]) -> CourseDocument:
    if patch.get("type") not in PATCH_TYPES:
        return course
    value = course.as_api()
    patch_type = patch["type"]
    try:
        if patch_type == "update_brief":
            value["brief"].update(patch.get("brief") or {})
        elif patch_type == "set_competency_map":
            value["competencies"] = patch["competencies"]
        elif patch_type == "set_structure":
            value["modules"] = patch["modules"]
        elif patch_type == "set_lecture":
            value["lectures"] = _upsert(value["lectures"], patch["lecture"])
        elif patch_type == "set_seminar":
            value["seminars"] = _upsert(value["seminars"], patch["seminar"])
        elif patch_type == "set_assessment":
            value["assessments"] = _upsert(value["assessments"], patch["assessment"])
        else:
            section = patch.get("section")
            data = deepcopy(patch.get("data"))
            module_id = patch.get("moduleId")
            if module_id and isinstance(data, dict):
                data.setdefault("moduleId", module_id)
            translated = {
                "brief": {"type": "update_brief", "brief": data},
                "competencies": {"type": "set_competency_map", "competencies": data},
                "structure": {
                    "type": "set_structure",
                    "modules": data.get("modules") if isinstance(data, dict) else data,
                },
                "lecture": {"type": "set_lecture", "lecture": data},
                "seminar": {"type": "set_seminar", "seminar": data},
                "assessment": {"type": "set_assessment", "assessment": data},
            }.get(section)
            return apply_patch(course, translated) if translated else course
        value["updatedAt"] = datetime.now(timezone.utc).isoformat()
        return rebalance_course(CourseDocument.model_validate(value))
    except (KeyError, TypeError, ValidationError):
        return course


def framework_fingerprint(course: CourseDocument) -> str:
    value = course.as_api()
    brief = value["brief"]
    return json.dumps(
        {
            "hours": brief["durationHours"],
            "programKind": brief["programKind"],
            "attestationHours": brief["attestationHours"],
            "modules": [
                {
                    key: module[key]
                    for key in ("id", "hours", *KIND_KEYS, "competencyIds")
                }
                for module in value["modules"]
            ],
            "nodes": [
                {"id": node["id"], "moduleIds": sorted(node["moduleIds"])}
                for node in value["competencies"]["nodes"]
            ],
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )


def framework_items(course: CourseDocument) -> list[dict[str, Any]]:
    value = course.as_api()
    brief, modules = value["brief"], value["modules"]
    nodes = value["competencies"]["nodes"]
    competency_ids = {node["id"] for node in nodes}
    used_ids = {item for module in modules for item in module["competencyIds"]}
    unknown = [
        item
        for module in modules
        for item in module["competencyIds"]
        if item not in competency_ids
    ]
    uncovered = [node["id"] for node in nodes if node["id"] not in used_ids]
    total = sum(float(module["hours"]) for module in modules) + brief["attestationHours"]
    kinds_match = all(_kind_sum(module) == academic_hours(module["hours"]) for module in modules)
    plan_match = all(
        bool(module["plan"])
        and all(
            sum(academic_hours(row.get(key)) for row in module["plan"])
            == academic_hours(module[key])
            for key in KIND_KEYS
        )
        for module in modules
    )
    zun_ok = all(
        node["knowledge"] and node["skills"] and node["abilities"] for node in nodes
    )
    return [
        {
            "id": "template",
            "label": "Выбран один из двух шаблонов АЦР",
            "ok": brief["programKind"] != "unset",
        },
        {
            "id": "brief",
            "label": "Есть название и аудитория",
            "ok": bool(brief["title"].strip() and brief["audience"].strip()),
        },
        {
            "id": "duration",
            "label": "Задан объём программы",
            "ok": brief["durationHours"] > 0,
        },
        {
            "id": "competencies",
            "label": "У компетенций есть знания, умения и навыки",
            "ok": bool(nodes) and zun_ok,
        },
        {"id": "modules", "label": "Есть учебный план", "ok": bool(modules)},
        {
            "id": "hours",
            "label": f"Часы: {total:g} из {brief['durationHours']:g}",
            "ok": bool(modules)
            and brief["durationHours"] > 0
            and kinds_match
            and plan_match
            and abs(total - brief["durationHours"]) < 0.001,
        },
        {
            "id": "links",
            "label": "Каждая компетенция входит в модуль",
            "ok": bool(nodes) and not uncovered,
        },
        {
            "id": "known",
            "label": "Модули ссылаются только на существующие компетенции",
            "ok": bool(modules) and not unknown,
        },
    ]
