from __future__ import annotations

import json
import time
from typing import Any

from .brief_guard import contains_profanity, is_offtopic_request, PROFANITY_REPLY, repair_typos, volume_from_text
from .cloud import CloudRuClient, TurnStopped
from .domain import apply_patch, framework_fingerprint, framework_items, rebalance_course
from .catalog import (
    default_structure,
    extra_references,
    flatten_internship_hours,
    is_cyber,
    is_incomplete_brief,
    is_internship,
    lecture_modules,
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
    is_duration_edit_request,
    spoken_reply,
    is_framework_approved,
    kit_needed,
    kit_request_ready,
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
KIT_BUDGET_SECONDS = 200
KIT_CALL_TIMEOUT = 70
REF_LIMIT = 3500

SYSTEM_PROMPT = """Ты методист. Документ меняй только JSON-инструментом.
Часы и тип программы — только из слов методиста. «Месяц» — срок, не объём.
Аттестация входит в общий объём. Часы академические, шаг 0,5.
Нормативы студия подставит сама — номера приказов не выдумывай.
Лекции и тесты — только после утверждения каркаса. Текст лекции, задания и теста пишешь ты, по этой теме и этой аудитории. Сделай ровно текущий шаг."""

async def extract_brief_arguments(
    client: CloudRuClient,
    course: CourseDocument,
    user_texts: list[str],
) -> dict[str, Any]:
    step = {
        "kind": "tool",
        "tool": "update_brief",
        "task": (
            "Ты анализируешь запрос методиста на разработку образовательной "
            "программы по IT-направлению. Тематика может включать любые "
            "информационные технологии, языки программирования, инфраструктуру, "
            "данные, безопасность и смежные IT-дисциплины. "
            "Извлеки только явно указанные или однозначно следующие из "
            "контекста параметры курса. "
            "Не придумывай общий объём часов, тип программы, "
            "форму аттестации и другие неизвестные сведения. "
            "Не путай расписание занятий с общим объёмом программы. "
            "Не путай способ проведения занятий (очно, дистанционно) "
            "с педагогическим форматом (лекции, практика, смешанный). "
            "Если параметр не указан, не включай его в JSON. "
            "Учитывай исправления в последних сообщениях."
        ),
    }

    message = await client.complete(
        system=build_system_prompt(course, step),
        messages=messages_for_model(user_texts),
        tools=tools_for_step(step),
        tool_choice=_tool_choice(step),
        max_tokens=600,
        model=getattr(client, "model_writer", None) or getattr(client, "model", None),
        timeout=60,
        attempts=1,
    )

    calls = message.get("tool_calls") or []
    if not calls:
        return {}

    function = calls[0].get("function") or {}

    if function.get("name") != "update_brief":
        return {}
    arguments = function.get("arguments") or "{}"

    if isinstance(arguments, str):
        arguments = json.loads(arguments)

    return arguments if isinstance(arguments, dict) else {}

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
    parts = [text.strip() for text in user_texts if text.strip()][-8:]
    body = "\n\n".join(parts)
    if len(body) <= 6000:
        return [{"role": "user", "content": body}]
    return [{"role": "user", "content": f"[...]\n{body[-6000:]}"}]


def tools_for_step(step: dict[str, Any]) -> list[dict[str, Any]]:
    tools = course_tools()
    name = step.get("tool")
    if step.get("kind") == "tool" and name:
        selected = [item for item in tools if ((item.get("function") or {}).get("name") == name)]
        return selected or tools
    allowed = step.get("tools")
    if step.get("kind") == "auto" and isinstance(allowed, list) and allowed:
        names = {str(item) for item in allowed}
        selected = [
            item
            for item in tools
            if ((item.get("function") or {}).get("name") in names)
        ]
        return selected or tools
    return tools


def max_tokens_for_step(step: dict[str, Any]) -> int:
    tool = step.get("tool")
    if step.get("kind") == "reply":
        return 220
    if step.get("kind") == "auto":
        return 1200
    if tool == "update_brief":
        return 280
    if tool == "set_competency_map":
        return 500
    if tool == "set_structure":
        return 3200
    if tool == "set_assessment":
        return 2400
    if tool == "set_lecture":
        return 2400
    return 400


def _tool_choice(step: dict[str, Any]) -> str | dict[str, Any]:
    if step["kind"] == "tool":
        return {
            "type": "function",
            "function": {"name": step["tool"]},
        }
    if step["kind"] == "auto":
        return "auto"
    return "none"


def kit_assistant_text(client: Any, calls: list[dict[str, Any]], planned: list[str]) -> str:
    has_key = bool(getattr(client, "api_key", None))
    model_wrote = any(
        call.get("tool") in KIT_TOOLS and call.get("input") != "local_fallback"
        for call in calls
    )
    local = "fill_missing_kit" in planned or any(
        call.get("input") in {"local_fallback", "mixed"} for call in calls
    )
    if not has_key:
        return "Ключа шлюза нет. Комплект дописан по каркасу: тест, слайды и семинар."
    if local and not model_wrote:
        return "Шлюз не ответил. Комплект дописан по каркасу, чтобы программа не осталась пустой."
    if local and model_wrote:
        return (
            "Учебный комплект подготовлен частично с помощью ИИ. "
            "Некоторые материалы дополнены по шаблону и требуют проверки. "
            "Просмотрите лекции, практические задания и тесты перед выгрузкой."
            )
    return (
        "Комплект написала модель: тест, слайды и задания по этой теме. "
    )


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
    if hasattr(client, "begin_turn"):
        client.begin_turn()
    user_texts = [repair_typos(text) for text in user_texts]
    last_text = user_texts[-1] if user_texts else ""
    if last_text and contains_profanity(last_text):
        return {
            "course": course,
            "assistant": PROFANITY_REPLY,
            "mode": "intake",
            "steps": ["profanity_refuse"],
            "patches": [],
            "calls": [],
            "modelMessages": model_messages,
            "usage": getattr(client, "usage", None),
        }
    if last_text and is_offtopic_request(last_text):
        refuse = (
            "Я собираю программы курсов повышения квалификации и ДПО. "
            "С рецептом борща или кодом вне учебной программы помочь не могу. "
            "Опишите тему курса, аудиторию и объём в академических часах — соберём каркас."
        )
        return {
            "course": course,
            "assistant": refuse,
            "mode": "intake",
            "steps": ["offtopic_refuse"],
            "patches": [],
            "calls": [],
            "modelMessages": model_messages,
            "usage": getattr(client, "usage", None),
        }
    if kit_request_ready(course, last_text):
        course = approve_framework(course)
    mode = decide_mode(course, last_text)
    if is_framework_approved(course) and kit_needed(course) and not getattr(client, "api_key", None):
        before = course
        course = fill_missing_kit(course, references, user_texts)
        return {
            "course": course,
            "assistant": kit_assistant_text(client, [], ["fill_missing_kit"]),
            "mode": "kit",
            "steps": ["fill_missing_kit"],
            "patches": kit_delta_patches(before, course),
            "calls": [],
            "modelMessages": model_messages,
            "usage": getattr(client, "usage", None),
        }
    if is_framework_approved(course) and kit_needed(course):
        mode = "kit"
    planned: list[str] = []
    hours_before = course.brief.duration_hours
    patches: list[dict[str, Any]] = []
    calls: list[dict[str, Any]] = []
    assistant_text = ""
    outgoing = messages_for_model(user_texts)
    kit_started = time.monotonic()

    brief_is_complete = not missing_brief_lines(course)

    explicit_build_request = last_text.strip().lower() in {
        "собери каркас",
        "собери каркас по заполненному шаблону",
        "сформируй каркас",
        "создай каркас",
    }

    skip_brief_extraction = (
        brief_is_complete
        and explicit_build_request
    )

    for _ in range(MAX_STEPS):
        if hasattr(client, "budget_left") and not client.budget_left():
            if not assistant_text:
                assistant_text = "Остановилась: лимит токенов на задачу."
            break
        if (
            mode == "free"
            and is_duration_edit_request(last_text)
            and "update_brief" not in planned
        ):
            step = {
                "kind": "tool",
                "tool": "update_brief",
                "task": "Измени общую продолжительность курса на явно указанное методистом значение.",
            }
        else:
            step = plan_step(mode, course, planned, len(user_texts))
        key = (
            f"{step['tool']}:{step['moduleId']}"
            if step["kind"] == "tool" and step.get("moduleId")
            else step.get("tool", step["kind"])
        )
        planned.append(key)
        if step.get("tool") == "update_brief":
            local_hours = None
            if is_duration_edit_request(last_text):
                local_hours = volume_from_text([last_text])
                arguments = {"durationHours": local_hours} if local_hours else {}
            elif skip_brief_extraction:
                arguments = {}
            else:
                try:
                    arguments = await extract_brief_arguments(
                        client,
                        course,
                        user_texts,
                    )
                except TurnStopped:
                    raise
                except (RuntimeError, ValueError, TypeError, KeyError, AttributeError):
                    arguments = {}

            output = execute_tool(
                "update_brief",
                arguments,
                course,
                user_texts,
                form_brief,
            )
            calls.append({"tool": "update_brief", "input": output.get("brief")})
            if output.get("type") != "tool_error":
                next_course = apply_patch(course, output)
                if next_course != course:
                    course = next_course
                    patches.append(output)
            if references:
                course = apply_reference_hints(course, references, user_texts)
            if local_hours and any(item.get("type") != "tool_error" for item in patches):
                assistant_text = duration_reply(local_hours)
                break
            continue
        if step.get("kind") == "reply":
            assistant_text = spoken_reply(course, str(step.get("task") or ""))
            notes = promise_notes(course)
            if notes and not missing_brief_lines(course):
                assistant_text = assistant_text + "\n\n" + "\n".join(notes)
            break
        if step.get("tool") == "set_competency_map" and not getattr(client, "api_key", None):
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
        timeout = 180
        attempts = None
        if mode == "kit":
            remaining = KIT_BUDGET_SECONDS - (time.monotonic() - kit_started)
            if remaining < 25:
                break
            timeout = min(KIT_CALL_TIMEOUT, remaining)
            attempts = 1
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
                timeout=timeout,
                attempts=attempts,
            )
        except TurnStopped:
            raise
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
                if mode == "kit":
                    break
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
            if step.get("tool") in {None, "update_brief"} or step.get("kind") in {"reply", "auto"}:
                assistant_text = (
                    "Шлюз не ответил. Этот ход не изменил программу, повторите сообщение."
                )
                break
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
            if step.get("tool") in KIT_TOOLS:
                if planned.count(key) >= 2:
                    break
                continue
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
            truncated = True
        else:
            truncated = False
        output = execute_tool(
            name,
            arguments,
            course,
            user_texts,
            form_brief,
            module_id=step.get("moduleId"),
        )
        origin = "catalog" if truncated else str(output.get("origin") or "model")
        if origin == "mixed":
            recorded: Any = "mixed"
        elif origin == "catalog":
            recorded = "local_fallback"
        else:
            recorded = arguments
        calls.append({"tool": name, "input": recorded})
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

    if (
        mode == "kit"
        and kit_needed(course)
        and all(item["ok"] for item in framework_items(course))
    ):
        course = approve_framework(course)
        before_fill = course
        course = fill_missing_kit(course, references, user_texts)
        patches.extend(kit_delta_patches(before_fill, course))
        planned.append("fill_missing_kit")
    if mode == "kit" and is_framework_approved(course):
        assistant_text = kit_assistant_text(client, calls, planned)
    elif is_framework_approved(course) and not assistant_text:
        assistant_text = "Каркас утверждён."
    if mode == "free" and not patches and "не изменил" not in assistant_text.casefold():
        notice = "Документ не изменился."
        assistant_text = f"{assistant_text}\n\n{notice}".strip() if assistant_text else notice
    hours_now = course.brief.duration_hours
    if hours_now > LARGE_DURATION_HOURS and hours_now != hours_before and "больше 1024" not in assistant_text:
        note = (
            f"Объём {hours_now:g} академических часов больше {LARGE_DURATION_HOURS}. "
            "Подтвердите, что вам нужен курс такого объёма."
        )
        assistant_text = f"{assistant_text}\n\n{note}".strip() if assistant_text else note

    return {
        "course": course,
        "assistant": assistant_text,
        "mode": mode,
        "steps": planned,
        "patches": patches,
        "calls": calls,
        "modelMessages": model_messages,
        "usage": getattr(client, "usage", None),
        "gatewayRetries": list(getattr(client, "gateway_retries", []) or []),
    }


LARGE_DURATION_HOURS = 1024


def duration_reply(hours: float) -> str:
    line = f"Объём программы теперь {hours:g} академических часов."
    if hours > LARGE_DURATION_HOURS:
        return (
            f"{line} Это больше {LARGE_DURATION_HOURS} часов. "
            "Подтвердите, что вам нужен курс такого объёма."
        )
    return f"{line} Проверьте, что сумма модулей сходится с этим объёмом."



def strip_teacher_only_modules(course: CourseDocument) -> CourseDocument:
    """Убирает шаблонные модули про этику/ПДн вне teacher_ai."""
    if is_teacher_ai(course):
        return course
    markers = ("этик", "персональных данных", "пдн", "pdn", "конфиденциал")
    kept = []
    for module in course.modules:
        blob = f"{module.title} {' '.join(module.topics or [])}".lower()
        if any(mark in blob for mark in markers):
            continue
        kept.append(module)
    if len(kept) == len(course.modules):
        return course
    value = course.as_api()
    value["modules"] = [module.model_dump(by_alias=True) for module in kept]
    return CourseDocument.model_validate(value)

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
    course = rebalance_course(flatten_internship_hours(course))
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
    course = strip_teacher_only_modules(course)
    return course


def kit_delta_patches(before: CourseDocument, after: CourseDocument) -> list[dict[str, Any]]:
    before_api = before.as_api()
    after_api = after.as_api()
    patches: list[dict[str, Any]] = []
    for kind, collection, field in (
        ("set_assessment", "assessments", "assessment"),
        ("set_seminar", "seminars", "seminar"),
        ("set_lecture", "lectures", "lecture"),
    ):
        previous = {row.get("moduleId"): row for row in before_api[collection]}
        for row in after_api[collection]:
            if previous.get(row.get("moduleId")) != row:
                patches.append({"type": kind, field: row})
    return patches


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
