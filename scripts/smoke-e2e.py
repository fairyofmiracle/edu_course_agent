from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "course-contract.json"
DEFAULT_BASE = os.environ.get("SMOKE_BASE", "http://127.0.0.1:8000/backend").rstrip("/")


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


def studio_token(env: dict[str, str]) -> str:
    return (os.environ.get("STUDIO_API_TOKEN") or env.get("STUDIO_API_TOKEN") or "").strip()


def call(
    method: str,
    path: str,
    *,
    token: str,
    body: dict | None = None,
    timeout: int = 60,
) -> tuple[int, object, dict[str, str]]:
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    headers: dict[str, str] = {}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(
        DEFAULT_BASE + path,
        data=data,
        headers=headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
            hdrs = {k.lower(): v for k, v in response.headers.items()}
            ct = hdrs.get("content-type", "")
            if "json" in ct:
                return response.status, json.loads(raw.decode("utf-8") or "{}"), hdrs
            return (
                response.status,
                {"bytes": len(raw), "content_type": ct},
                hdrs,
            )
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")[:400]
        try:
            payload: object = json.loads(raw)
        except json.JSONDecodeError:
            payload = raw
        return error.code, payload, {}
    except Exception as error:  # noqa: BLE001 — smoke prints and exits
        return 0, str(error), {}


def ok(name: str, status: int, cond: bool, extra: str = "") -> bool:
    mark = "PASS" if status and status < 400 and cond else "FAIL"
    print(f"{mark} {name} http={status} {extra}".rstrip())
    return mark == "PASS"


def main() -> int:
    """Узкий smoke работоспособности: health → brief → export.

    Логин в продукте — заглушка на будущее: не обязателен и не блокирует путь.
    STUDIO_API_TOKEN нужен только чтобы открыть /api через web-прокси (не UI-auth).
    """
    env = load_env()
    token = studio_token(env)
    failed = 0

    status, health, _ = call("GET", "/health", token=token)
    health_ok = isinstance(health, dict) and health.get("status") == "ok"
    if not ok(
        "health",
        status,
        health_ok and isinstance(health, dict) and "llmConfigured" in health,
        (
            f"llmConfigured={health.get('llmConfigured')}"
            if isinstance(health, dict)
            else str(health)[:120]
        ),
    ):
        failed += 1

    # Optional stub — must not gate the rest of the smoke.
    status, session, _ = call(
        "POST",
        "/api/auth/login",
        token=token,
        body={"email": "smoke@local", "password": "unused", "role": "author"},
    )
    stub_ok = (
        isinstance(session, dict)
        and session.get("stub") is True
        and bool(session.get("token"))
    )
    ok(
        "auth.login.stub_optional",
        status,
        stub_ok,
        "stub JWT (не gate)",
    )

    if not FIXTURE.is_file():
        print(f"FAIL brief.fixture missing={FIXTURE}")
        return 1
    course = json.loads(FIXTURE.read_text(encoding="utf-8"))
    brief = course.get("brief") or {}
    brief_ok = bool(brief.get("title")) and brief.get("durationHours") is not None
    if not ok(
        "brief.fixture",
        200 if brief_ok else 0,
        brief_ok,
        (
            f"title={brief.get('title')!r} hours={brief.get('durationHours')} "
            f"modules={len(course.get('modules') or [])}"
        ),
    ):
        failed += 1

    # Server-side check that brief/course is accepted (audit does not need LLM).
    status, audit, _ = call("POST", "/api/audit", token=token, body=course, timeout=90)
    summary = (audit.get("summary") if isinstance(audit, dict) else None) or {}
    if not ok(
        "brief.audit",
        status,
        isinstance(audit, dict) and "fail" in summary,
        f"summary={summary}",
    ):
        failed += 1

    status, exported, _ = call("POST", "/api/export/json", token=token, body=course)
    title = (
        ((exported.get("brief") or {}).get("title") if isinstance(exported, dict) else None)
    )
    if not ok(
        "export.json",
        status,
        isinstance(exported, dict) and title == brief.get("title"),
        f"title={title!r}",
    ):
        failed += 1

    status, docx, hdrs = call("POST", "/api/export/docx", token=token, body=course)
    export_flag = hdrs.get("x-studio-export", "")
    bytes_n = docx.get("bytes") if isinstance(docx, dict) else 0
    if not ok(
        "export.docx",
        status,
        isinstance(docx, dict) and int(bytes_n or 0) > 1000,
        f"bytes={bytes_n} X-Studio-Export={export_flag or 'n/a'}",
    ):
        failed += 1

    print("FAILED" if failed else "ALL_OK", failed)
    print(f"base={DEFAULT_BASE} token={'set' if token else 'missing'}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
