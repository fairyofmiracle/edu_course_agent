import asyncio
import json

from fastapi.testclient import TestClient

import backend.app.agent as agent_module
from backend.app.agent import approve_framework, max_tokens_for_step, run_turn, strengthen_framework
from backend.app.cloud import CloudRuClient
from backend.app.main import app
import backend.app.agent_api as agent_api_module
from backend.app.models import CourseDocument, empty_course
from backend.tests.test_domain import fixture_course
from backend.tests.test_open_cases import CASE1


class FakeClient:
    def __init__(self, responses):
        self.responses = iter(responses)

    async def complete(self, **_kwargs):
        return next(self.responses)


def test_agent_does_not_invent_hours_from_month() -> None:
    fake = FakeClient(
        [
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "call-1",
                        "type": "function",
                        "function": {
                            "name": "update_brief",
                            "arguments": json.dumps(
                                {
                                    "title": "Кибербезопасность",
                                    "durationHours": 72,
                                    "programKind": "qualification",
                                }
                            ),
                        },
                    }
                ],
            },
            {
                "role": "assistant",
                "content": "Уточните точный объём программы в академических часах.",
            },
        ]
    )
    text = "Курс по кибербезопасности для колледжа примерно на месяц"
    result = asyncio.run(
        run_turn(
            empty_course(),
            user_texts=[text],
            model_messages=[{"role": "user", "content": text}],
            client=fake,
        )
    )
    assert result["course"].brief.duration_hours == 0
    assert result["course"].brief.program_kind == "unset"
    assert "точный объём" in result["assistant"]
    assert result["assistant"].count("?") <= 6


def test_chat_turn_http_contract(monkeypatch) -> None:
    fake = FakeClient(
        [
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "call-1",
                        "type": "function",
                        "function": {
                            "name": "update_brief",
                            "arguments": json.dumps(
                                {
                                    "title": "Python для школьников",
                                    "durationHours": 16,
                                    "programKind": "general",
                                }
                            ),
                        },
                    }
                ],
            },
            {"role": "assistant", "content": "Уточните аудиторию и аттестацию."},
        ]
    )
    monkeypatch.setattr(agent_module, "CloudRuClient", lambda: fake)
    course = empty_course()
    with TestClient(app) as client:
        response = client.post(
            "/api/chat/turn",
            json={
                "course": course.as_api(),
                "userTexts": [
                    "Нужен общеразвивающий курс «Python для школьников» на 16 часов"
                ],
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            "Нужен общеразвивающий курс «Python для школьников» "
                            "на 16 часов"
                        ),
                    }
                ],
            },
        )
    assert response.status_code == 200
    payload = response.json()
    assert payload["course"]["brief"]["durationHours"] == 16
    assert payload["patches"][0]["type"] == "update_brief"


def test_vm_openai_settings_have_priority(monkeypatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "vm-key")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://hub.gigaschool.ru/api/v1/llm/v1")
    monkeypatch.setenv("CLOUDRU_API_KEY", "legacy-key")
    monkeypatch.setenv("CLOUDRU_BASE_URL", "https://foundation-models.api.cloud.ru/v1")
    client = CloudRuClient()
    assert client.api_key == "vm-key"
    assert client.base_url == "https://hub.gigaschool.ru/api/v1/llm/v1"


def test_complete_request_asks_to_approve_not_empty_intake() -> None:
    fake = FakeClient(
        [
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "call-1",
                        "type": "function",
                        "function": {
                            "name": "set_structure",
                            "arguments": json.dumps(
                                {
                                    "modules": [
                                        {
                                            "id": "m1",
                                            "title": "Старт в Python",
                                            "hours": 8,
                                            "lectureHours": 4,
                                            "practiceHours": 4,
                                            "topics": ["Переменные"],
                                            "learningOutcomes": ["Пишет короткую программу"],
                                            "competencyIds": ["c1"],
                                        },
                                        {
                                            "id": "m2",
                                            "title": "Проект",
                                            "hours": 8,
                                            "lectureHours": 2,
                                            "practiceHours": 6,
                                            "topics": ["Игра"],
                                            "learningOutcomes": ["Защищает проект"],
                                            "competencyIds": ["c2"],
                                        },
                                    ]
                                }
                            ),
                        },
                    }
                ],
            }
        ]
    )
    result = asyncio.run(
        run_turn(
            empty_course(),
            user_texts=[CASE1],
            model_messages=[{"role": "user", "content": CASE1}],
            client=fake,
        )
    )
    assert "Не хватает данных" not in result["assistant"]
    assert "утверд" in result["assistant"].lower()


def test_approved_kit_fills_without_model() -> None:
    raw = approve_framework(fixture_course()).as_api()
    raw["assessments"] = []
    raw["lectures"] = []
    raw["seminars"] = []
    course = CourseDocument.model_validate(raw)

    class Boom:
        usage = None

        async def complete(self, **_kwargs):
            raise AssertionError("model should not be called for kit")

    result = asyncio.run(
        run_turn(
            course,
            user_texts=["Собери комплект"],
            model_messages=[{"role": "user", "content": "Собери комплект"}],
            client=Boom(),
        )
    )
    assert result["mode"] == "kit"
    assert result["steps"] == ["fill_missing_kit"]
    assert sum(len(item.questions) for item in result["course"].assessments) == 10
    assert result["course"].lectures
    assert result["course"].seminars


def test_approved_kit_with_key_asks_model() -> None:
    raw = approve_framework(fixture_course()).as_api()
    raw["assessments"] = []
    raw["lectures"] = []
    raw["seminars"] = []
    course = CourseDocument.model_validate(raw)
    fake = FakeClient(
        [
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "call-1",
                        "type": "function",
                        "function": {
                            "name": "set_assessment",
                            "arguments": json.dumps({"questions": []}),
                        },
                    }
                ],
            }
        ]
    )
    fake.api_key = "test-key"
    result = asyncio.run(
        run_turn(
            course,
            user_texts=["Собери комплект"],
            model_messages=[{"role": "user", "content": "Собери комплект"}],
            client=fake,
        )
    )
    assert result["mode"] == "kit"
    assert any(step.startswith("set_assessment") for step in result["steps"])
    assert sum(len(item.questions) for item in result["course"].assessments) == 10
    assert result["course"].lectures
    assert result["course"].seminars


def test_generic_competency_asks_model_and_drops_invented_code() -> None:
    text = "Собери каркас по заполненному шаблону"
    course = empty_course()
    course.brief.title = "Figma для этикеток"
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
                        "id": "call-1",
                        "type": "function",
                        "function": {
                            "name": "set_competency_map",
                            "arguments": json.dumps(
                                {
                                    "nodes": [
                                        {
                                            "id": "c1",
                                            "name": "Собирает макет этикетки в Figma",
                                            "knowledge": ["Кадры и автолейаут"],
                                            "skills": ["Собирает каркас экрана"],
                                            "abilities": ["Показывает макет коллеге"],
                                            "laborFunctionCode": "A/01.6",
                                        }
                                    ]
                                }
                            ),
                        },
                    }
                ],
            }
        ]
    )
    fake.api_key = "test-key"
    result = asyncio.run(
        run_turn(
            course,
            user_texts=["Нужна программа Figma для этикеток на 20 часов", text],
            model_messages=[{"role": "user", "content": text}],
            client=fake,
        )
    )
    names = " ".join(node.name for node in result["course"].competencies.nodes)
    assert "set_competency_map" in result["steps"]
    assert "макет" in names.lower()
    assert all(not node.labor_function_code for node in result["course"].competencies.nodes)


class LocalRunClient:
    api_key = None
    usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0, "calls": 0}

    def budget_left(self) -> bool:
        return True

    async def complete(self, **_kwargs):
        raise RuntimeError("structure fallback")


class StopBudgetClient(LocalRunClient):
    def budget_left(self) -> bool:
        return False


def test_run_case_waits_for_human_approve(monkeypatch) -> None:
    monkeypatch.setattr(agent_api_module, "CloudRuClient", LocalRunClient)
    with TestClient(app) as client:
        response = client.post("/api/run", json={"request": CASE1, "caseId": 1})
    assert response.status_code == 200
    payload = response.json()
    course = payload["course"]
    assert course["modules"]
    assert course["frameworkApproved"] is False
    assert payload["report"]["approvedBy"] is None
    assert not any(item["mode"] == "approve" for item in payload["transcript"])
    assert sum(len(item["questions"]) for item in course["assessments"]) == 0


def test_run_case_auto_approves_and_fills_kit(monkeypatch) -> None:
    monkeypatch.setattr(agent_api_module, "CloudRuClient", LocalRunClient)
    with TestClient(app) as client:
        response = client.post(
            "/api/run",
            json={"request": CASE1, "autoApprove": True, "caseId": 1},
        )
    assert response.status_code == 200
    payload = response.json()
    course = payload["course"]
    assert course["brief"]["durationHours"] == 16
    assert course["brief"]["programKind"] == "general"
    assert course["modules"]
    assert sum(len(item["questions"]) for item in course["assessments"]) >= 10
    assert payload["report"]["approvedBy"] == "auto"
    assert any(item["mode"] == "approve" for item in payload["transcript"])
    assert any(item["mode"] == "kit" for item in payload["transcript"])


def test_run_case_stops_when_budget_is_empty(monkeypatch) -> None:
    monkeypatch.setattr(agent_api_module, "CloudRuClient", StopBudgetClient)
    with TestClient(app) as client:
        response = client.post("/api/run", json={"request": CASE1})
    assert response.status_code == 200
    payload = response.json()
    assert payload["transcript"][0]["mode"] == "stop"
    assert payload["course"]["modules"] == []


def test_chat_turn_returns_502_on_agent_error(monkeypatch) -> None:
    async def boom(*_args, **_kwargs):
        raise RuntimeError("сеть недоступна")

    monkeypatch.setattr(agent_api_module, "run_turn", boom)
    with TestClient(app) as client:
        response = client.post(
            "/api/chat/turn",
            json={
                "course": empty_course().as_api(),
                "userTexts": ["Нужен курс"],
                "messages": [],
            },
        )
    assert response.status_code == 502
    assert "сеть недоступна" in response.json()["detail"]


def test_run_turn_stops_on_client_budget() -> None:
    course = empty_course()
    result = asyncio.run(
        run_turn(
            course,
            user_texts=["Нужен курс"],
            model_messages=[{"role": "user", "content": "Нужен курс"}],
            client=StopBudgetClient(),
        )
    )
    assert result["assistant"].startswith("Остановилась")


def test_strengthen_internship_sets_attestation() -> None:
    course = empty_course()
    course.brief.title = "Стажировка DevOps-инженер от Linux до CI/CD"
    course.brief.audience = "слушатели, аудиторных занятий нет"
    course.brief.program_kind = "qualification"
    course.brief.duration_hours = 256
    course.brief.attestation_form = ""
    strengthened = strengthen_framework(course)
    assert strengthened.brief.attestation_hours == 2
    assert "отчёт" in strengthened.brief.attestation_form.lower()


def test_max_tokens_match_step_kind() -> None:
    assert max_tokens_for_step({"kind": "reply"}) == 220
    assert max_tokens_for_step({"kind": "tool", "tool": "set_structure"}) == 1600
    assert max_tokens_for_step({"kind": "tool", "tool": "set_assessment"}) == 1100
    assert max_tokens_for_step({"kind": "tool", "tool": "set_lecture"}) == 450
    assert max_tokens_for_step({"kind": "tool", "tool": "update_brief"}) == 280
