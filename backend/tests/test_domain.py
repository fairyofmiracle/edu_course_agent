import json
from pathlib import Path

from backend.app.brief_guard import guard_brief
from pydantic import ValidationError

from backend.app.domain import (
    allocate_integer,
    apply_patch,
    apply_patches,
    framework_items,
)
from backend.app.models import CourseDocument, empty_course
from backend.app.agent import approve_framework, fill_missing_kit
from backend.app.planner import decide_mode, kit_needed, plan_step
from backend.app.tools import execute_tool

FIXTURE = Path(__file__).parents[2] / "fixtures" / "course-contract.json"


def fixture_course() -> CourseDocument:
    return CourseDocument.model_validate(json.loads(FIXTURE.read_text(encoding="utf-8")))


def test_shared_contract_matches_typescript_expectations() -> None:
    course = fixture_course()
    results = {item["id"]: item["ok"] for item in framework_items(course)}
    assert all(results.values())
    assert allocate_integer(14, [4, 8, 0, 2]) == [4, 8, 0, 2]
    assert allocate_integer(2, [0.5, 1.5]) == [0.5, 1.5]


def test_apply_patches_orders_structure_before_kit() -> None:
    course = empty_course()
    course.brief.duration_hours = 16
    course.brief.program_kind = "general"
    course.brief.audience = "колледж"
    lecture = {
        "type": "set_lecture",
        "lecture": {
            "moduleId": "m1",
            "durationMin": 30,
            "outline": ["Тема"],
            "slides": [{"title": "Слайд", "bullets": ["пункт"]}],
        },
    }
    structure = {
        "type": "set_structure",
        "modules": [
            {
                "id": "m1",
                "title": "Сети",
                "hours": 16,
                "lectureHours": 8,
                "practiceHours": 8,
                "labHours": 0,
                "selfStudyHours": 0,
                "topics": ["IP"],
                "learningOutcomes": ["Собирает стенд"],
            }
        ],
    }
    merged = apply_patches(course, [lecture, structure])
    assert [item.id for item in merged.modules] == ["m1"]
    assert merged.lectures[0].module_id == "m1"


def test_patch_rebalances_hours_and_keeps_contract() -> None:
    course = fixture_course()
    changed = apply_patch(
        course,
        {"type": "update_brief", "brief": {"durationHours": 20}},
    )
    assert sum(module.hours for module in changed.modules) == 18
    assert all(item["ok"] for item in framework_items(changed))


def test_month_does_not_become_seventy_two_hours() -> None:
    current = fixture_course().brief.model_copy(
        update={"duration_hours": 0, "program_kind": "unset"}
    )
    guarded, dropped = guard_brief(
        {"durationHours": 72, "programKind": "qualification"},
        current.model_dump(by_alias=True),
        ["Нужна программа примерно на месяц для сотрудников колледжа"],
    )
    assert "durationHours" not in guarded
    assert "programKind" not in guarded
    assert dropped == ["durationHours", "programKind"]


def test_russian_program_kind_becomes_general() -> None:
    current = empty_course().brief.model_dump(by_alias=True)
    guarded, dropped = guard_brief(
        {
            "title": "Первые шаги в Python",
            "durationHours": 16,
            "programKind": "Дополнительная общеразвивающая программа",
        },
        current,
        [
            "Нужна дополнительная общеразвивающая программа «Первые шаги в Python» "
            "Объем 16 часов"
        ],
    )
    assert guarded["programKind"] == "general"
    assert guarded["durationHours"] == 16
    assert dropped == []


def test_model_structure_aliases_are_applied() -> None:
    course = empty_course()
    output = execute_tool(
        "set_structure",
        {
            "competencies": ["Основы Python"],
            "modules": [
                {
                    "title": "Введение в Python",
                    "academicHours": 8,
                    "practicesHours": 5,
                    "lecturesHours": 3,
                    "description": "Синтаксис и переменные",
                }
            ],
        },
        course,
        ["Нужна общеразвивающая программа на 16 часов"],
    )
    module = output["modules"][0]
    assert module["hours"] == 8
    assert module["practiceHours"] == 5
    assert module["lectureHours"] == 3
    assert module["topics"]
    assert module["learningOutcomes"]
    nodes = execute_tool(
        "set_brief",
        {"competencies": ["Основы Python", "Мини-проект"]},
        course,
        ["текст"],
    )
    assert nodes["type"] == "update_brief"


def test_empty_assessment_is_filled_from_module() -> None:
    course = approve_framework(fixture_course())
    output = execute_tool("set_assessment", {}, course, [], module_id="M1")
    assert output["type"] == "set_assessment"
    assert len(output["assessment"]["questions"]) == 10
    assert output["assessment"]["questions"][0]["learningOutcome"] == "Пишет программу с ветвлением"
    assert "Что верно про тему" not in output["assessment"]["questions"][0]["stem"]
    filled = fill_missing_kit(course)
    assert kit_needed(filled) is False
    assert len(filled.assessments[0].questions) == 10
    assert filled.lectures
    assert filled.seminars
    assert filled.competencies.nodes[0].name == "Пишет простые программы"
    assert "Практика по теме" not in filled.lectures[0].slides[0].bullets


def test_patch_rounds_hours_to_half_step_instead_of_dropping_brief() -> None:
    course = fixture_course()
    changed = apply_patch(
        course,
        {"type": "update_brief", "brief": {"durationHours": 20.7, "title": "Сети колледжа"}},
    )
    assert changed.brief.title == "Сети колледжа"
    assert changed.brief.duration_hours == 20.5


def test_saved_course_rejects_hour_outside_half_step() -> None:
    course = fixture_course().model_dump(by_alias=True)
    course["brief"]["durationHours"] = 16.2
    try:
        CourseDocument.model_validate(course)
    except ValidationError:
        return
    raise AssertionError("16.2 часа не должны проходить схему курса")


def test_patch_attaches_official_basis_for_the_program_kind() -> None:
    course = fixture_course()
    changed = apply_patch(
        course,
        {"type": "update_brief", "brief": {"title": "Основы Python"}},
    )
    sources = [reference.source for reference in changed.brief.references]
    assert "http://publication.pravo.gov.ru/document/0001202209270013" in sources
    assert "https://example.org/reference" in sources


def test_kit_prompt_opens_kit_when_framework_checks_pass() -> None:
    course = fixture_course()
    approved = approve_framework(course)
    assert "16.0" not in approved.framework_fingerprint
    assert decide_mode(approved, "Проверь ещё раз") == "kit"
    stale = course.model_copy(
        update={"framework_approved": True, "framework_fingerprint": "старый"}
    )
    assert (
        decide_mode(
            stale,
            "Каркас утверждён. Для каждого модуля вызови set_assessment, set_seminar и set_lecture.",
        )
        == "kit"
    )


def test_planner_starts_with_brief_tool() -> None:
    course = fixture_course()
    assert decide_mode(course, "Новый запрос") == "intake"
    step = plan_step("intake", course, [], 1)
    assert step["tool"] == "update_brief"


def test_short_program_asks_for_three_modules() -> None:
    course = fixture_course()
    course.brief.duration_hours = 16
    step = plan_step("intake", course, ["update_brief", "set_competency_map"], 1)
    assert step["tool"] == "set_structure"
    assert "3 модуля" in step["task"]


def test_kit_tools_wait_for_approval() -> None:
    course = fixture_course()
    blocked = execute_tool("set_assessment", {}, course, [], module_id="M1")
    assert blocked["type"] == "tool_error"
    unknown = execute_tool("set_mood", {}, course, [])
    assert unknown["type"] == "set_mood"
    missing = execute_tool("unknown_tool", {}, course, [])
    assert missing["type"] == "tool_error"
    revised = execute_tool(
        "revise_section",
        {"section": "brief", "data": '{"title":"Сети"}'},
        approve_framework(course),
        [],
    )
    assert revised["type"] == "revise_section"
    assert revised["data"]["title"] == "Сети"


def test_kit_stops_after_test_and_two_lectures() -> None:
    course = fixture_course()
    course.framework_approved = True
    assert kit_needed(course) is True
    first = plan_step("kit", course, [], 3)
    assert first["tool"] == "set_assessment"
