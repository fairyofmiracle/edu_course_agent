import asyncio
import json

from fastapi.testclient import TestClient

from backend.app.agent import approve_framework, run_turn
from backend.app.catalog import lecture_modules
from backend.app.domain import academic_hours, apply_patch
from backend.app.main import app
from backend.app.models import empty_course
from backend.app.planner import plan_step
from backend.app.tools import execute_tool
from backend.tests.test_agent import FakeClient
from backend.tests.test_domain import fixture_course
from backend.tests.test_open_cases import CASE4, CASE4_ANSWERS
import backend.app.agent_api as agent_api_module


def test_messy_model_competencies_stay_on_the_course() -> None:
    course = fixture_course()
    output = execute_tool(
        "set_competency_map",
        {
            "nodes": [
                {
                    "id": "навык 1",
                    "name": "Собирает первую игру на Python",
                    "bloomLevel": "Понимание",
                    "knowledge": "Переменная хранит значение; " + ("длинная формулировка " * 40),
                    "skills": ["Пишет условие"],
                    "abilities": "Запускает программу",
                    "laborFunctionCode": "A/01.6",
                }
            ]
        },
        course,
        ["общеразвивающая программа"],
    )
    changed = apply_patch(course, output)
    node = changed.competencies.nodes[0]
    assert "игру" in node.name.lower()
    assert node.bloom_level == "understand"
    assert not node.labor_function_code
    assert all(len(item) <= 240 for item in node.knowledge)
    assert changed.modules


def test_model_text_without_tools_falls_back_to_local_structure() -> None:
    course = empty_course()
    course.brief.title = "Основы Figma для этикеток"
    course.brief.audience = "сотрудники музея без опыта дизайна"
    course.brief.duration_hours = 20
    course.brief.program_kind = "general"
    course.brief.attestation_form = "зачёт"
    fake = FakeClient(
        [
            {"role": "assistant", "content": "компетенции без вызова"},
            {"role": "assistant", "content": "структура без вызова"},
        ]
    )
    fake.api_key = "test-key"
    result = asyncio.run(
        run_turn(
            course,
            user_texts=["Собери каркас по заполненному шаблону"],
            model_messages=[{"role": "user", "content": "Собери каркас по заполненному шаблону"}],
            client=fake,
        )
    )
    assert result["course"].competencies.nodes
    assert result["course"].modules
    assert any(call["tool"] == "set_structure" for call in result["calls"])


def test_model_tool_call_with_broken_json_and_empty_structure() -> None:
    course = empty_course()
    course.brief.title = "Основы Figma для этикеток"
    course.brief.audience = "сотрудники музея без опыта дизайна"
    course.brief.duration_hours = 20
    course.brief.program_kind = "general"
    course.brief.attestation_form = "зачёт"
    fake = FakeClient(
        [
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "c1",
                        "type": "function",
                        "function": {"name": "set_competency_map", "arguments": "{нет"},
                    }
                ],
            },
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "c2",
                        "type": "function",
                        "function": {"name": "set_structure", "arguments": json.dumps({"modules": []})},
                    }
                ],
            },
        ]
    )
    fake.api_key = "test-key"
    result = asyncio.run(
        run_turn(
            course,
            user_texts=["Собери каркас по заполненному шаблону"],
            model_messages=[{"role": "user", "content": "Собери каркас по заполненному шаблону"}],
            client=fake,
        )
    )
    assert result["course"].modules
    assert any(call.get("input") == "local_fallback" for call in result["calls"])


def test_planner_structure_tasks_for_data_and_teacher() -> None:
    data = empty_course()
    data.brief.title = "Анализ данных на Python"
    data.brief.audience = "сотрудники банка в Excel"
    data.brief.duration_hours = 72
    data.brief.program_kind = "qualification"
    step = plan_step("framework", data, ["update_brief", "set_competency_map"], 1)
    assert step["tool"] == "set_structure"
    assert "pandas" in step["task"]
    teacher = empty_course()
    teacher.brief.title = "ИИ в работе учителя"
    teacher.brief.audience = "учителя школ"
    teacher.brief.duration_hours = 36
    teacher.brief.program_kind = "qualification"
    step = plan_step("framework", teacher, ["update_brief", "set_competency_map"], 1)
    assert "риск" in step["task"].lower()


def test_apply_patch_writes_kit_and_revise_section() -> None:
    course = fixture_course()
    lecture = apply_patch(
        course,
        {
            "type": "set_lecture",
            "lecture": {
                "moduleId": "M1",
                "durationMin": 45,
                "outline": ["Переменные"],
                "slides": [{"title": "Переменные", "bullets": ["Имя хранит значение"]}],
            },
        },
    )
    assert lecture.lectures[0].module_id == "M1"
    broken = apply_patch(course, {"type": "set_assessment"})
    assert broken.assessments == course.assessments
    revised = apply_patch(
        course,
        {
            "type": "revise_section",
            "section": "brief",
            "data": {"title": "Сети колледжа"},
        },
    )
    assert revised.brief.title == "Сети колледжа"
    assert academic_hours("нет") == 0
    assert academic_hours(-3) == 0


def test_tools_cover_structure_and_lecture_edges() -> None:
    course = empty_course()
    structure = execute_tool(
        "set_structure",
        {
            "modules": [
                "пропуск",
                {"title": "", "hours": 8},
                {
                    "id": "dup",
                    "title": "Повтор",
                    "lectureHours": 10,
                    "practiceHours": 2,
                    "hours": 8,
                },
            ]
        },
        course,
        ["программа на 16 часов"],
    )
    assert structure["type"] == "set_structure"
    assert len(structure["modules"]) == 2
    approved = approve_framework(fixture_course())
    lecture = execute_tool(
        "set_lecture",
        {"outline": "Одна тема", "slides": [{"title": "", "bullets": []}]},
        approved,
        [],
        module_id="M1",
    )
    assert lecture["type"] == "set_lecture"
    assert lecture["lecture"]["slides"]
    seminar = execute_tool("set_seminar", {"tasks": [{"title": "сломан"}]}, approved, [], module_id="M1")
    assert seminar["type"] == "set_seminar"
    empty = execute_tool("set_seminar", {}, empty_course(), [])
    assert empty.get("type") in {"set_seminar", "tool_error"}
    revised = execute_tool("revise_section", {"section": "brief", "data": "{не json"}, approved, [])
    assert revised["type"] == "revise_section"


def test_lecture_modules_adds_pandas_when_limit_allows() -> None:
    course = fixture_course()
    extra = course.modules[0].model_copy(
        update={
            "id": "M2",
            "title": "Pandas таблицы",
            "lecture_hours": 0,
            "practice_hours": 4,
            "hours": 4,
        }
    )
    course.modules.append(extra)
    course.brief.title = "Анализ данных pandas"
    picked = lecture_modules(course, 2)
    assert any(item.id == "M2" for item in picked)


def test_http_service_routes() -> None:
    with TestClient(app) as client:
        assert client.get("/health").json()["status"] == "ok"
        assert client.get("/api/regulatory/policy").json()["rules"]
        stack = client.post("/api/stack/freshness", json={"texts": ["Python 3.12"]})
        assert stack.status_code == 200
        probe = client.post("/api/sources/probe", json={"urls": []})
        assert probe.status_code == 200


def test_run_case_uses_answers_and_reports_error(monkeypatch) -> None:
    class Local:
        api_key = None
        usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0, "calls": 0}

        def budget_left(self) -> bool:
            return True

        async def complete(self, **_kwargs):
            raise RuntimeError("offline")

    monkeypatch.setattr(agent_api_module, "CloudRuClient", Local)
    with TestClient(app) as client:
        response = client.post(
            "/api/run",
            json={"request": CASE4, "answers": CASE4_ANSWERS, "autoApprove": False},
        )
    assert response.status_code == 200
    body = response.json()
    assert len(body["transcript"]) >= 2

    async def boom(*_args, **_kwargs):
        raise RuntimeError("сервер недоступен")

    monkeypatch.setattr(agent_api_module, "run_turn", boom)
    with TestClient(app) as client:
        failed = client.post("/api/run", json={"request": "Нужен курс"})
    assert failed.status_code == 502
