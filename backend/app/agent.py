from __future__ import annotations

import json
from typing import Any

from .cloud import CloudRuClient
from .domain import apply_patch, framework_fingerprint, framework_items
from .models import CourseDocument
from .planner import content_missing, decide_mode, plan_step
from .tools import course_tools, execute_tool

MAX_STEPS = 28

SYSTEM_PROMPT = """Ты — методист-проектировщик образовательных программ.
Интерфейс студии: слева запрос, справа документ. Документ меняй только инструментами.
Не задавай по одному вопросу: одним сообщением задай не больше пяти.
Объём в часах и тип программы бери только из слов методиста.
«Месяц» и «примерно месяц» — срок, а не объём; обязательно спроси точные часы.
Аттестация входит в общий объём. Часы — академические с шагом 0,5.
Не утверждай каркас от имени человека.
Источники, номера приказов и коды профстандартов не придумывай.
Тесты, семинары и лекции создавай только после утверждения каркаса.
Выполняй ровно задачу из строки «Текущий шаг»."""


def build_system_prompt(
    course: CourseDocument,
    task: str,
    references: str | None = None,
) -> str:
    value = course.as_api()
    compact = {
        "brief": value["brief"],
        "competencies": value["competencies"],
        "modules": [
            {
                "id": module["id"],
                "title": module["title"],
                "hours": module["hours"],
                "competencyIds": module["competencyIds"],
                "learningOutcomes": module["learningOutcomes"],
            }
            for module in value["modules"]
        ],
        "lectureModuleIds": [item["moduleId"] for item in value["lectures"]],
        "seminarModuleIds": [item["moduleId"] for item in value["seminars"]],
        "assessmentModuleIds": [item["moduleId"] for item in value["assessments"]],
    }
    refs = (references or "").strip()[:12000]
    return "\n".join(
        filter(
            None,
            [
                SYSTEM_PROMPT,
                "Текущий документ курса:",
                json.dumps(compact, ensure_ascii=False)[:14000],
                f"Дополнительные материалы методиста:\n{refs}" if refs else "",
                f"Текущий шаг: {task}",
            ],
        )
    )


def _tool_choice(step: dict[str, Any]) -> str | dict[str, Any]:
    if step["kind"] == "tool":
        return {
            "type": "function",
            "function": {"name": step["tool"]},
        }
    return "auto"


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
    planned: list[str] = []
    patches: list[dict[str, Any]] = []
    calls: list[dict[str, Any]] = []
    assistant_text = ""

    for _ in range(MAX_STEPS):
        step = plan_step(mode, course, planned, len(user_texts))
        key = (
            f"{step['tool']}:{step['moduleId']}"
            if step["kind"] == "tool" and step.get("moduleId")
            else step.get("tool", step["kind"])
        )
        planned.append(key)
        message = await client.complete(
            system=build_system_prompt(course, step["task"], references),
            messages=model_messages,
            tools=course_tools(),
            tool_choice=_tool_choice(step),
        )
        tool_calls = (message.get("tool_calls") or [])[:1]
        model_messages.append(message)
        content = message.get("content")
        if isinstance(content, str) and content.strip():
            assistant_text = content.strip()
        if not tool_calls:
            if step["kind"] in {"reply", "auto"}:
                break
            continue

        call = tool_calls[0]
        function = call.get("function") or {}
        name = str(function.get("name") or "")
        raw_arguments = function.get("arguments") or "{}"
        try:
            arguments = (
                json.loads(raw_arguments)
                if isinstance(raw_arguments, str)
                else raw_arguments
            )
        except json.JSONDecodeError:
            arguments = {}
        output = execute_tool(name, arguments, course, user_texts, form_brief)
        calls.append({"tool": name, "input": arguments})
        if output.get("type") != "tool_error":
            next_course = apply_patch(course, output)
            if next_course != course:
                course = next_course
                patches.append(output)
        model_messages.append(
            {
                "role": "tool",
                "tool_call_id": call.get("id", f"call-{len(calls)}"),
                "content": json.dumps(output, ensure_ascii=False),
            }
        )
        if planned.count("reply") >= 2:
            break

    return {
        "course": course,
        "assistant": assistant_text,
        "mode": mode,
        "steps": planned,
        "patches": patches,
        "calls": calls,
        "modelMessages": model_messages,
    }


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
    }
