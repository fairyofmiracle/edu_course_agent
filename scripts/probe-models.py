"""Live probe of allowed models. Does not print secrets."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.app.cloud import resolve_llm_gateway

CANDIDATES = (
    "GigaChat/GigaChat-3-Pro",
    "ai-sage/GigaChat3.5-432B-A28B-Reasoning",
    "ai-sage/Giga-Embeddings-instruct-3B",
)


def load_env() -> dict[str, str]:
    values: dict[str, str] = {}
    env_file = ROOT / ".env"
    if not env_file.exists():
        return values
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
    try:
        api_key, base_url = resolve_llm_gateway()
    except ValueError as error:
        print(f"Ошибка настройки LLM: {error}")
        return 2
    configured = [
        setting(env, "CLOUDRU_MODEL"),
        setting(env, "CLOUDRU_MODEL_WRITER"),
    ]
    if not api_key:
        print("Нет ключа в .env")
        return 2
    print(f"base={base_url}")
    print(f"key=set({len(api_key)} chars)")
    print(f"env_models={configured}")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    with httpx.Client(timeout=60, trust_env=False) as client:
        listed = client.get(f"{base_url}/models", headers=headers)
        print(f"GET /models http={listed.status_code}")
        names: list[str] = []
        if listed.is_success:
            body = listed.json()
            rows = body.get("data") if isinstance(body, dict) else body
            if isinstance(rows, list):
                for row in rows:
                    if isinstance(row, dict) and row.get("id"):
                        names.append(str(row["id"]))
            print("listed=" + ", ".join(names[:40] or ["<empty>"]))
            if len(names) > 40:
                print(f"listed_more={len(names) - 40}")
        else:
            print(listed.text[:300])

        probe = list(dict.fromkeys([*configured, *names[:12], *CANDIDATES]))
        probe = [name for name in probe if name]
        print(f"probe_count={len(probe)}")
        for model in probe:
            response = client.post(
                f"{base_url}/chat/completions",
                headers=headers,
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": "Ответь одним словом: ок"}],
                    "max_tokens": 16,
                    "temperature": 0,
                },
            )
            usage = {}
            reply = ""
            if response.is_success:
                data = response.json()
                usage = data.get("usage") or {}
                reply = str(
                    ((data.get("choices") or [{}])[0].get("message") or {}).get(
                        "content"
                    )
                    or ""
                )[:40]
                print(
                    f"OK  {model}  total={usage.get('total_tokens')}  reply={reply!r}"
                )
            else:
                detail = response.text.replace("\n", " ")[:180]
                print(f"ERR {model}  http={response.status_code}  {detail}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
