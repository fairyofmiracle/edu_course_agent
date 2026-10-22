import json

import pytest

from backend.app.tools import execute_tool
from backend.app.domain import apply_patch
from backend.app.planner import missing_brief_lines

from backend.app.agent import run_turn

from backend.app.agent import extract_brief_arguments
from backend.app.models import empty_course


class FakeCloudClient:
    """Имитирует ответ Cloud.ru без сетевого запроса."""

    def __init__(self, arguments):
        self.arguments = arguments
        self.calls = []

    async def complete(self, **kwargs):
        self.calls.append(kwargs)
        return {
            "tool_calls": [
                {
                    "function": {
                        "name": "update_brief",
                        "arguments": json.dumps(
                            self.arguments,
                            ensure_ascii=False,
                        ),
                    }
                }
            ]
        }

@pytest.fixture
def anyio_backend():
    return "asyncio"

@pytest.mark.anyio
async def test_extract_brief_from_free_text():
    client = FakeCloudClient(
        {
            "title": "Основы Python",
            "audience": "Начинающие разработчики",
            "level": "beginner",
            "format": "workshop",
            "attestationForm": "Защита проекта",
        }
    )

    user_texts = [
        (
            "Создай практический курс по Python "
            "для начинающих разработчиков. "
            "В конце — защита собственного проекта."
        )
    ]

    result = await extract_brief_arguments(
        client,
        empty_course(),
        user_texts,
    )

    assert result["title"] == "Основы Python"
    assert result["audience"] == "Начинающие разработчики"
    assert result["level"] == "beginner"
    assert result["format"] == "workshop"
    assert result["attestationForm"] == "Защита проекта"

    # Пользователь не указал общий объём программы.
    assert "durationHours" not in result

    # Проверяем, что вызван именно инструмент update_brief.
    call = client.calls[0]
    assert call["tool_choice"]["function"]["name"] == "update_brief"

def test_brief_preserves_known_fields_and_asks_for_hours():
    course = empty_course()

    user_texts = [
        (
            "Создай практический курс по Python "
            "для начинающих разработчиков. "
            "В конце — защита собственного проекта."
        )
    ]

    model_arguments = {
        "title": "Основы Python",
        "audience": "Начинающие разработчики",
        "level": "beginner",
        "format": "workshop",
        "attestationForm": "Защита проекта",
    }

    output = execute_tool(
        "update_brief",
        model_arguments,
        course,
        user_texts,
    )

    assert output["type"] == "update_brief"

    updated_course = apply_patch(course, output)
    brief = updated_course.brief

    assert brief.title == "Основы Python"
    assert brief.audience == "Начинающие разработчики"
    assert brief.level == "beginner"
    assert brief.attestation_form == "Защита проекта"

    # Общий объём пользователь не указал.
    assert brief.duration_hours == 0

    missing = missing_brief_lines(updated_course)

    assert "точный объём в академических часах" in missing
    assert "аудитория" not in missing
    assert "форма итоговой аттестации" not in missing

def test_delivery_mode_does_not_override_teaching_format():
    course = empty_course()

    user_texts = [
        "Создай дистанционный практический курс по Linux "
        "для начинающих системных администраторов."
    ]

    model_arguments = {
        "title": "Основы Linux",
        "audience": "Начинающие системные администраторы",
        "level": "beginner",
        "format": "workshop",
    }

    output = execute_tool(
        "update_brief",
        model_arguments,
        course,
        user_texts,
    )

    updated_course = apply_patch(course, output)

    assert updated_course.brief.format == "workshop"

def test_completed_brief_does_not_trigger_extra_extraction():
    import asyncio

    course = empty_course()
    course.brief.title = "Основы Python"
    course.brief.audience = "Начинающие разработчики"
    course.brief.duration_hours = 24
    course.brief.program_kind = "general"
    course.brief.attestation_form = "Защита проекта"

    class CountingClient:
        api_key = "test-key"

        def __init__(self):
            self.calls = []

        async def complete(self, **kwargs):
            self.calls.append(kwargs)

            tool_choice = kwargs.get("tool_choice")
            if isinstance(tool_choice, dict):
                function = tool_choice.get("function") or {}
                tool_name = function.get("name")
            else:
                tool_name = None

            if tool_name == "update_brief":
                return {
                    "tool_calls": [
                        {
                            "function": {
                                "name": "update_brief",
                                "arguments": "{}",
                            }
                        }
                    ]
                }

            if tool_name == "set_competency_map":
                return {
                    "tool_calls": [
                        {
                            "function": {
                                "name": "set_competency_map",
                                "arguments": json.dumps({
                                    "nodes": [
                                        {
                                            "id": "c1",
                                            "name": "Пишет программы на Python",
                                            "knowledge": ["Переменные"],
                                            "skills": ["Создаёт функции"],
                                            "abilities": ["Запускает код"],
                                        }
                                    ]
                                }),
                            }
                        }
                    ]
                }

            return {"role": "assistant", "content": "Готово"}

    client = CountingClient()

    asyncio.run(
        run_turn(
            course,
            user_texts=["Собери каркас по заполненному шаблону"],
            model_messages=[
                {
                    "role": "user",
                    "content": "Собери каркас по заполненному шаблону",
                }
            ],
            client=client,
        )
    )

    brief_calls = [
        call for call in client.calls
        if isinstance(call.get("tool_choice"), dict)
        and (call["tool_choice"].get("function") or {}).get("name")
        == "update_brief"
    ]

    assert len(brief_calls) == 0, (
        f"Лишних вызовов update_brief: {len(brief_calls)}"
    )

def test_completed_brief_allows_duration_change():
    import asyncio

    course = empty_course()
    course.brief.title = "Основы Python"
    course.brief.audience = "Начинающие разработчики"
    course.brief.duration_hours = 24
    course.brief.program_kind = "general"
    course.brief.attestation_form = "Защита проекта"

    class EditingClient:
        api_key = "test-key"

        def __init__(self):
            self.brief_calls = 0

        async def complete(self, **kwargs):
            tool_choice = kwargs.get("tool_choice")
            function = (
                tool_choice.get("function") or {}
                if isinstance(tool_choice, dict)
                else {}
            )
            tool_name = function.get("name")

            if tool_name == "update_brief":
                self.brief_calls += 1
                return {
                    "role": "assistant",
                    "tool_calls": [
                        {
                            "function": {
                                "name": "update_brief",
                                "arguments": json.dumps({
                                    "durationHours": 36
                                }),
                            }
                        }
                    ],
                }

            return {
                "role": "assistant",
                "content": "Готово",
            }

    client = EditingClient()
    text = "Измени продолжительность на 36 академических часов"

    result = asyncio.run(
        run_turn(
            course,
            user_texts=[text],
            model_messages=[
                {"role": "user", "content": text}
            ],
            client=client,
        )
    )

    assert client.brief_calls == 1
    assert result["course"].brief.duration_hours == 36
    assert result["course"].brief.title == "Основы Python"
    assert result["course"].brief.audience == "Начинающие разработчики"
    assert result["course"].brief.program_kind == "general"
    assert result["course"].brief.attestation_form == "Защита проекта"

@pytest.mark.anyio
async def test_multiturn_brief_preserves_context():
    class DialogueClient:
        api_key = None

        def __init__(self):
            self.brief_calls = 0

        async def complete(self, **kwargs):
            tool_choice = kwargs.get("tool_choice", {})
            function = tool_choice.get("function", {})
            tool_name = function.get("name")

            if tool_name == "update_brief":
                self.brief_calls += 1

                if self.brief_calls == 1:
                    arguments = {
                        "title": "Основы Python",
                        "audience": "Начинающие разработчики",
                    }
                else:
                    arguments = {
                        "durationHours": 24,
                        "attestationForm": "Защита проекта",
                    }

                return {
                    "tool_calls": [
                        {
                            "function": {
                                "name": "update_brief",
                                "arguments": json.dumps(arguments),
                            }
                        }
                    ]
                }

            return {"role": "assistant", "content": "Готово"}

    client = DialogueClient()
    course = empty_course()

    first_message = (
        "Хочу разработать курс по Python "
        "для начинающих разработчиков"
    )

    first_result = await run_turn(
        course,
        user_texts=[first_message],
        model_messages=[
            {"role": "user", "content": first_message}
        ],
        client=client,
    )

    course = first_result["course"]

    assert course.brief.title == "Основы Python"
    assert course.brief.audience == "Начинающие разработчики"
    assert course.brief.duration_hours == 0

    assert "точный объём в академических часах" in missing_brief_lines(course)

    second_message = (
        "24 академических часа, "
        "итоговая аттестация — защита проекта"
    )

    second_result = await run_turn(
        course,
        user_texts=[first_message, second_message],
        model_messages=[
            {"role": "user", "content": second_message}
        ],
        client=client,
    )

    course = second_result["course"]

    assert course.brief.title == "Основы Python"
    assert course.brief.audience == "Начинающие разработчики"
    assert course.brief.duration_hours == 24
    assert course.brief.attestation_form == "Защита проекта"

    missing = missing_brief_lines(course)

    assert "точный объём в академических часах" not in missing
    assert "аудитория" not in missing
    assert "форма итоговой аттестации" not in missing

    assert client.brief_calls == 2

def test_missing_audience_does_not_repeat_known_fields():
    course = empty_course()

    course.brief.title = "Основы Python"
    course.brief.duration_hours = 24
    course.brief.program_kind = "general"
    course.brief.attestation_form = "Защита проекта"

    missing = missing_brief_lines(course)

    assert "аудитория" in missing

    assert "точный объём в академических часах" not in missing
    assert "форма итоговой аттестации" not in missing
    assert "тип программы" not in missing

def test_audience_can_be_added_without_losing_other_fields():
    course = empty_course()

    course.brief.title = "Основы Python"
    course.brief.duration_hours = 24
    course.brief.program_kind = "general"
    course.brief.attestation_form = "Защита проекта"

    text = "Курс предназначен для школьников 8–9 классов без опыта программирования"

    output = execute_tool(
        "update_brief",
        {
            "audience": "Школьники 8–9 классов без опыта программирования",
        },
        course,
        [text],
    )

    assert output.get("type") != "tool_error"

    updated = apply_patch(course, output)

    assert updated.brief.audience == "Школьники 8–9 классов без опыта программирования"
    assert updated.brief.duration_hours == 24
    assert updated.brief.title == "Основы Python"
    assert updated.brief.attestation_form == "Защита проекта"

    assert "аудитория" not in missing_brief_lines(updated)

def test_teaching_format_survives_other_brief_updates():
    course = empty_course()

    course.brief.title = "Основы Python"
    course.brief.format = "workshop"

    output = execute_tool(
        "update_brief",
        {"durationHours": 24},
        course,
        ["Продолжительность — 24 академических часа"],
    )

    assert output.get("type") != "tool_error"

    updated = apply_patch(course, output)

    assert updated.brief.format == "workshop"
    assert updated.brief.duration_hours == 24

@pytest.mark.anyio
async def test_full_course_dialogue():
    class DialogueClient:
        api_key = None

        def __init__(self):
            self.brief_calls = 0
            self.tool_calls = []

        async def complete(self, **kwargs):
            choice = kwargs.get("tool_choice") or {}
            function = choice.get("function") or {}
            name = function.get("name")

            self.tool_calls.append(name)

            if name == "update_brief":
                self.brief_calls += 1

                responses = [
                    {
                        "title": "Основы Python",
                        "audience": "Начинающие разработчики без опыта",
                    },
                    {
                        "durationHours": 24,
                        "attestationForm": "Защита проекта",
                    },
                    {
                        "programKind": "general",
                    },
                    {
                        "durationHours": 36,
                    },
                ]

                arguments = responses[self.brief_calls - 1]

                return {
                    "tool_calls": [{
                        "function": {
                            "name": "update_brief",
                            "arguments": json.dumps(arguments),
                        }
                    }]
                }

            # Для остальных инструментов модель не возвращает
            # результат: агент использует локальные механизмы.
            return {"role": "assistant", "content": None}

    client = DialogueClient()
    course = empty_course()
    history = []

    messages = [
        "Хочу разработать курс Python для начинающих разработчиков без опыта",
        "24 академических часа, итоговая аттестация — защита проекта",
        "Это общеразвивающая программа с сертификатом",
        "Собери каркас по заполненному шаблону",
        "Измени продолжительность на 36 академических часов",
    ]

    results = []

    for message in messages:
        history.append(message)

        result = await run_turn(
            course,
            user_texts=history.copy(),
            model_messages=[{"role": "user", "content": message}],
            client=client,
        )

        course = result["course"]
        results.append(result)

    assert course.brief.title == "Основы Python"
    assert course.brief.audience == "Начинающие разработчики без опыта"
    assert course.brief.duration_hours == 36
    assert course.brief.program_kind == "general"
    assert course.brief.attestation_form == "Защита проекта"

    assert results[3]["mode"] == "framework"
    assert course.competencies.nodes
    assert course.modules

    assert client.brief_calls == 4