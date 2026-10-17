import asyncio
import json

from fastapi.testclient import TestClient

import backend.app.agent as agent_module
from backend.app.agent import approve_framework, run_turn
from backend.app.cloud import CloudRuClient
from backend.app.main import app
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
    monkeypatch.setenv("OPENAI_BASE_URL", "https://vm.example/v1")
    monkeypatch.setenv("CLOUDRU_API_KEY", "legacy-key")
    monkeypatch.setenv("CLOUDRU_BASE_URL", "https://legacy.example/v1")
    client = CloudRuClient()
    assert client.api_key == "vm-key"
    assert client.base_url == "https://vm.example/v1"


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
