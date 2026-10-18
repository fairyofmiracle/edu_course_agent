from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx

ROOT_ENV = Path(__file__).parents[2] / ".env"
CONTROL_TOKEN = re.compile(r"<\|[^|<>]{0,80}\|>")
FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL | re.IGNORECASE)

# Официальный список GigaSchool. Третье имя — эмбеддинги, не чат.
CHAT_PRO = "GigaChat/GigaChat-3-Pro"
CHAT_REASONING = "ai-sage/GigaChat3.5-432B-A28B-Reasoning"
EMBEDDINGS = "ai-sage/Giga-Embeddings-instruct-3B"
# Вход / выход, ₽ за 1 млн токенов — как в кабинете команды.
PRICE_PER_MILLION = {
    CHAT_PRO: (73.03, 176.39),
    CHAT_REASONING: (96.22, 288.60),
    EMBEDDINGS: (32.22, 0.0),
}



ALLOWED_LLM_ENDPOINTS = frozenset({
    "https://foundation-models.api.cloud.ru/v1",
    "https://hub.gigaschool.ru/api/v1/llm/v1",
})


def validate_llm_endpoint(value: str) -> str:
    try:
        url = urlsplit(value.strip())
        port = url.port
    except ValueError as exc:
        raise ValueError("Некорректный адрес LLM API") from exc

    if (
        url.scheme != "https"
        or not url.hostname
        or url.username is not None
        or url.password is not None
        or port is not None
        or url.query
        or url.fragment
    ):
        raise ValueError("Недопустимый адрес LLM API")

    normalized = (
        f"https://{url.hostname}{url.path.rstrip('/')}"
    )

    if normalized not in ALLOWED_LLM_ENDPOINTS:
        raise ValueError(
            f"LLM API запрещён политикой проекта: {url.hostname}"
        )

    return normalized


def _env_file() -> dict[str, str]:
    if not ROOT_ENV.exists():
        return {}
    values: dict[str, str] = {}
    for raw in ROOT_ENV.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("\"'")
    return values


def setting(name: str, default: str = "") -> str:
    return os.getenv(name) or _env_file().get(name, default)


def resolve_chat_model(name: str, fallback: str = CHAT_PRO) -> str:
    cleaned = (name or "").strip() or fallback
    lowered = cleaned.lower()
    if "10b" in lowered or "embed" in lowered:
        return fallback
    return cleaned


def estimate_cost_rub(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    prompt_price, completion_price = PRICE_PER_MILLION.get(model, PRICE_PER_MILLION[CHAT_PRO])
    return (prompt_tokens * prompt_price + completion_tokens * completion_price) / 1_000_000


def strip_control_tokens(value: str) -> str:
    return CONTROL_TOKEN.sub("", value)


def sanitize(value: Any) -> Any:
    if isinstance(value, str):
        return strip_control_tokens(value)
    if isinstance(value, list):
        return [sanitize(item) for item in value]
    if isinstance(value, dict):
        return {key: sanitize(item) for key, item in value.items()}
    return value


def uses_json_tools(base_url: str) -> bool:
    host = base_url.lower()
    return "gigaschool" in host or "hub.gigaschool" in host


def _tool_names(tools: list[dict[str, Any]]) -> list[str]:
    names: list[str] = []
    for tool in tools:
        name = ((tool.get("function") or {}).get("name") or "").strip()
        if name:
            names.append(name)
    return names


def json_tool_instructions(tools: list[dict[str, Any]], tool_choice: str | dict[str, Any]) -> str:
    forced_name = ""
    if isinstance(tool_choice, dict):
        forced_name = ((tool_choice.get("function") or {}).get("name") or "").strip()
    name = forced_name or ((_tool_names(tools) or ["update_brief"])[0])
    if tool_choice == "none":
        return "Ответь обычным коротким текстом, без JSON."
    hints = {
        "update_brief": "programKind только general или qualification",
        "set_competency_map": 'nodes: [{id,name,knowledge,skills,abilities}]',
        "set_structure": (
            "arguments.modules обязательно заполнить: "
            "[{id,title,hours,lectureHours,practiceHours,topics,learningOutcomes,competencyIds}]. "
            "Сумма hours равна объёму минус аттестация. Пустой modules нельзя."
        ),
        "set_assessment": "questions: [{type:mcq,stem,options,answer,explanation,competencyId,learningOutcome}]",
        "set_lecture": "durationMin, outline, slides: [{title,bullets}]",
    }
    hint = hints.get(name, "")
    return (
        f'Ответь одним JSON: {{"tool":"{name}","arguments":{{...}}}}. {hint} '
        "Поля arguments заполни по запросу. Пустой arguments нельзя."
    ).strip()


def flatten_history(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    flattened: list[dict[str, Any]] = []
    for message in messages:
        role = message.get("role")
        if role == "tool":
            flattened.append(
                {
                    "role": "user",
                    "content": f"Результат инструмента:\n{message.get('content') or ''}",
                }
            )
            continue
        if role == "assistant":
            content = message.get("content")
            if not isinstance(content, str) or not content.strip():
                calls = message.get("tool_calls") or []
                if calls:
                    function = (calls[0] or {}).get("function") or {}
                    raw_arguments = function.get("arguments") or "{}"
                    try:
                        arguments = (
                            json.loads(raw_arguments)
                            if isinstance(raw_arguments, str)
                            else raw_arguments
                        )
                    except json.JSONDecodeError:
                        arguments = {}
                    content = json.dumps(
                        {"tool": function.get("name"), "arguments": arguments},
                        ensure_ascii=False,
                    )
                else:
                    content = ""
            flattened.append({"role": "assistant", "content": str(content)})
            continue
        if role == "user":
            flattened.append({"role": "user", "content": str(message.get("content") or "")})
    merged: list[dict[str, Any]] = []
    for message in flattened:
        if merged and merged[-1]["role"] == message["role"] == "user":
            merged[-1]["content"] = (
                f"{merged[-1]['content']}\n\n{message['content']}"
            ).strip()
            continue
        merged.append(message)
    return sanitize(merged)


def extract_json_object(text: str) -> dict[str, Any] | None:
    cleaned = strip_control_tokens(text or "").strip()
    if not cleaned:
        return None
    fenced = FENCE.findall(cleaned)
    candidates = [*fenced, cleaned]
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if 0 <= start < end:
        candidates.append(cleaned[start : end + 1])
    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    return None


def parse_assistant_message(content: str | None) -> dict[str, Any]:
    text = strip_control_tokens(content or "").strip()
    parsed = extract_json_object(text)
    if parsed and isinstance(parsed.get("tool"), str) and parsed["tool"].strip():
        arguments = parsed.get("arguments")
        if not isinstance(arguments, dict):
            arguments = {}
        for key, value in parsed.items():
            if key not in {"tool", "arguments"} and key not in arguments:
                arguments[key] = value
        return {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": "json-tool",
                    "type": "function",
                    "function": {
                        "name": parsed["tool"].strip(),
                        "arguments": json.dumps(arguments, ensure_ascii=False),
                    },
                }
            ],
        }
    return {"role": "assistant", "content": text}


def build_chat_payload(
    *,
    model: str,
    system: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    tool_choice: str | dict[str, Any] = "auto",
    json_tools: bool = True,
    max_tokens: int = 400,
) -> dict[str, Any]:
    system_text = strip_control_tokens(system)
    if json_tools:
        system_text = f"{system_text}\n\n{json_tool_instructions(tools, tool_choice)}"
    payload: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_text},
            *flatten_history(messages),
        ],
        "temperature": 0.2,
        "max_tokens": max(16, min(int(max_tokens), 1600)),
    }
    if not json_tools:
        payload["tools"] = tools
        payload["tool_choice"] = tool_choice
    return sanitize(payload)


def payload_has_control_tokens(payload: dict[str, Any]) -> bool:
    return bool(CONTROL_TOKEN.search(json.dumps(payload, ensure_ascii=False)))


class CloudRuClient:
    def __init__(self) -> None:
        self.api_key = setting("OPENAI_API_KEY") or setting("CLOUDRU_API_KEY")
        self.base_url = validate_llm_endpoint(
            setting("OPENAI_BASE_URL")
            or setting(
                "CLOUDRU_BASE_URL", "https://foundation-models.api.cloud.ru/v1"
            )
        ).rstrip("/")
        self.model_writer = resolve_chat_model(
            setting("CLOUDRU_MODEL_WRITER") or setting("CLOUDRU_MODEL") or CHAT_PRO
        )
        self.model_fast = resolve_chat_model(setting("CLOUDRU_MODEL") or self.model_writer)
        self.model = self.model_writer
        self.json_tools = uses_json_tools(self.base_url)
        self.token_budget = int(setting("LLM_TOKEN_BUDGET") or "25000")
        self.usage = {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
            "calls": 0,
        }

    def add_usage(self, usage: dict[str, Any] | None) -> None:
        data = usage or {}
        prompt = int(data.get("prompt_tokens") or 0)
        completion = int(data.get("completion_tokens") or 0)
        total = int(data.get("total_tokens") or (prompt + completion))
        self.usage["prompt_tokens"] += prompt
        self.usage["completion_tokens"] += completion
        self.usage["total_tokens"] += total
        self.usage["calls"] += 1

    def budget_left(self) -> bool:
        return self.usage["total_tokens"] < self.token_budget

    async def complete(
        self,
        *,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        tool_choice: str | dict[str, Any] = "auto",
        max_tokens: int = 400,
        model: str | None = None,
    ) -> dict[str, Any]:
        if not self.api_key:
            raise RuntimeError(
                "OPENAI_API_KEY или CLOUDRU_API_KEY не задан. "
                "Офлайн-пример и проверки доступны без модели."
            )
        if not self.budget_left():
            raise RuntimeError(
                f"Достигнут лимит токенов {self.token_budget}. Запрос к модели не отправлен."
            )
        payload = build_chat_payload(
            model=model or self.model,
            system=system,
            messages=messages,
            tools=tools,
            tool_choice=tool_choice,
            json_tools=self.json_tools,
            max_tokens=max_tokens,
        )
        if payload_has_control_tokens(payload):
            raise RuntimeError("В запрос модели попали служебные токены. Запрос не отправлен.")
        async with httpx.AsyncClient(timeout=180, trust_env=False) as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
        if response.is_error:
            detail = response.text[:400]
            raise RuntimeError(f"Cloud.ru {response.status_code}: {detail}")
        data = response.json()
        self.add_usage(data.get("usage"))
        choices = data.get("choices") or []
        if not choices:
            raise RuntimeError(f"Cloud.ru вернул ответ без choices: {json.dumps(data)[:500]}")
        message = dict(choices[0]["message"])
        if not str(message.get("content") or "").strip() and message.get("reasoning"):
            message["content"] = message.get("reasoning")
        if self.json_tools and not message.get("tool_calls"):
            return parse_assistant_message(message.get("content"))
        return sanitize(message)
