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


def test_large_course_is_split_into_blocks() -> None:
    from backend.app.catalog import block_count, generic_structure

    course = empty_course()
    course.brief.title = "Длинная программа по архивному делу"
    course.brief.audience = "сотрудники архива"
    course.brief.duration_hours = 500
    course.brief.program_kind = "general"
    assert block_count(500) == 12
    modules = generic_structure(course)
    assert modules is not None and len(modules) == 12
    step = plan_step("framework", course, ["update_brief", "set_competency_map"], 1)
    assert "12" in step["task"]
    assert "1–8" in step["task"]


def test_program_hours_have_no_ceiling() -> None:
    from backend.app.brief_guard import volume_from_text
    from backend.app.catalog import block_count, generic_structure
    from backend.app.domain import apply_patch

    assert volume_from_text(["нужна программа на 1024 часа"]) == 1024
    assert block_count(1024) == 26
    assert block_count(2000) == 50
    course = empty_course()
    course.brief.title = "Длинная программа по архивному делу"
    course.brief.audience = "сотрудники архива"
    course.brief.duration_hours = 1024
    course.brief.program_kind = "general"
    built = generic_structure(course)
    assert built is not None and len(built) == 26
    first = apply_patch(course, {"type": "set_structure", "modules": built[:8]})
    assert len(first.modules) == 8
    second = apply_patch(first, {"type": "set_structure", "modules": built[8:16]})
    assert len(second.modules) == 16
    step = plan_step(
        "framework",
        first,
        ["update_brief", "set_competency_map", "set_structure"],
        2,
    )
    assert "26" in step["task"]
    assert "9–16" in step["task"]


def test_repeated_module_id_keeps_the_other_blocks() -> None:
    from backend.app.domain import apply_patch

    def row(module_id: str, title: str) -> dict:
        return {
            "id": module_id,
            "title": title,
            "hours": 40,
            "lectureHours": 10,
            "practiceHours": 20,
            "selfStudyHours": 10,
            "topics": ["тема"],
            "learningOutcomes": ["умеет"],
            "competencyIds": ["c1"],
        }

    course = empty_course()
    course.brief.duration_hours = 120
    course.brief.program_kind = "general"
    course.brief.title = "Длинная программа"
    course.brief.audience = "сотрудники архива"
    first = apply_patch(
        course,
        {"type": "set_structure", "modules": [row("1", "Первый"), row("2", "Второй")]},
    )
    second = apply_patch(
        first,
        {"type": "set_structure", "modules": [row("1", "Первый, правка"), row("3", "Третий")]},
    )
    assert [module.id for module in second.modules] == ["1", "2", "3"]
    assert second.modules[0].title == "Первый, правка"
    assert second.modules[1].title == "Второй"
    untouched = apply_patch(second, {"type": "set_structure", "modules": []})
    assert [module.id for module in untouched.modules] == ["1", "2", "3"]
    assert apply_patch(second, {"type": "not_a_patch"}) is second


def test_kit_plans_a_seminar_when_the_lecture_is_already_there() -> None:
    course = fixture_course()
    course.seminars = []
    history: list[str] = []
    step: dict = {}
    for _ in range(6):
        step = plan_step("kit", course, history, 3)
        if step.get("tool") == "set_seminar":
            break
        key = (
            f"{step['tool']}:{step['moduleId']}"
            if step.get("moduleId")
            else str(step.get("tool") or step["kind"])
        )
        history.extend([key, key])
    assert step["tool"] == "set_seminar"
    assert "модуля" in step["task"]


def test_catalog_kit_is_marked() -> None:
    approved = approve_framework(fixture_course())
    lecture = execute_tool("set_lecture", {"slides": []}, approved, [], module_id="M1")
    assert lecture["origin"] == "catalog"
    assert "_origin" not in lecture["lecture"]
    assessment = execute_tool(
        "set_assessment",
        {
            "questions": [
                {
                    "stem": "Какой первый шаг работы с данными модуля?",
                    "options": ["Собрать", "Спрятать", "Удалить", "Отложить"],
                    "answer": "Собрать",
                }
            ]
        },
        approved,
        [],
        module_id="M1",
    )
    assert assessment["origin"] == "mixed"
    assert len(assessment["assessment"]["questions"]) == 10
    mixed = execute_tool(
        "set_lecture",
        {
            "slides": [
                {"title": "Своя тема", "bullets": ["Слушатель называет шаг своими словами и сверяет его."]},
                {"title": "Заготовка", "bullets": ["Практика по теме модуля"]},
            ]
        },
        approved,
        [],
        module_id="M1",
    )
    assert mixed["origin"] == "mixed"
    assert all(slide.get("title") != "Ход занятия" for slide in mixed["lecture"]["slides"])
    seminar = execute_tool(
        "set_seminar",
        {
            "tasks": [
                {
                    "title": "Сверить часы",
                    "prompt": "Сверьте часы модуля с планом.",
                    "steps": ["Откройте план", "Сложите часы"],
                    "timeMin": 20,
                    "criteria": ["Сумма сходится"],
                    "competencyId": "c1",
                    "learningOutcome": approved.modules[0].learning_outcomes[0],
                }
            ]
        },
        approved,
        [],
        module_id="M1",
    )
    assert seminar["origin"] == "model"
    from backend.app.tools import coerce_seminar_arguments

    catalog_seminar = coerce_seminar_arguments({}, empty_course(), "нет")
    assert catalog_seminar["_origin"] == "catalog"


def test_block_sizes_and_internship_plan() -> None:
    from backend.app.catalog import block_count, generic_structure

    assert block_count(100) == 6
    assert block_count(200) == 8
    empty = empty_course()
    assert generic_structure(empty) is None
    internship = empty_course()
    internship.brief.title = "Стажировка в колледже"
    internship.brief.audience = "слушатели, аудиторных занятий нет"
    internship.brief.duration_hours = 256
    internship.brief.program_kind = "qualification"
    step = plan_step("framework", internship, ["update_brief", "set_competency_map"], 2)
    assert step["tool"] == "set_structure"
    assert "8" in step["task"]


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


def test_lecture_keeps_visuals_and_clamps_duration() -> None:
    from backend.app.tools import _clean_competency_node, _text_list

    assert _text_list("одно; другое", "запас") == ["одно", "другое"]
    assert _text_list([{"name": "Знает таблицы"}, 5], "запас")[0] == "Знает таблицы"
    assert len(_text_list([str(index) for index in range(12)], "запас")) == 8
    assert _text_list(5, "запас") == ["запас"]
    node = _clean_competency_node(
        {
            "name": "",
            "bloomLevel": "анализ",
            "description": "пояснение",
            "laborFunctionCode": "A/01.6",
            "knowledge": "одно знание",
        },
        0,
        False,
    )
    assert node["name"].startswith("Компетенция")
    assert node["bloomLevel"] == "analyze"
    assert node["description"] == "пояснение"
    assert node["laborFunctionCode"] == "A/01.6"

    approved = approve_framework(fixture_course())
    slides = []
    for index in range(14):
        slides.append(
            {
                "title": f"Тема {index}",
                "bullets": ["Первый тезис слайда", "Второй тезис слайда"],
                "mermaid": "flowchart LR\nA-->B" if index == 0 else "",
                "visualPrompt": "схема",
                "speakerNotes": "заметки",
                "table": [["А", "Б"], ["1", "2"]] if index == 1 else None,
            }
        )
    lecture = execute_tool(
        "set_lecture",
        {"outline": "Одна тема", "durationMin": 500, "slides": slides},
        approved,
        [],
        module_id="M1",
    )
    assert lecture["type"] == "set_lecture"
    assert lecture["lecture"]["durationMin"] <= 90
    assert len(lecture["lecture"]["slides"]) <= 12
    assert any(slide.get("mermaid") for slide in lecture["lecture"]["slides"])


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
        health = client.get("/health").json()
        assert health["status"] == "ok"
        assert "llmConfigured" in health
        assert health["exports"] == ["json", "docx", "pptx"]
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
