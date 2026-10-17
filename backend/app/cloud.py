from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import httpx

ROOT_ENV = Path(__file__).parents[2] / ".env"


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


def normalize_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for message in messages:
        role = message.get("role")
        if role not in {"user", "assistant", "tool"}:
            continue
        clean = dict(message)
        if role == "assistant" and isinstance(clean.get("tool_calls"), list):
            clean["tool_calls"] = clean["tool_calls"][:1]
        if role == "user" and normalized and normalized[-1]["role"] == "user":
            normalized[-1]["content"] = (
                f"{normalized[-1].get('content', '')}\n\n{clean.get('content', '')}"
            ).strip()
            continue
        normalized.append(clean)
    return normalized


class CloudRuClient:
    def __init__(self) -> None:
        self.api_key = setting("OPENAI_API_KEY") or setting("CLOUDRU_API_KEY")
        self.base_url = (
            setting("OPENAI_BASE_URL")
            or setting(
                "CLOUDRU_BASE_URL", "https://foundation-models.api.cloud.ru/v1"
            )
        ).rstrip("/")
        self.model = setting("CLOUDRU_MODEL_WRITER") or setting(
            "CLOUDRU_MODEL", "GigaChat/GigaChat-3-Pro"
        )

    async def complete(
        self,
        *,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        tool_choice: str | dict[str, Any] = "auto",
    ) -> dict[str, Any]:
        if not self.api_key:
            raise RuntimeError(
                "OPENAI_API_KEY или CLOUDRU_API_KEY не задан. "
                "Офлайн-пример и проверки доступны без модели."
            )
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                *normalize_messages(messages),
            ],
            "tools": tools,
            "tool_choice": tool_choice,
            "temperature": 0.2,
        }
        async with httpx.AsyncClient(timeout=180) as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
        if response.is_error:
            detail = response.text[:1000]
            raise RuntimeError(f"Cloud.ru {response.status_code}: {detail}")
        data = response.json()
        choices = data.get("choices") or []
        if not choices:
            raise RuntimeError(f"Cloud.ru вернул ответ без choices: {json.dumps(data)[:500]}")
        return choices[0]["message"]
