"""Cheap live check of the hackathon LLM gateway. Does not print secrets."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]


def load_env() -> dict[str, str]:
    values: dict[str, str] = {}
    env_file = ROOT / ".env"
    if env_file.exists():
        for raw in env_file.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip("\"'")
    return values


def setting(env: dict[str, str], name: str, default: str = "") -> str:
    import os

    return os.getenv(name) or env.get(name, default)


def main() -> int:
    env = load_env()
    api_key = setting(env, "OPENAI_API_KEY") or setting(env, "CLOUDRU_API_KEY")
    base_url = (
        setting(env, "OPENAI_BASE_URL")
        or setting(env, "CLOUDRU_BASE_URL", "https://hub.gigaschool.ru/api/v1/llm/v1")
    ).rstrip("/")
    model = (
        setting(env, "CLOUDRU_MODEL_WRITER")
        or setting(env, "CLOUDRU_MODEL")
        or "GigaChat/GigaChat-3-Pro"
    )
    if not api_key:
        print("Нет OPENAI_API_KEY / CLOUDRU_API_KEY. Добавьте ключ в .env, не в чат.")
        return 2

    print(f"base={base_url}")
    print(f"model={model}")
    print(f"key=set({len(api_key)} chars)")

    response = httpx.post(
        f"{base_url}/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "messages": [{"role": "user", "content": "Ответь одним словом: ок"}],
            "max_tokens": 16,
            "temperature": 0,
        },
        timeout=60,
        trust_env=False,
    )
    print(f"http={response.status_code}")
    if response.is_error:
        print(response.text[:400])
        return 1

    data = response.json()
    message = ((data.get("choices") or [{}])[0].get("message") or {}).get("content")
    usage = data.get("usage") or {}
    print(f"reply={json.dumps(message, ensure_ascii=False)[:120]}")
    if usage:
        print(
            "usage="
            f"prompt={usage.get('prompt_tokens')} "
            f"completion={usage.get('completion_tokens')} "
            f"total={usage.get('total_tokens')}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
