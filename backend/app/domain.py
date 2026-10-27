from __future__ import annotations

import json
import math
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any

from pydantic import ValidationError

from .legal_basis import merge_legal_basis
from .models import CourseDocument
from .rationale import result_passport

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


def academic_hours(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0
    return round(number * 2) / 2 if math.isfinite(number) and number > 0 else 0


def allocate_integer(
    target: float, weights: list[float], *, keep_zero: bool = True
) -> list[float]:
    if not weights:
        return []
    goal = academic_hours(target)
    units = round(goal * 2)
    if units <= 0:
        return [0] * len(weights)
    raw = [value if math.isfinite(value) and value > 0 else 0 for value in weights]
    usable = [
        (index, value)
        for index, value in enumerate(raw)
        if value > 0 or not keep_zero
    ]
    if not usable:
        each, remainder = divmod(units, len(raw))
        return [
            (each + (1 if index >= len(raw) - remainder else 0)) / 2
            for index in range(len(raw))
        ]
    total = sum(value for _, value in usable)
    exact = [(index, units * value / total) for index, value in usable]
    result = [0] * len(raw)
    for index, value in exact:
        result[index] = math.floor(value)
    remainder = units - sum(result)
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
    return [value / 2 for value in result]


def _kind_sum(value: dict[str, Any]) -> float:
    return sum(academic_hours(value.get(key, 0)) for key in KIND_KEYS)


def _spread_classroom(lecture: float, practice: float, hours: float) -> list[float]:
    """Лекции остаются объяснением. Из практики выделяются лабораторная и самостоятельная."""
    self_study = academic_hours(hours * 0.2)
    if self_study <= 0 and hours >= 2:
        self_study = 0.5
    hands = academic_hours(max(0, hours - self_study))
    share = lecture / (lecture + practice) if lecture + practice else 0.35
    lecture_hours = academic_hours(hands * share)
    pool = academic_hours(max(0, hands - lecture_hours))
    lab = academic_hours(pool / 2)
    practice_hours = academic_hours(max(0, pool - lab))
    drift = academic_hours(hours) - (lecture_hours + practice_hours + lab + self_study)
    if drift:
        practice_hours = academic_hours(max(0, practice_hours + drift))
    return [lecture_hours, practice_hours, lab, self_study]


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
    if weights[2] == 0 and weights[3] == 0 and (weights[0] > 0 or weights[1] > 0):
        weights = _spread_classroom(weights[0], weights[1], hours)
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
    modules: list[dict[str, Any]],
    duration_hours: float,
    attestation_hours: float,
) -> list[dict[str, Any]]:
    if not modules:
        return []

    filled = [_fill_plan(module) for module in modules]
    target = academic_hours(max(0, duration_hours - attestation_hours))

    # Индексы модулей с фиксированными часами.
    fixed_indices = [
        index
        for index, module in enumerate(filled)
        if module.get("fixedHours") is not None
    ]

    # Сумма фиксированных часов.
    fixed_total = sum(
        academic_hours(filled[index]["fixedHours"])
        for index in fixed_indices
    )

    if fixed_total > target:
        raise ValueError(
            f"Фиксированные часы модулей ({fixed_total}) "
            f"превышают доступный бюджет ({target})"
        )

    remaining = target - fixed_total

    # Модули, часы которых можно перераспределять.
    flexible_indices = [
        index
        for index in range(len(filled))
        if index not in fixed_indices
    ]

    if not flexible_indices and remaining > 0:
        raise ValueError(
            f"Все модули имеют фиксированные часы, "
            f"но осталось нераспределённых часов: {remaining}"
        )

    # Начинаем с фиксированных значений.
    hours = [0.0] * len(filled)

    for index in fixed_indices:
        hours[index] = academic_hours(filled[index]["fixedHours"])

    # Остаток распределяем по весам.
    if flexible_indices:
        weights = [
            float(
                filled[index].get("workloadWeight")
                or filled[index].get("hours")
                or 1
            )
            for index in flexible_indices
        ]

        allocated = allocate_integer(
            remaining,
            weights,
            keep_zero=False,
        )

        for index, allocated_hours in zip(flexible_indices, allocated):
            hours[index] = allocated_hours

    return [
        _fill_plan({**module, "hours": hours[index]})
        for index, module in enumerate(filled)
    ]


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
    _keep_sixteen_hour_practice(value)
    return CourseDocument.model_validate(value)

def _move_hours_to_practice(
    module: dict[str, Any],
    source_key: str,
    requested_hours: float,
) -> float:
    """Переносит часы в практику внутри модуля и его тематического плана."""
    remaining = academic_hours(requested_hours)
    moved = 0.0

    for row in module.get("plan") or []:
        if remaining <= 0:
            break

        available = academic_hours(row.get(source_key))
        take = min(available, remaining)

        if take <= 0:
            continue

        row[source_key] = academic_hours(available - take)
        row["practiceHours"] = academic_hours(
            float(row.get("practiceHours") or 0) + take
        )

        moved = academic_hours(moved + take)
        remaining = academic_hours(remaining - take)

    if moved > 0:
        module[source_key] = academic_hours(
            float(module.get(source_key) or 0) - moved
        )
        module["practiceHours"] = academic_hours(
            float(module.get("practiceHours") or 0) + moved
        )

    return moved

def _keep_sixteen_hour_practice(value: dict[str, Any]) -> None:
    """Общеразвивающая программа на 16 часов оставляет практике не меньше 8.

    Пересчёт забирает часть практики в лабораторные. Для школьного объёма
    эти часы возвращаются, пока практика снова не дотягивает до 8.
    """
    brief = value.get("brief") or {}
    if brief.get("programKind") != "general" or brief.get("durationHours") != 16:
        return
    modules = value.get("modules") or []
    need = academic_hours(8 - sum(float(module.get("practiceHours") or 0) for module in modules))
    if need <= 0:
        return
    for key in ("labHours", "selfStudyHours"):
        for module in modules:
            if need <= 0:
                return
            moved = _move_hours_to_practice(module, key, need)
            if moved <= 0:
                available = academic_hours(float(module.get(key) or 0))
                take = min(available, need)
                if take > 0:
                    module[key] = academic_hours(available - take)
                    module["practiceHours"] = academic_hours(float(module.get("practiceHours") or 0) + take)
                    _sync_topic_plan(module)
                    moved = take
            need = academic_hours(need - moved)


def _sync_topic_plan(module: dict[str, Any]) -> None:
    """План тем повторяет лекции, практику, лабораторные и самостоятельную работу."""
    topics = [
        str(row.get("title") or "").strip()
        for row in module.get("plan") or []
        if isinstance(row, dict) and str(row.get("title") or "").strip()
    ]
    if not topics:
        topics = [
            str(value).strip()
            for value in module.get("topics") or []
            if str(value).strip()
        ]
    if not topics:
        topics = [str(module.get("title") or "").strip() or "Модуль"]
    rows = [{"title": topic, **{key: 0 for key in KIND_KEYS}} for topic in topics]
    for key in KIND_KEYS:
        allocation = allocate_integer(
            academic_hours(module.get(key)),
            [1] * len(rows),
            keep_zero=False,
        )
        for index, value in enumerate(allocation):
            rows[index][key] = value
    module["plan"] = rows


def _upsert(items: list[dict[str, Any]], value: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        *(item for item in items if item.get("moduleId") != value.get("moduleId")),
        value,
    ]


def normalize_academic_hours(value: dict[str, Any]) -> None:
    brief = value.get("brief")
    if isinstance(brief, dict):
        for key in ("durationHours", "attestationHours"):
            if key in brief:
                brief[key] = academic_hours(brief[key])
    for module in value.get("modules") or []:
        if not isinstance(module, dict):
            continue
        if "hours" in module:
            module["hours"] = academic_hours(module.get("hours"))
        for key in KIND_KEYS:
            if key in module:
                module[key] = academic_hours(module.get(key))
        for row in module.get("plan") or []:
            if not isinstance(row, dict):
                continue
            for key in KIND_KEYS:
                if key in row:
                    row[key] = academic_hours(row.get(key))


def _merge_modules(existing: list[Any], incoming: list[Any]) -> list[Any]:
    """Новые id дописываются. Уже записанный id обновляется на месте, остальные модули остаются.

    Раньше любое пересечение id заменяло весь план. На длинной программе модель
    часто повторяет первый модуль во втором блоке — и уже написанные модули пропадали.
    """
    if not existing:
        return incoming
    if not incoming:
        return existing
    old_ids = {
        str(item.get("id"))
        for item in existing
        if isinstance(item, dict) and item.get("id")
    }
    replacements: dict[str, Any] = {}
    novel: list[Any] = []
    for item in incoming:
        module_id = str(item.get("id")) if isinstance(item, dict) and item.get("id") else ""
        if module_id and module_id in old_ids:
            replacements[module_id] = item
        else:
            novel.append(item)
    if not replacements:
        return [*existing, *incoming]
    merged = []

    for item in existing:
        if not isinstance(item, dict):
            merged.append(item)
            continue

        module_id = str(item.get("id"))
        replacement = replacements.get(module_id)

        if replacement is None:
            merged.append(item)
            continue

        updated = dict(replacement)

        # Если новый вес не указан, сохраняем предыдущий.
        if updated.get("workloadWeight") is None:
            updated["workloadWeight"] = item.get("workloadWeight")

        merged.append(updated)

    return [*merged, *novel]


PATCH_RANK = {
    "update_brief": 0,
    "set_competency_map": 1,
    "set_structure": 2,
    "set_lecture": 3,
    "set_seminar": 3,
    "set_assessment": 3,
    "revise_section": 4,
}


def apply_patches(course: CourseDocument, patches: list[dict[str, Any]]) -> CourseDocument:
    ordered = sorted(patches, key=lambda item: PATCH_RANK.get(str(item.get("type")), 9))
    next_course = course
    for patch in ordered:
        next_course = apply_patch(next_course, patch)
    return next_course


def _merge_hour_constraints(
    existing: list[dict[str, Any]],
    incoming: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Объединяет ограничения часов, сохраняя существующие."""

    merged = [dict(item) for item in existing]

    for new_item in incoming:
        key = (
            new_item.get("field"),
            new_item.get("operator"),
            new_item.get("source"),
        )

        for index, old_item in enumerate(merged):
            old_key = (
                old_item.get("field"),
                old_item.get("operator"),
                old_item.get("source"),
            )

            if old_key == key:
                merged[index] = dict(new_item)
                break
        else:
            merged.append(dict(new_item))

    return merged


def apply_patch(course: CourseDocument, patch: dict[str, Any]) -> CourseDocument:
    if patch.get("type") not in PATCH_TYPES:
        return course
    value = course.as_api()
    patch_type = patch["type"]
    try:
        if patch_type == "update_brief":
            brief_update = dict(patch.get("brief") or {})

            if "hourConstraints" in brief_update:
                brief_update["hourConstraints"] = _merge_hour_constraints(
                    value["brief"].get("hourConstraints") or [],
                    brief_update["hourConstraints"] or [],
                )
            value["brief"].update(brief_update)
        elif patch_type == "set_competency_map":
            value["competencies"] = patch["competencies"]
        elif patch_type == "set_structure":
            value["modules"] = _merge_modules(value.get("modules") or [], patch.get("modules") or [])
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
        normalize_academic_hours(value)
        brief = value.get("brief")
        if isinstance(brief, dict):
            merge_legal_basis(brief)
        return rebalance_course(CourseDocument.model_validate(value))
    except (KeyError, TypeError, ValidationError):
        return course


def _json_number(value: Any) -> int | float:
    number = float(value or 0)
    if number.is_integer():
        return int(number)
    return number


def framework_fingerprint(course: CourseDocument) -> str:
    value = course.as_api()
    brief = value["brief"]
    return json.dumps(
        {
            "hours": _json_number(brief["durationHours"]),
            "programKind": brief["programKind"],
            "attestationHours": _json_number(brief["attestationHours"]),
            "modules": [
                {
                    "id": module["id"],
                    "hours": _json_number(module["hours"]),
                    "lectureHours": _json_number(module["lectureHours"]),
                    "practiceHours": _json_number(module["practiceHours"]),
                    "labHours": _json_number(module["labHours"]),
                    "selfStudyHours": _json_number(module["selfStudyHours"]),
                    "competencyIds": sorted(module.get("competencyIds") or []),
                }
                for module in value["modules"]
            ],
            "nodes": [
                {"id": node["id"], "moduleIds": sorted(node.get("moduleIds") or [])}
                for node in value["competencies"]["nodes"]
            ],
            "passport": result_passport(value),
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
