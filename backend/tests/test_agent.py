import asyncio
import json

from fastapi.testclient import TestClient

import backend.app.agent as agent_module
from backend.app.agent import run_turn
from backend.app.cloud import CloudRuClient
from backend.app.main import app
from backend.app.models import empty_course


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
