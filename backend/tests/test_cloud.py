import json

from backend.app.agent import (
    build_system_prompt,
    clip_references,
    course_snapshot,
    messages_for_model,
)
from backend.app.cloud import (
    CHAT_PRO,
    CHAT_REASONING,
    EMBEDDINGS,
    build_chat_payload,
    estimate_cost_rub,
    extract_json_object,
    flatten_history,
    json_tool_instructions,
    parse_assistant_message,
    payload_has_control_tokens,
    resolve_chat_model,
    sanitize,
    strip_control_tokens,
    uses_json_tools,
)
from backend.app.tools import course_tools


def test_strip_control_tokens_removes_gigachat_markers() -> None:
    raw = "начало <|function_call|>середина<|function_call_end|> конец"
    assert strip_control_tokens(raw) == "начало середина конец"
    assert "<|" not in sanitize({"text": raw})["text"]


def test_gigaschool_payload_has_no_openai_tools() -> None:
    payload = build_chat_payload(
        model="GigaChat/GigaChat-3-Pro",
        system="Ты методист.",
        messages=[
            {"role": "user", "content": "Курс по кибербезопасности на месяц"},
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "call-1",
                        "type": "function",
                        "function": {
                            "name": "update_brief",
                            "arguments": json.dumps({"title": "Кибербезопасность"}),
                        },
                    }
                ],
            },
            {
                "role": "tool",
                "tool_call_id": "call-1",
                "content": '{"type":"update_brief"}',
            },
        ],
        tools=course_tools(),
        tool_choice={"type": "function", "function": {"name": "update_brief"}},
        json_tools=True,
    )
    dumped = json.dumps(payload, ensure_ascii=False)
    assert "tools" not in payload
    assert "tool_choice" not in payload
    assert "tool_calls" not in dumped
    assert '"role": "tool"' not in dumped
    assert "<|" not in dumped
    assert "update_brief" in payload["messages"][0]["content"]
    assert payload["messages"][1]["role"] == "user"
    assert payload["messages"][2]["role"] == "assistant"
    assert json.loads(payload["messages"][2]["content"])["tool"] == "update_brief"
    assert payload["messages"][3]["role"] == "user"
    assert "Результат инструмента" in payload["messages"][3]["content"]
    assert not payload_has_control_tokens(payload)


def test_openai_compatible_payload_keeps_tools_when_requested() -> None:
    payload = build_chat_payload(
        model="openai/gpt",
        system="system",
        messages=[{"role": "user", "content": "hi"}],
        tools=course_tools(),
        json_tools=False,
    )
    assert "tools" in payload
    assert payload["tool_choice"] == "auto"


def test_parse_json_tool_from_fenced_text() -> None:
    message = parse_assistant_message(
        """```json
{"tool":"update_brief","arguments":{"title":"Кибербезопасность","durationHours":16}}
```"""
    )
    assert message["tool_calls"][0]["function"]["name"] == "update_brief"
    arguments = json.loads(message["tool_calls"][0]["function"]["arguments"])
    assert arguments["durationHours"] == 16


def test_parse_tool_lifts_questions_outside_arguments() -> None:
    message = parse_assistant_message(
        '{"tool":"set_assessment","questions":[{"stem":"q1"}]}'
    )
    arguments = json.loads(message["tool_calls"][0]["function"]["arguments"])
    assert arguments["questions"][0]["stem"] == "q1"


def test_parse_plain_reply_without_tool() -> None:
    message = parse_assistant_message("Уточните точный объём программы в академических часах.")
    assert "tool_calls" not in message
    assert "точный объём" in message["content"]


def test_extract_json_ignores_control_tokens() -> None:
    parsed = extract_json_object('<|function_call|>{"tool":"set_mode","arguments":{"mode":"plan"}}')
    assert parsed == {"tool": "set_mode", "arguments": {"mode": "plan"}}


def test_flatten_history_merges_consecutive_user_results() -> None:
    history = flatten_history(
        [
            {"role": "user", "content": "Собери программу"},
            {"role": "tool", "content": '{"ok":true}'},
        ]
    )
    assert len(history) == 1
    assert history[0]["role"] == "user"
    assert "Собери программу" in history[0]["content"]
    assert "Результат инструмента" in history[0]["content"]


def test_hub_url_uses_json_tools() -> None:
    assert uses_json_tools("https://hub.gigaschool.ru/api/v1/llm/v1")
    assert not uses_json_tools("https://foundation-models.api.cloud.ru/v1")


def test_references_and_history_stay_small() -> None:
    long_ref = "абзац про чужой 24-часовой интенсив\n" * 200
    clipped = clip_references(long_ref)
    assert len(clipped) < 1000
    assert "24-часовой" in clipped
    messages = messages_for_model(["первый запрос", "уточнение", "ещё одно"])
    assert len(messages) == 1
    assert "первый запрос" not in messages[0]["content"]
    assert "уточнение" in messages[0]["content"]


def test_step_prompt_does_not_ship_the_whole_course() -> None:
    from backend.app.models import empty_course

    course = empty_course()
    step = {
        "kind": "tool",
        "tool": "update_brief",
        "task": "Перенеси только явно названные поля брифа.",
    }
    snapshot = course_snapshot(course, step)
    assert "competencies" not in snapshot
    prompt = build_system_prompt(course, step, "x" * 8000)
    payload = build_chat_payload(
        model="GigaChat/GigaChat-3-Pro",
        system=prompt,
        messages=messages_for_model(["Нужна общеразвивающая программа на 16 часов"]),
        tools=course_tools(),
        tool_choice={"type": "function", "function": {"name": "update_brief"}},
        json_tools=True,
        max_tokens=280,
    )
    dumped = json.dumps(payload, ensure_ascii=False)
    assert payload["max_tokens"] == 280
    assert len(dumped) < 3500


def test_structure_instruction_does_not_teach_empty_arguments() -> None:
    text = json_tool_instructions(
        course_tools(),
        {"type": "function", "function": {"name": "set_structure"}},
    )
    assert "set_structure" in text
    assert "Пустой arguments нельзя" in text
    assert '"arguments":{}' not in text


def test_gigaschool_only_chat_models_are_used() -> None:
    assert resolve_chat_model("") == CHAT_PRO
    assert resolve_chat_model("ai-sage/GigaChat3-10B-A1.8B") == CHAT_PRO
    assert resolve_chat_model(EMBEDDINGS) == CHAT_PRO
    assert resolve_chat_model(CHAT_REASONING) == CHAT_REASONING
    figment = estimate_cost_rub(CHAT_PRO, 1654, 11)
    assert 0.11 < figment < 0.13
    assert estimate_cost_rub(CHAT_REASONING, 1654, 11) > figment
