from __future__ import annotations

import asyncio
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
RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})
RETRY_ATTEMPTS = 3


def attempts_label(count: int) -> str:
    word = "попытки" if count % 10 == 1 and count % 100 != 11 else "попыток"
    return f"Шлюз не ответил после {count} {word}."


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


def configured(name: str) -> str:
    """Пустая переменная процесса не подменяется значением из файла .env."""
    if name in os.environ:
        return os.environ[name].strip()
    return _env_file().get(name, "").strip()


def resolve_llm_gateway() -> tuple[str, str]:
    """Выбирает разрешённый LLM-шлюз и соответствующий ему ключ.

    Приоритет у Cloud.ru. Если он не настроен, используется GigaSchool.
    Посторонние адреса отклоняются до HTTP-запроса.
    """
    cloudru_key = configured("CLOUDRU_API_KEY")
    gigaschool_key = configured("GIGASCHOOL_API_KEY")

    if cloudru_key:
        cloudru_url = (
            configured("CLOUDRU_BASE_URL")
            or "https://foundation-models.api.cloud.ru/v1"
        )
        validated_url = validate_llm_endpoint(cloudru_url)

        if validated_url != "https://foundation-models.api.cloud.ru/v1":
            raise ValueError(
                "Для CLOUDRU_API_KEY разрешён только шлюз Cloud.ru."
            )

        return cloudru_key, validated_url

    if gigaschool_key:
        gigaschool_url = (
            configured("GIGASCHOOL_BASE_URL")
            or "https://hub.gigaschool.ru/api/v1/llm/v1"
        )
        validated_url = validate_llm_endpoint(gigaschool_url)

        if validated_url != "https://hub.gigaschool.ru/api/v1/llm/v1":
            raise ValueError(
                "Для GIGASCHOOL_API_KEY разрешён только шлюз GigaSchool."
            )

        return gigaschool_key, validated_url

    return "", validate_llm_endpoint(
        "https://foundation-models.api.cloud.ru/v1")


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
        "temperature": 0,
        "max_tokens": max(16, min(int(max_tokens), 4096)),
    }
    if not json_tools:
        payload["tools"] = tools
        payload["tool_choice"] = tool_choice
    return sanitize(payload)


def payload_has_control_tokens(payload: dict[str, Any]) -> bool:
    return bool(CONTROL_TOKEN.search(json.dumps(payload, ensure_ascii=False)))


class TurnStopped(Exception):
    """Методист остановил ход, пока он стоял в очереди или шёл в воркере."""


class CloudRuClient:
    def __init__(self) -> None:
        self.api_key, base_url = resolve_llm_gateway()
        self.base_url = base_url.rstrip("/")
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
        self.gateway_retries: list[int] = []
        self.gate = None

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
        timeout: float = 180,
        attempts: int | None = None,
    ) -> dict[str, Any]:
        if not self.api_key:
            raise RuntimeError(
                "Не задан CLOUDRU_API_KEY или GIGASCHOOL_API_KEY. "
                "Разрешены только шлюзы Cloud.ru и GigaSchool. "
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
        gate = self.gate
        if gate is not None:
            gate.enter()
        try:
            return await self._complete_request(
                payload=payload,
                timeout=timeout,
                attempts=attempts,
                gate=gate,
            )
        finally:
            if gate is not None:
                gate.leave()

    async def _complete_request(
        self,
        *,
        payload: dict[str, Any],
        timeout: float,
        attempts: int | None,
        gate: Any,
    ) -> dict[str, Any]:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        total_attempts = RETRY_ATTEMPTS if attempts is None else max(1, attempts)
        for attempt in range(total_attempts):
            try:
                async with httpx.AsyncClient(timeout=timeout, trust_env=False) as client:
                    response = await client.post(
                        f"{self.base_url}/chat/completions",
                        headers=headers,
                        json=payload,
                    )
            except (httpx.TimeoutException, httpx.TransportError) as error:
                if attempt + 1 < total_attempts:
                    self.gateway_retries.append(attempt + 2)
                    await asyncio.sleep(0.4 * (2 ** attempt))
                    continue
                raise RuntimeError(attempts_label(total_attempts)) from error
            status = getattr(response, "status_code", 500 if response.is_error else 200)
            if status in RETRY_STATUSES and attempt + 1 < total_attempts:
                self.gateway_retries.append(attempt + 2)
                await asyncio.sleep(0.4 * (2 ** attempt))
                continue
            if status in RETRY_STATUSES:
                raise RuntimeError(attempts_label(total_attempts))
            if response.is_error:
                raise RuntimeError(f"HTTP {status}")
            data = response.json()
            usage = data.get("usage")
            self.add_usage(usage)
            if gate is not None:
                prompt = int((usage or {}).get("prompt_tokens") or 0)
                completion = int((usage or {}).get("completion_tokens") or 0)
                total = int((usage or {}).get("total_tokens") or (prompt + completion))
                gate.charge(total)
            choices = data.get("choices") or []
            if not choices:
                raise RuntimeError("Шлюз вернул ответ без списка вариантов.")
            message = dict(choices[0]["message"])
            if not str(message.get("content") or "").strip() and message.get("reasoning"):
                message["content"] = message.get("reasoning")
            if self.json_tools and not message.get("tool_calls"):
                return parse_assistant_message(message.get("content"))
            return sanitize(message)
        raise RuntimeError(attempts_label(total_attempts))
