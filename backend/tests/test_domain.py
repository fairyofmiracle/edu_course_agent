import json
from pathlib import Path

from backend.app.brief_guard import guard_brief
from backend.app.domain import (
    allocate_integer,
    apply_patch,
    framework_items,
)
from backend.app.models import CourseDocument
from backend.app.planner import decide_mode, plan_step

FIXTURE = Path(__file__).parents[2] / "fixtures" / "course-contract.json"


def fixture_course() -> CourseDocument:
    return CourseDocument.model_validate(json.loads(FIXTURE.read_text(encoding="utf-8")))


def test_shared_contract_matches_typescript_expectations() -> None:
    course = fixture_course()
    results = {item["id"]: item["ok"] for item in framework_items(course)}
    assert all(results.values())
    assert allocate_integer(14, [4, 8, 0, 2]) == [4, 8, 0, 2]


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


def test_planner_starts_with_brief_tool() -> None:
    course = fixture_course()
    assert decide_mode(course, "Новый запрос") == "intake"
    step = plan_step("intake", course, [], 1)
    assert step["tool"] == "update_brief"
