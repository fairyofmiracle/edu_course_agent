from __future__ import annotations

import math
from typing import Any

from .claims import invented_requisites, labor_codes
from .domain import framework_items
from .legal_basis import is_official_publication, legal_basis_items
from .models import CourseDocument
from .outdated import find_outdated
from .rationale import module_rationales
from .verbatim import reference_notes, verbatim_spans

KIND_FIELDS = ("lectureHours", "practiceHours", "labHours", "selfStudyHours")


def _audit_item(
    item_id: str,
    label: str,
    ok: bool,
    section: str,
    details: str | None = None,
    status: str | None = None,
) -> dict[str, Any]:
    item = {
        "id": item_id,
        "label": label,
        "status": status or ("pass" if ok else "fail"),
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
        needs_lecture = _number(module.get("lectureHours")) > 0
        has_lecture = any(row.get("moduleId") == module_id for row in lectures)
        has_seminar = any(row.get("moduleId") == module_id for row in seminars)
        has_assessment = any(row.get("moduleId") == module_id for row in assessments)
        missing = [
            part
            for part, present in (
                ("нет лекции", has_lecture or not needs_lecture),
                ("нет задания", has_seminar),
                ("нет теста", has_assessment),
            )
            if not present
        ]
        complete = not missing
        partial = has_lecture or has_seminar or has_assessment
        items.append(
            _audit_item(
                f"content.{module_id}",
                f"{module.get('title') or module_id}: лекция, задание и тест",
                complete,
                "content",
                ", ".join(missing) if missing else None,
                status="pass" if complete else "warning" if partial else "fail",
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


    # Учебно-тематический план: сумма тем = видам часов модуля
    for module in modules:
        module_id = str(module.get("id") or "module")
        plan = module.get("plan") or []
        if not plan:
            items.append(
                _audit_item(
                    f"plan.{module_id}.missing",
                    f"{module.get('title') or module_id}: есть учебно-тематический план",
                    False,
                    "framework",
                    "нет строк плана тем",
                    status="warning",
                )
            )
            continue
        for field, label in (
            ("lectureHours", "ЛК"),
            ("practiceHours", "ПР"),
            ("labHours", "ЛБ"),
            ("selfStudyHours", "СРС"),
        ):
            planned = sum(_number(row.get(field)) for row in plan if isinstance(row, dict))
            target = _number(module.get(field))
            ok = abs(planned - target) < 0.001
            items.append(
                _audit_item(
                    f"plan.{module_id}.{field}",
                    f"{module.get('title') or module_id}: сумма тем по {label} = {planned:g} из {target:g}",
                    ok,
                    "framework",
                    None if ok else f"темы {planned:g}, модуль {target:g}",
                )
            )

    # Карта компетенций: ЗУН и связь с модулями / проверкой
    for node in competencies:
        node_id = str(node.get("id") or "comp")
        name = str(node.get("name") or node_id)
        has_zun = bool(node.get("knowledge")) and bool(node.get("skills")) and bool(
            node.get("abilities")
        )
        items.append(
            _audit_item(
                f"competency.{node_id}.zun",
                f"Компетенция «{name}»: знания, умения и навыки",
                has_zun,
                "framework",
                None
                if has_zun
                else "не хватает "
                + ", ".join(
                    part
                    for part, present in (
                        ("знаний", bool(node.get("knowledge"))),
                        ("умений", bool(node.get("skills"))),
                        ("навыков", bool(node.get("abilities"))),
                    )
                    if not present
                ),
            )
        )
        module_ids = {str(value) for value in (node.get("moduleIds") or []) if value}
        if not module_ids:
            # fallback: modules pointing to this competency
            module_ids = {
                str(module.get("id") or "")
                for module in modules
                if node_id in {str(x) for x in (module.get("competencyIds") or [])}
            }
        items.append(
            _audit_item(
                f"competency.{node_id}.modules",
                f"Компетенция «{name}» связана с темами/модулями",
                bool(module_ids),
                "framework",
                None if module_ids else "нет moduleIds",
            )
        )
        # at least one question or task references this competency or its module outcomes
        linked_assess = False
        for assessment in assessments:
            if str(assessment.get("moduleId") or "") in module_ids:
                linked_assess = True
                break
            for question in assessment.get("questions") or []:
                if str(question.get("competencyId") or "") == node_id:
                    linked_assess = True
                    break
        linked_task = False
        for seminar in seminars:
            if str(seminar.get("moduleId") or "") in module_ids:
                linked_task = True
                break
            for task in seminar.get("tasks") or []:
                if str(task.get("competencyId") or "") == node_id:
                    linked_task = True
                    break
        covered = linked_assess and linked_task
        items.append(
            _audit_item(
                f"competency.{node_id}.assessment",
                f"Компетенция «{name}» покрыта вопросом и заданием",
                covered,
                "content",
                None
                if covered
                else "не хватает: "
                + " и ".join(
                    part
                    for part, present in (
                        ("тест", linked_assess),
                        ("задание", linked_task),
                    )
                    if not present
                ),
                status="pass" if covered else "warning",
            )
        )

    outdated = find_outdated(course)
    if modules and not outdated:
        items.append(
            _audit_item(
                "freshness.clear",
                "В темах нет инструментов из списка снятых с поддержки",
                True,
                "freshness",
            )
        )
    for hit in outdated:
        items.append(
            {
                "id": f"freshness.{hit['id']}.{len(items)}",
                "label": f"Устаревший инструмент: {hit['label']}",
                "status": "warning",
                "section": "freshness",
                "details": hit["place"],
            }
        )

    items.extend(legal_basis_items(course))
    for row in module_rationales(course):
        items.append(
            {
                "id": f"framework.why.{row['id']}",
                "label": "Модуль обоснован часами и результатами",
                "status": "pass",
                "section": "framework",
                "details": row["text"],
            }
        )
    items.append(
        {
            "id": "framework.passport",
            "label": "Паспорт результата считает код, формулировки модели в него не входят",
            "status": "pass",
            "section": "framework",
            "details": "Считает вид программы, часы и состав модулей. Текст лекции в этот расчёт не входит.",
        }
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

    http_titles = [
        str(reference.get("title") or "Источник")
        for reference in references
        if isinstance(reference, dict)
        and (
            not str(reference.get("source") or "").strip()
            or (
                str(reference.get("source") or "").strip().lower().startswith(("http://", "https://"))
                and not is_official_publication(str(reference.get("source") or ""))
            )
        )
    ]
    if references:
        items.append(
            {
                "id": "sources.unconfirmed",
                "label": (
                    f"Не подтверждено источников: {len(http_titles)}"
                    if http_titles
                    else "У каждого источника есть файл или официальная публикация"
                ),
                "status": "warning" if http_titles else "pass",
                "section": "sources",
                "details": (
                    "Чужая ссылка не подтверждает документ, пока на странице не найден номер. "
                    + "; ".join(http_titles)
                    if http_titles
                    else "Пустых ссылок нет."
                ),
            }
        )

    notes = reference_notes(course)
    copies = verbatim_spans(course)
    if references and len(notes.split()) < 12:
        items.append(
            {
                "id": "sources.verbatim",
                "label": "Дословное копирование не с чем сравнить: в референсе нет связного текста",
                "status": "warning",
                "section": "sources",
            }
        )
    elif references and copies:
        items.append(
            {
                "id": "sources.verbatim",
                "label": "В комплекте есть дословный фрагмент референса",
                "status": "fail",
                "section": "sources",
                "details": copies[0],
            }
        )
    elif references:
        items.append(
            {
                "id": "sources.verbatim",
                "label": "Дословных фрагментов референса в комплекте нет",
                "status": "pass",
                "section": "sources",
            }
        )

    codes = labor_codes(course)
    invented = invented_requisites(course)
    if codes:
        grounded = [code for code in codes if code not in invented]
        items.append(
            {
                "id": "sources.codes",
                "label": (
                    "Код трудовой функции есть в тексте методиста"
                    if codes and not any(code in invented for code in codes)
                    else "Код трудовой функции не найден в источниках методиста"
                ),
                "status": "pass" if grounded and len(grounded) == len(codes) else "fail",
                "section": "sources",
                "details": ", ".join(codes),
            }
        )
    items.append(
        {
            "id": "sources.requisites",
            "label": (
                "Выдуманных номеров и кодов в комплекте нет"
                if not invented
                else "В комплекте есть реквизит, которого нет у методиста"
            ),
            "status": "pass" if not invented else "fail",
            "section": "sources",
            "details": ", ".join(invented) if invented else "Номер приказа и код трудовой функции сверяются с файлом и условиями запроса.",
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
