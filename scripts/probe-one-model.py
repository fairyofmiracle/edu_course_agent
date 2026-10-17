"""One live completion. Prints shape, not secrets."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]


def load_env() -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("\"'")
    return values


def main() -> int:
    env = load_env()
    model = sys.argv[1] if len(sys.argv) > 1 else "GigaChat/GigaChat-3-Pro"
    prompt = sys.argv[2] if len(sys.argv) > 2 else "Ответь одним словом: ок"
    api_key = env.get("OPENAI_API_KEY") or env.get("CLOUDRU_API_KEY")
    base = (env.get("OPENAI_BASE_URL") or env.get("CLOUDRU_BASE_URL") or "").rstrip("/")
    response = httpx.post(
        f"{base}/chat/completions",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 80,
            "temperature": 0,
        },
        timeout=90,
        trust_env=False,
    )
    print(f"model={model} http={response.status_code}")
    if response.is_error:
        print(response.text[:300])
        return 1
    data = response.json()
    choice = (data.get("choices") or [{}])[0]
    message = choice.get("message") or {}
    print("choice_keys=" + ",".join(choice.keys()))
    print("message_keys=" + ",".join(message.keys()))
    print("finish=" + str(choice.get("finish_reason")))
    print("content=" + json.dumps(message.get("content"), ensure_ascii=False)[:300])
    extra = {key: message.get(key) for key in message if key != "content"}
    if extra:
        print("message_extra=" + json.dumps(extra, ensure_ascii=False)[:400])
    print("usage=" + json.dumps(data.get("usage") or {}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
