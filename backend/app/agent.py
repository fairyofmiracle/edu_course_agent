from __future__ import annotations

import json
from typing import Any

from .cloud import CloudRuClient
from .domain import apply_patch, framework_fingerprint, framework_items
from .catalog import (
    default_structure,
    extra_references,
    flatten_internship_hours,
    is_cyber,
    is_incomplete_brief,
    is_internship,
    lecture_modules,
    profile_name,
    promise_notes,
)
from .kit_content import (
    STUB_BULLET,
    PEDAGOGUE_STANDARD,
    attestation_form,
    cover_learning_outcomes,
    default_competencies,
    document_constraints,
    ensure_risk_topic,
    has_stub_competencies,
    has_stub_questions,
    is_intro_python,
    is_teacher_ai,
    project_module,
    relink_modules,
)
from .models import CourseDocument, empty_course
from .planner import (
    KIT_TOOLS,
    content_missing,
    decide_mode,
    intake_questions,
    is_framework_approved,
    kit_needed,
    kit_lecture_target,
    missing_brief_lines,
    plan_step,
)
from .reference_outline import (
    apply_file_labor_codes,
    apply_reference_hints,
    compact_reference,
)
from .tools import course_tools, execute_tool

MAX_STEPS = 12
REF_LIMIT = 3500
USER_LIMIT = 1800

SYSTEM_PROMPT = """Ты методист. Документ меняй только JSON-инструментом.
Часы и тип программы — только из слов методиста. «Месяц» — срок, не объём.
Аттестация входит в общий объём. Часы академические, шаг 0,5.
Нормативы студия подставит сама — номера приказов не выдумывай.
Лекции и тесты — только после утверждения каркаса. Сделай ровно текущий шаг."""


def clip_text(value: str | None, limit: int) -> str:
    text = (value or "").strip()
    if len(text) <= limit:
        return text
    clipped = text[:limit].rsplit("\n", 1)[0].strip()
    return f"{clipped}\n[...]"


def clip_references(value: str | None, limit: int = REF_LIMIT) -> str:
    return compact_reference(value, limit)


def course_snapshot(course: CourseDocument, step: dict[str, Any]) -> dict[str, Any]:
    value = course.as_api()
    brief = value["brief"]
    compact_brief = {
        "title": brief.get("title") or "",
        "audience": brief.get("audience") or "",
        "durationHours": brief.get("durationHours") or 0,
        "programKind": brief.get("programKind") or "unset",
        "attestationForm": brief.get("attestationForm") or "",
        "attestationHours": brief.get("attestationHours") or 0,
        "goals": (brief.get("goals") or [])[:4],
    }
    tool = step.get("tool")
    module_id = step.get("moduleId")
    if tool == "update_brief" or (step.get("kind") == "reply" and not value["modules"]):
        return {"brief": compact_brief}
    nodes = [
        {
            "id": node["id"],
            "name": node["name"],
            "knowledge": (node.get("knowledge") or [])[:2],
            "skills": (node.get("skills") or [])[:2],
        }
        for node in (value.get("competencies") or {}).get("nodes") or []
    ][:6]
    modules = [
        {
            "id": module["id"],
            "title": module["title"],
            "hours": module["hours"],
            "practiceHours": module.get("practiceHours") or 0,
        }
        for module in value["modules"]
    ]
    if tool == "set_competency_map":
        return {"brief": compact_brief, "competencies": nodes}
    if tool == "set_structure":
        return {"brief": compact_brief, "competencies": nodes, "modules": modules}
    if tool in {"set_lecture", "set_seminar", "set_assessment"}:
        module = next((item for item in value["modules"] if item["id"] == module_id), None)
        return {
            "durationHours": compact_brief["durationHours"],
            "need": tool,
            "module": (
                {
                    "id": module["id"],
                    "title": module["title"],
                    "hours": module["hours"],
                    "topics": (module.get("topics") or [])[:5],
                    "learningOutcomes": (module.get("learningOutcomes") or [])[:3],
                }
                if module
                else None
            ),
        }
    return {"brief": compact_brief, "modules": [item["id"] for item in modules]}


def build_system_prompt(
    course: CourseDocument,
    step: dict[str, Any],
    references: str | None = None,
) -> str:
    tool = step.get("tool")
    ref_limit = REF_LIMIT if tool == "set_structure" else 900
    refs = clip_references(references, ref_limit)
    return "\n".join(
        filter(
            None,
            [
                SYSTEM_PROMPT,
                json.dumps(course_snapshot(course, step), ensure_ascii=False),
                f"Образец оформления, не копируй тему и часы:\n{refs}" if refs else "",
                f"Шаг: {step['task']}",
            ],
        )
    )


def messages_for_model(user_texts: list[str]) -> list[dict[str, Any]]:
    parts = [text.strip() for text in user_texts if text.strip()][-2:]
    return [{"role": "user", "content": clip_text("\n\n".join(parts), USER_LIMIT)}]


def tools_for_step(step: dict[str, Any]) -> list[dict[str, Any]]:
    tools = course_tools()
    name = step.get("tool")
    if step.get("kind") == "tool" and name:
        selected = [item for item in tools if ((item.get("function") or {}).get("name") == name)]
        return selected or tools
    return tools


def max_tokens_for_step(step: dict[str, Any]) -> int:
    tool = step.get("tool")
    if step.get("kind") == "reply":
        return 220
    if tool == "update_brief":
        return 280
    if tool == "set_competency_map":
        return 500
    if tool == "set_structure":
        return 1600
    if tool == "set_assessment":
        return 1100
    if tool == "set_lecture":
        return 450
    return 400


def _tool_choice(step: dict[str, Any]) -> str | dict[str, Any]:
    if step["kind"] == "tool":
        return {
            "type": "function",
            "function": {"name": step["tool"]},
        }
    return "none"


async def run_turn(
    course: CourseDocument,
    *,
    user_texts: list[str],
    model_messages: list[dict[str, Any]],
    references: str | None = None,
    form_brief: dict[str, Any] | None = None,
    client: CloudRuClient | None = None,
) -> dict[str, Any]:
    client = client or CloudRuClient()
    mode = decide_mode(course, user_texts[-1] if user_texts else "")
    if is_framework_approved(course) and kit_needed(course) and not getattr(client, "api_key", None):
        course = fill_missing_kit(course, references, user_texts)
        return {
            "course": course,
            "assistant": "Собрала комплект по каркасу: тест, слайды и семинар.",
            "mode": "kit",
            "steps": ["fill_missing_kit"],
            "patches": [],
            "calls": [],
            "modelMessages": model_messages,
            "usage": getattr(client, "usage", None),
        }
    if is_framework_approved(course) and kit_needed(course):
        mode = "kit"
    planned: list[str] = []
    patches: list[dict[str, Any]] = []
    calls: list[dict[str, Any]] = []
    assistant_text = ""
    outgoing = messages_for_model(user_texts)

    for _ in range(MAX_STEPS):
        if hasattr(client, "budget_left") and not client.budget_left():
            if not assistant_text:
                assistant_text = "Остановилась: лимит токенов на задачу."
            break
        step = plan_step(mode, course, planned, len(user_texts))
        key = (
            f"{step['tool']}:{step['moduleId']}"
            if step["kind"] == "tool" and step.get("moduleId")
            else step.get("tool", step["kind"])
        )
        planned.append(key)
        if step.get("tool") == "update_brief":
            output = execute_tool("update_brief", {}, course, user_texts, form_brief)
            calls.append({"tool": "update_brief", "input": output.get("brief")})
            if output.get("type") != "tool_error":
                next_course = apply_patch(course, output)
                if next_course != course:
                    course = next_course
                    patches.append(output)
            if references:
                course = apply_reference_hints(course, references, user_texts)
            continue
        if step.get("kind") == "reply":
            if missing_brief_lines(course):
                assistant_text = intake_questions(course)
            else:
                assistant_text = str(step.get("task") or "Каркас готов. Проверьте часы и утвердите.")
                notes = promise_notes(course)
                if notes:
                    assistant_text = assistant_text + "\n\n" + "\n".join(notes)
            break
        if step.get("tool") == "set_competency_map" and (
            not getattr(client, "api_key", None) or profile_name(course) != "generic"
        ):
            output = execute_tool(
                "set_competency_map",
                {"nodes": default_competencies(course)},
                course,
                user_texts,
                form_brief,
            )
            calls.append({"tool": "set_competency_map", "input": output.get("competencies")})
            if output.get("type") != "tool_error":
                next_course = apply_patch(course, output)
                if next_course != course:
                    course = next_course
                    patches.append(output)
            continue
        use_fast = step.get("kind") == "reply"
        try:
            message = await client.complete(
                system=build_system_prompt(course, step, references),
                messages=outgoing,
                tools=tools_for_step(step),
                tool_choice=_tool_choice(step),
                max_tokens=max_tokens_for_step(step),
                model=(
                    getattr(client, "model_fast", None)
                    if use_fast
                    else getattr(client, "model_writer", None)
                ),
            )
        except Exception:
            if step.get("tool") in KIT_TOOLS:
                output = execute_tool(
                    str(step["tool"]),
                    {},
                    course,
                    user_texts,
                    form_brief,
                    module_id=step.get("moduleId"),
                )
                calls.append({"tool": step["tool"], "input": "local_fallback"})
                if output.get("type") != "tool_error":
                    course = apply_patch(course, output)
                    patches.append(output)
                continue
            if step.get("tool") == "set_competency_map":
                output = execute_tool(
                    "set_competency_map",
                    {"nodes": default_competencies(course)},
                    course,
                    user_texts,
                    form_brief,
                )
                calls.append({"tool": "set_competency_map", "input": "local_fallback"})
                if output.get("type") != "tool_error":
                    course = apply_patch(course, output)
                    patches.append(output)
                continue
            if step.get("tool") == "set_structure":
                modules = default_structure(course)
                if modules:
                    output = execute_tool(
                        "set_structure",
                        {"modules": modules},
                        course,
                        user_texts,
                        form_brief,
                    )
                    calls.append({"tool": "set_structure", "input": "local_fallback"})
                    if output.get("type") != "tool_error":
                        course = apply_patch(course, output)
                        patches.append(output)
                continue
            raise
        tool_calls = (message.get("tool_calls") or [])[:1]
        model_messages.append(message)
        content = message.get("content")
        if isinstance(content, str) and content.strip():
            assistant_text = content.strip()
            if not tool_calls:
                if step.get("tool") == "set_structure":
                    modules = default_structure(course)
                    if modules:
                        output = execute_tool(
                            "set_structure",
                            {"modules": modules},
                            course,
                            user_texts,
                            form_brief,
                        )
                        if output.get("type") != "tool_error":
                            next_course = apply_patch(course, output)
                            if next_course != course:
                                course = next_course
                                patches.append(output)
                                calls.append({"tool": "set_structure", "input": "local_fallback"})
                if step.get("tool") == "set_competency_map":
                    output = execute_tool(
                        "set_competency_map",
                        {"nodes": default_competencies(course)},
                        course,
                        user_texts,
                        form_brief,
                    )
                    if output.get("type") != "tool_error":
                        next_course = apply_patch(course, output)
                        if next_course != course:
                            course = next_course
                            patches.append(output)
                            calls.append({"tool": "set_competency_map", "input": "local_fallback"})
                if step["kind"] in {"reply", "auto"}:
                    break
                continue

        call = tool_calls[0]
        function = call.get("function") or {}
        name = str(function.get("name") or "")
        if step.get("kind") == "tool" and step.get("tool"):
            name = str(step["tool"])
        raw_arguments = function.get("arguments") or "{}"
        try:
            arguments = (
                json.loads(raw_arguments)
                if isinstance(raw_arguments, str)
                else raw_arguments
            )
        except json.JSONDecodeError:
            arguments = {}
        output = execute_tool(
            name,
            arguments,
            course,
            user_texts,
            form_brief,
            module_id=step.get("moduleId"),
        )
        calls.append({"tool": name, "input": arguments})
        if output.get("type") != "tool_error":
            next_course = apply_patch(course, output)
            if next_course != course:
                course = next_course
                patches.append(output)
        if name == "set_structure" and not course.modules:
            modules = default_structure(course)
            if modules:
                fallback = execute_tool(
                    "set_structure",
                    {"modules": modules},
                    course,
                    user_texts,
                    form_brief,
                )
                if fallback.get("type") != "tool_error":
                    course = apply_patch(course, fallback)
                    patches.append(fallback)
                    calls.append({"tool": "set_structure", "input": "local_fallback"})
        model_messages.append({"role": "user", "content": f"ok {name}"})
        if planned.count("reply") >= 2:
            break

    if is_framework_approved(course) and kit_needed(course):
        course = fill_missing_kit(course, references, user_texts)
        planned.append("fill_missing_kit")
    if is_framework_approved(course) and not assistant_text:
        assistant_text = "Собрала комплект по каркасу: тест, слайды и семинар."

    return {
        "course": course,
        "assistant": assistant_text,
        "mode": mode,
        "steps": planned,
        "patches": patches,
        "calls": calls,
        "modelMessages": model_messages,
        "usage": getattr(client, "usage", None),
    }


def strengthen_framework(course: CourseDocument) -> CourseDocument:
    if is_incomplete_brief(course):
        return course
    if is_internship(course) and course.brief.attestation_hours <= 0:
        output = execute_tool(
            "update_brief",
            {
                "attestationHours": 2,
                "attestationForm": course.brief.attestation_form
                or "Защита отчёта о стажировке",
            },
            course,
            ["итоговая аттестация занимает 2 часа"],
        )
        if output.get("type") != "tool_error":
            course = apply_patch(course, output)
    if not course.modules and not is_incomplete_brief(course):
        modules = default_structure(course)
        if modules:
            output = execute_tool("set_structure", {"modules": modules}, course, [])
            if output.get("type") != "tool_error":
                course = apply_patch(course, output)
    course = flatten_internship_hours(course)
    if has_stub_competencies(course):
        nodes = default_competencies(course)
        output = execute_tool("set_competency_map", {"nodes": nodes}, course, [])
        if output.get("type") != "tool_error":
            course = apply_patch(course, output)
        structure = execute_tool(
            "set_structure",
            {"modules": relink_modules(course, [node["id"] for node in nodes])},
            course,
            [],
        )
        if structure.get("type") != "tool_error":
            course = apply_patch(course, structure)
    form = attestation_form(course)
    if form and form != course.brief.attestation_form:
        output = execute_tool("update_brief", {"attestationForm": form}, course, [form])
        if output.get("type") != "tool_error":
            course = apply_patch(course, output)
    if is_teacher_ai(course):
        defaults = default_competencies(course)
        nodes = [node.model_dump(by_alias=True) for node in course.competencies.nodes]
        if nodes and any(not str(node.get("laborFunctionCode") or "").strip() for node in nodes):
            for index, node in enumerate(nodes):
                if not str(node.get("laborFunctionCode") or "").strip() and index < len(defaults):
                    node["laborFunctionCode"] = defaults[index].get("laborFunctionCode")
            mapped = execute_tool("set_competency_map", {"nodes": nodes}, course, [])
            if mapped.get("type") != "tool_error":
                course = apply_patch(course, mapped)
        value = course.as_api()
        brief = value["brief"]
        brief["format"] = "blended"
        audience = str(brief.get("audience") or "").strip()
        if audience and "программ" not in audience.lower():
            brief["audience"] = f"{audience}, без навыков программирования"
        format_line = "Очно-заочно: очная часть — аудитория, дистанционная — ЭО и ДОТ."
        brief["constraints"] = list(
            dict.fromkeys([format_line, *document_constraints(course)])
        )[:12]
        references = brief.get("references") or []
        if not any("544н" in str(item.get("title") or "") for item in references):
            references.append(PEDAGOGUE_STANDARD)
        brief["references"] = references[:20]
        value["modules"] = ensure_risk_topic(value["modules"])
        course = CourseDocument.model_validate(value)
    if is_intro_python(course) or is_cyber(course):
        value = course.as_api()
        value["brief"]["level"] = "beginner"
        course = CourseDocument.model_validate(value)
    extras_refs = extra_references(course)
    if extras_refs:
        value = course.as_api()
        references = value["brief"].get("references") or []
        for item in extras_refs:
            if not any(item["title"] == str(ref.get("title") or "") for ref in references):
                references.append(item)
        value["brief"]["references"] = references[:20]
        course = CourseDocument.model_validate(value)
    extras = document_constraints(course)
    if extras:
        value = course.as_api()
        value["brief"]["constraints"] = list(
            dict.fromkeys([*(value["brief"].get("constraints") or []), *extras])
        )[:12]
        course = CourseDocument.model_validate(value)
    return course


def _lecture_is_stub(course: CourseDocument, module_id: str) -> bool:
    lecture = next((item for item in course.lectures if item.module_id == module_id), None)
    if lecture is None:
        return True
    return any(STUB_BULLET.search(" ".join(slide.bullets)) for slide in lecture.slides)


def fill_missing_kit(
    course: CourseDocument,
    references: str | None = None,
    user_texts: list[str] | None = None,
) -> CourseDocument:
    course = apply_reference_hints(course, references, user_texts)
    course = strengthen_framework(course)
    course = apply_file_labor_codes(course, references)
    if all(item["ok"] for item in framework_items(course)):
        course = approve_framework(course)
    if not is_framework_approved(course):
        return course
    if has_stub_questions(course):
        target = (
            course.assessments[0].module_id
            if course.assessments
            else (course.modules[-1].id if course.modules else None)
        )
        output = execute_tool("set_assessment", {}, course, [], module_id=target)
        if output.get("type") != "tool_error":
            course = apply_patch(course, output)
    for module in lecture_modules(course, kit_lecture_target(course)):
        if not _lecture_is_stub(course, module.id):
            continue
        output = execute_tool("set_lecture", {}, course, [], module_id=module.id)
        if output.get("type") != "tool_error":
            course = apply_patch(course, output)
    if not course.seminars:
        module = project_module(course)
        output = execute_tool(
            "set_seminar",
            {},
            course,
            [],
            module_id=module.id if module else None,
        )
        if output.get("type") != "tool_error":
            course = apply_patch(course, output)
    return cover_learning_outcomes(course)


def assemble_local_course(
    texts: list[str],
    extra_brief: dict[str, Any] | None = None,
    references: str | None = None,
) -> CourseDocument:
    course = empty_course()
    output = execute_tool("update_brief", dict(extra_brief or {}), course, texts)
    if output.get("type") != "tool_error":
        course = apply_patch(course, output)
    return fill_missing_kit(course, references, texts)


def approve_framework(course: CourseDocument) -> CourseDocument:
    value = course.as_api()
    value["frameworkApproved"] = True
    value["frameworkFingerprint"] = framework_fingerprint(course)
    return CourseDocument.model_validate(value)


def course_report(course: CourseDocument, *, asked_questions: bool) -> dict[str, Any]:
    value = course.as_api()
    assessed_competencies = {
        question["competencyId"]
        for assessment in value["assessments"]
        for question in assessment["questions"]
    }
    assessed_outcomes = {
        question.get("learningOutcome", "").strip()
        for assessment in value["assessments"]
        for question in assessment["questions"]
    }
    assessed_outcomes.discard("")
    return {
        "checks": framework_items(course),
        "competenciesWithoutQuestion": [
            node["id"]
            for node in value["competencies"]["nodes"]
            if node["id"] not in assessed_competencies
        ],
        "outcomesWithoutQuestion": [
            outcome
            for module in value["modules"]
            for outcome in module["learningOutcomes"]
            if outcome not in assessed_outcomes
        ],
        "modulesWithoutKit": list(
            dict.fromkeys(gap["module"]["id"] for gap in content_missing(course))
        ),
        "askedQuestions": asked_questions,
        "promiseNotes": promise_notes(course),
    }
