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
    assert result["assistant"].count("?") == 1
    assert "\n2." not in result["assistant"]


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


def test_cloudru_key_wins_and_foreign_openai_url_is_not_called(monkeypatch) -> None:
    monkeypatch.setenv("GIGASCHOOL_API_KEY", "giga-key")
    monkeypatch.setenv("GIGASCHOOL_BASE_URL", "https://api.openai.com/v1")
    monkeypatch.setenv("CLOUDRU_API_KEY", "cloud-key")
    monkeypatch.setenv(
        "CLOUDRU_BASE_URL",
        "https://foundation-models.api.cloud.ru/v1",
    )

    client = CloudRuClient()

    assert client.api_key == "cloud-key"
    assert client.base_url == "https://foundation-models.api.cloud.ru/v1"


def test_gigaschool_key_is_used_only_without_cloudru(monkeypatch) -> None:
    monkeypatch.setenv("GIGASCHOOL_API_KEY", "vm-key")
    monkeypatch.setenv(
        "GIGASCHOOL_BASE_URL",
        "https://hub.gigaschool.ru/api/v1/llm/v1",
    )
    monkeypatch.setenv("CLOUDRU_API_KEY", "")

    client = CloudRuClient()

    assert client.api_key == "vm-key"
    assert client.base_url == "https://hub.gigaschool.ru/api/v1/llm/v1"


def test_foreign_openai_url_is_rejected_before_request(monkeypatch) -> None:
    monkeypatch.setenv("GIGASCHOOL_API_KEY", "sk-foreign")
    monkeypatch.setenv("GIGASCHOOL_BASE_URL", "https://api.openai.com/v1")
    monkeypatch.setenv("CLOUDRU_API_KEY", "")

    try:
        CloudRuClient()
    except ValueError as error:
        assert "запрещён" in str(error)
    else:
        raise AssertionError("чужой шлюз должен отклоняться до запроса")


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
    assert "Ключа шлюза нет" in result["assistant"]
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


def test_empty_kit_reply_asks_the_model_again() -> None:
    raw = approve_framework(fixture_course()).as_api()
    raw["assessments"] = []
    raw["lectures"] = []
    raw["seminars"] = []
    course = CourseDocument.model_validate(raw)
    questions = [
        {
            "stem": f"Вопрос модели {index}",
            "options": ["Да", "Нет", "Не знаю", "Другое"],
            "answer": "Да",
        }
        for index in range(10)
    ]
    fake = FakeClient(
        [
            {"role": "assistant", "content": None, "tool_calls": []},
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "call-2",
                        "type": "function",
                        "function": {
                            "name": "set_assessment",
                            "arguments": json.dumps({"questions": questions}, ensure_ascii=False),
                        },
                    }
                ],
            },
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
    assert any("Вопрос модели 0" in str(patch) for patch in result["patches"])
    assert "Учебный комплект подготовлен частично с помощью ИИ" in result["assistant"]
    assert "требуют проверки" in result["assistant"]


def test_gateway_silence_still_returns_kit_patches() -> None:
    raw = fixture_course().as_api()
    raw["brief"]["durationHours"] = 16
    raw["brief"]["attestationHours"] = 2
    raw["modules"] = [
        {
            "id": module_id,
            "title": title,
            "hours": hours,
            "lectureHours": lecture,
            "practiceHours": practice,
            "labHours": 0,
            "selfStudyHours": 0,
            "topics": [title],
            "plan": [
                {
                    "title": title,
                    "lectureHours": lecture,
                    "practiceHours": practice,
                    "labHours": 0,
                    "selfStudyHours": 0,
                }
            ],
            "learningOutcomes": [outcome],
            "competencyIds": ["C1"],
        }
        for module_id, title, hours, lecture, practice, outcome in (
            ("M1", "Старт", 4, 2, 2, "Пишет первую программу"),
            ("M2", "Ветвления", 4, 2, 2, "Использует ветвления"),
            ("M3", "Мини-проект", 6, 2, 4, "Собирает мини-проект"),
        )
    ]
    course = approve_framework(CourseDocument.model_validate(raw))
    seen: dict[str, int | float] = {"calls": 0}

    class Silent:
        api_key = "test-key"
        usage = None

        async def complete(self, **kwargs):
            seen["calls"] += 1
            seen["timeout"] = kwargs["timeout"]
            seen["attempts"] = kwargs["attempts"]
            raise RuntimeError("шлюз молчит")

    result = asyncio.run(
        run_turn(
            course,
            user_texts=["Каркас утверждён. Для каждого модуля вызови set_assessment, set_seminar и set_lecture."],
            model_messages=[{"role": "user", "content": "Каркас утверждён."}],
            client=Silent(),
        )
    )
    assert seen["calls"] == 1
    assert seen["timeout"] == 70
    assert seen["attempts"] == 1
    assert "Шлюз не ответил" in result["assistant"]
    for module_id in ("M1", "M2", "M3"):
        assert any(item.module_id == module_id for item in result["course"].lectures)
        assert any(item.module_id == module_id for item in result["course"].seminars)
        assert any(item.module_id == module_id for item in result["course"].assessments)
        assert any(
            patch["type"] == "set_lecture" and patch["lecture"]["moduleId"] == module_id
            for patch in result["patches"]
        )


def test_known_profile_with_key_asks_model_for_competencies() -> None:
    course = empty_course()
    course.brief.title = "Первые шаги в Python"
    course.brief.audience = "школьники 8 и 9 классов без опыта программирования"
    course.brief.duration_hours = 16
    course.brief.program_kind = "general"
    course.brief.attestation_form = "защита проекта"
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
                                            "name": "Собирает первую игру на Python",
                                            "knowledge": ["Переменная хранит значение"],
                                            "skills": ["Пишет условие"],
                                            "abilities": ["Запускает программу"],
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
            user_texts=["Собери каркас по заполненному шаблону"],
            model_messages=[{"role": "user", "content": "Собери каркас по заполненному шаблону"}],
            client=fake,
        )
    )
    names = " ".join(node.name for node in result["course"].competencies.nodes)
    assert "игру" in names.lower()
    assert any(
        call["tool"] == "set_competency_map" and call.get("input") != "local_fallback"
        for call in result["calls"]
    )


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

    def begin_turn(self) -> None:
        return None

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
    assert "модели" in response.json()["detail"] or "сеть" in response.json()["detail"]
    assert "RuntimeError" not in response.json()["detail"]


def test_gateway_failure_on_a_free_turn_keeps_the_course(monkeypatch) -> None:
    monkeypatch.setattr(
        agent_module,
        "plan_step",
        lambda *_args, **_kwargs: {"kind": "auto", "task": "правь названную часть"},
    )

    class Down:
        api_key = "test-key"

        async def complete(self, **_kwargs):
            raise RuntimeError("шлюз молчит")

    course = empty_course()
    course.brief.title = "Черновик"
    result = asyncio.run(
        run_turn(
            course,
            user_texts=["Поправь название на «Сети»"],
            model_messages=[{"role": "user", "content": "Поправь название на «Сети»"}],
            client=Down(),
        )
    )
    assert "не изменил программу" in result["assistant"]
    assert result["course"].brief.title == "Черновик"


def test_competency_gateway_failure_uses_the_catalog(monkeypatch) -> None:
    monkeypatch.setattr(
        agent_module,
        "plan_step",
        lambda *_args, **_kwargs: {"kind": "tool", "tool": "set_competency_map"},
    )

    class Down:
        api_key = "test-key"

        async def complete(self, **_kwargs):
            raise RuntimeError("шлюз молчит")

    course = empty_course()
    course.brief.title = "Сети для колледжа"
    course.brief.audience = "студенты колледжа без опыта"
    course.brief.duration_hours = 72
    course.brief.program_kind = "general"
    result = asyncio.run(
        run_turn(
            course,
            user_texts=["Собери каркас"],
            model_messages=[{"role": "user", "content": "Собери каркас"}],
            client=Down(),
        )
    )
    assert any(call.get("input") == "local_fallback" for call in result["calls"])
    assert result["course"].competencies.nodes


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
    assert max_tokens_for_step({"kind": "tool", "tool": "set_structure"}) == 3200
    assert max_tokens_for_step({"kind": "tool", "tool": "set_assessment"}) == 2400
    assert max_tokens_for_step({"kind": "tool", "tool": "set_lecture"}) == 2400
    assert max_tokens_for_step({"kind": "tool", "tool": "update_brief"}) == 280


def test_chat_turn_returns_422_on_invalid_hour_constraints(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app

    import app.agent_api as agent_api

    async def fake_run_turn(*args, **kwargs):
        raise ValueError(
            "Некорректные ограничения часов: "
            "минимум практики превышает доступные часы программы"
        )

    # Находим зарегистрированный обработчик маршрута.
    route = next(
        route
        for route in app.routes
        if getattr(route, "path", None) == "/api/chat/turn"
        and "POST" in getattr(route, "methods", set())
    )

    # Подменяем run_turn в глобальном пространстве
    # именно зарегистрированной функции.
    monkeypatch.setitem(
        route.endpoint.__globals__,
        "run_turn",
        fake_run_turn,
    )

    monkeypatch.setitem(
        route.endpoint.__globals__,
        "submit_chat_job",
        lambda payload: None,
    )

    course = empty_course()

    with TestClient(app) as client:
        response = client.post(
            "/api/chat/turn",
            json={
                "course": course.as_api(),
                "userTexts": [
                    "Практики должно быть не менее 25 часов"
                ],
                "messages": [
                    {
                        "role": "user",
                        "content": "Практики должно быть не менее 25 часов",
                    }
                ],
            },
        )

    assert response.status_code == 422
    assert (
        "Некорректные ограничения часов"
        in response.json()["detail"]
    )