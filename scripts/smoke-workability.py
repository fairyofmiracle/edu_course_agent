"""Проверка живых маршрутов API. Ключ в stdout не печатает."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from backend.tests.test_domain import fixture_course
from backend.tests.test_open_cases import CASE1, CASE4

BASE = "http://127.0.0.1:8000"


def call(method: str, path: str, body: dict | None = None, timeout: int = 40) -> tuple[int, object]:
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode()
    request = urllib.request.Request(
        BASE + path,
        data=data,
        headers={"Content-Type": "application/json"} if body is not None else {},
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
            return response.status, json.loads(raw.decode()) if raw else {}
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode()[:400]


def ok(name: str, status: int, cond: bool, extra: str = "") -> None:
    mark = "PASS" if status < 400 and cond else "FAIL"
    print(f"{mark} {name} http={status} {extra}".rstrip())


def main() -> int:
    failed = 0

    status, health = call("GET", "/health")
    ok("health", status, health.get("status") == "ok")
    failed += status != 200

    status, policy = call("GET", "/api/regulatory/policy")
    ok("regulatory.policy", status, bool(policy.get("rules")))
    failed += status != 200

    status, probe = call(
        "POST",
        "/api/sources/probe",
        {"urls": ["https://publication.pravo.gov.ru/document/0001202209270013"]},
    )
    ok("sources.probe", status, bool(probe.get("results")))
    failed += status != 200

    status, stack = call("POST", "/api/stack/freshness", {"texts": ["Python 3.12 и Node.js 20"]})
    ok("stack.freshness", status, stack.get("state") in {"ready", "empty"})
    failed += status != 200

    course = fixture_course().as_api()
    status, audit = call("POST", "/api/audit", course)
    summary = (audit.get("summary") or {}) if isinstance(audit, dict) else {}
    ok("audit", status, "fail" in summary, f"summary={summary}")
    failed += status != 200

    course_id = "smoke-workability"
    course["id"] = course_id
    status, saved = call("PUT", f"/api/courses/{course_id}", {"course": course, "reason": "smoke"})
    ok("courses.save", status, saved.get("id") == course_id if isinstance(saved, dict) else False)
    failed += status != 200

    status, listed = call("GET", "/api/courses")
    ids = {item.get("id") for item in (listed.get("courses") or [])} if isinstance(listed, dict) else set()
    ok("courses.list", status, course_id in ids)
    failed += status != 200

    status, loaded = call("GET", f"/api/courses/{course_id}")
    ok("courses.load", status, loaded.get("id") == course_id if isinstance(loaded, dict) else False)
    failed += status != 200

    status, versions = call("GET", f"/api/courses/{course_id}/versions")
    ok("courses.versions", status, bool((versions.get("versions") if isinstance(versions, dict) else None)))
    failed += status != 200

    status, copied = call("POST", f"/api/courses/{course_id}/copy")
    copy_id = copied.get("id") if isinstance(copied, dict) else None
    ok("courses.copy", status, bool(copy_id) and copy_id != course_id)
    failed += status != 200

    status, _ = call("DELETE", f"/api/courses/{course_id}")
    ok("courses.delete", status, status == 200)
    failed += status != 200
    if copy_id:
        call("DELETE", f"/api/courses/{copy_id}")

    status, chat = call(
        "POST",
        "/api/chat/turn",
        {
            "course": fixture_course().as_api(),
            "userTexts": ["Собери комплект"],
            "messages": [{"role": "user", "content": "Собери комплект"}],
        },
        timeout=120,
    )
    ok(
        "chat.turn",
        status,
        isinstance(chat, dict) and bool(chat.get("course")),
        f"mode={chat.get('mode') if isinstance(chat, dict) else chat}",
    )
    failed += status != 200

    status, run = call(
        "POST",
        "/api/run",
        {"request": CASE1, "autoApprove": True, "caseId": 1},
        timeout=240,
    )
    if isinstance(run, dict):
        brief = (run.get("course") or {}).get("brief") or {}
        questions = sum(len(item.get("questions") or []) for item in (run.get("course") or {}).get("assessments") or [])
        audit_sum = ((run.get("report") or {}).get("audit") or {}).get("summary") or {}
        extra = (
            f"hours={brief.get('durationHours')} questions={questions} "
            f"audit={audit_sum} usage={run.get('usage')}"
        )
        good = brief.get("durationHours") == 16 and questions >= 10
    else:
        extra = str(run)[:200]
        good = False
    ok("run.case1", status, good, extra)
    failed += not good

    status, incomplete = call(
        "POST",
        "/api/run",
        {"request": CASE4, "autoApprove": False},
        timeout=180,
    )
    if isinstance(incomplete, dict):
        asked = bool((incomplete.get("report") or {}).get("askedQuestions")) or not (
            incomplete.get("course") or {}
        ).get("modules")
        extra = f"asked={asked} assistant={(incomplete.get('transcript') or [{}])[0].get('assistant', '')[:80]}"
    else:
        extra = str(incomplete)[:200]
        asked = False
    ok("run.case4.questions", status, asked, extra)
    failed += not asked

    print("FAILED" if failed else "ALL_OK", failed)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
