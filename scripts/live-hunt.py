"""Острые живые пробы. Ключ не печатает."""

from __future__ import annotations

import asyncio
import importlib.util
import json
from pathlib import Path

from backend.app.agent import fill_missing_kit, run_turn
from backend.app.catalog import is_incomplete_brief, is_internship, profile_name
from backend.app.cloud import CHAT_PRO, CloudRuClient, estimate_cost_rub
from backend.app.kit_content import is_teacher_ai
from backend.app.models import empty_course
from backend.tests.test_hunt_cases import (
    H_1C,
    H_ARCHIVE,
    H_CHATGPT,
    H_EMPTY,
    H_TEACHER_GIGA,
)

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "logs" / "cases"

_OVERVIEW = importlib.util.spec_from_file_location(
    "case_overview",
    ROOT / "scripts" / "write-case-overview.py",
)
_mod = importlib.util.module_from_spec(_OVERVIEW)
assert _OVERVIEW and _OVERVIEW.loader
_OVERVIEW.loader.exec_module(_mod)
overview = _mod.overview


def _blob(course) -> str:
    return " ".join(
        [
            course.brief.title,
            *(module.title for module in course.modules),
            *(topic for module in course.modules for topic in module.topics),
        ]
    ).lower()


def _source(calls: list[dict]) -> str:
    tags = []
    for item in calls:
        if item.get("tool") != "set_structure":
            continue
        payload = item.get("input")
        if payload == "local_fallback":
            tags.append("каталог")
        elif isinstance(payload, dict) and payload.get("modules"):
            tags.append("модель")
    if "модель" in tags and "каталог" in tags:
        return "модель пустая, каталог спас"
    return tags[0] if tags else "нет плана"


CASES = [
    {
        "id": "h1",
        "file": "live-hunt-1c.json",
        "turns": [H_1C],
        "checks": [
            ("48 часов", lambda c: c.brief.duration_hours == 48),
            ("qualification", lambda c: c.brief.program_kind == "qualification"),
            ("есть модули", lambda c: bool(c.modules)),
            ("не devops", lambda c: "linux" not in _blob(c)),
        ],
    },
    {
        "id": "h2",
        "file": "live-hunt-chatgpt.json",
        "turns": [H_CHATGPT],
        "checks": [
            ("16 часов", lambda c: c.brief.duration_hours == 16),
            ("general", lambda c: c.brief.program_kind == "general"),
            ("не школьный чат-бот", lambda c: "игра или чат-бот" not in _blob(c)),
        ],
    },
    {
        "id": "h3",
        "file": "live-hunt-archive.json",
        "turns": [H_ARCHIVE],
        "checks": [
            ("стажировка", lambda c: is_internship(c)),
            ("не devops-sku", lambda c: profile_name(c) == "generic"),
            ("лекции 0", lambda c: sum(m.lecture_hours for m in c.modules) == 0),
            ("нет linux", lambda c: "linux" not in _blob(c) and "ci/cd" not in _blob(c)),
            ("2 ч аттестация", lambda c: c.brief.attestation_hours == 2),
        ],
    },
    {
        "id": "h4",
        "file": "live-hunt-empty.json",
        "turns": [H_EMPTY],
        "incomplete_first": True,
        "checks": [
            ("без часов", lambda c: c.brief.duration_hours == 0),
            ("спросила", lambda c: True),
            ("нет модулей", lambda c: not c.modules),
        ],
    },
    {
        "id": "h5",
        "file": "live-hunt-teacher-giga.json",
        "turns": [H_TEACHER_GIGA],
        "checks": [
            ("teacher_ai", lambda c: is_teacher_ai(c)),
            ("18 часов", lambda c: c.brief.duration_hours == 18),
            ("есть A/01.6", lambda c: any(n.labor_function_code == "A/01.6" for n in c.competencies.nodes)),
        ],
    },
]


async def run_case(client: CloudRuClient, spec: dict) -> dict:
    course = empty_course()
    asked = False
    last = None
    seen: list[str] = []
    before = dict(client.usage)
    for text in spec["turns"]:
        seen.append(text)
        last = await run_turn(
            course,
            user_texts=seen,
            model_messages=[{"role": "user", "content": text}],
            client=client,
        )
        course = last["course"]
        if spec.get("incomplete_first") and is_incomplete_brief(course) and not course.modules:
            asked = bool(last.get("assistant"))
            continue
        course = fill_missing_kit(course)
    usage = {
        "prompt_tokens": client.usage["prompt_tokens"] - before["prompt_tokens"],
        "completion_tokens": client.usage["completion_tokens"] - before["completion_tokens"],
        "total_tokens": client.usage["total_tokens"] - before["total_tokens"],
        "calls": client.usage["calls"] - before["calls"],
    }
    checks = []
    for title, pred in spec["checks"]:
        if title == "спросила":
            ok = asked
        else:
            try:
                ok = bool(pred(course))
            except Exception:
                ok = False
        checks.append({"name": title, "ok": ok})
    payload = {
        "id": spec["id"],
        "title": course.brief.title,
        "profile": profile_name(course),
        "assistant": (last.get("assistant") or "")[:300] if last else "",
        "source": _source(last["calls"] if last else []),
        "usage": usage,
        "cost_rub": round(estimate_cost_rub(CHAT_PRO, usage["prompt_tokens"], usage["completion_tokens"]), 4),
        "checks": checks,
        "course": course.as_api(),
        "modules": [{"title": m.title, "hours": m.hours} for m in course.modules],
    }
    path = OUT / spec["file"]
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / f"live-hunt-{spec['id']}-obzor.txt").write_text(overview(path), encoding="utf-8")
    return payload


def render(rows: list[dict], usage: dict) -> str:
    cost = estimate_cost_rub(CHAT_PRO, usage["prompt_tokens"], usage["completion_tokens"])
    lines = [
        "Острая охота за дырами",
        "=====================",
        "",
        f"Вызовы {usage['calls']}, токены {usage['total_tokens']}, около {cost:.2f} руб.",
        "",
    ]
    for row in rows:
        ok = sum(1 for item in row["checks"] if item["ok"])
        lines.append(
            f"{row['id']}. {row.get('title') or 'без названия'}: "
            f"{row['profile']}, план «{row['source']}», "
            f"{row['usage']['calls']} вызов, {row['cost_rub']:.3f} руб, "
            f"{ok}/{len(row['checks'])}"
        )
        for item in row["checks"]:
            lines.append(f"  [{'ок' if item['ok'] else 'нет'}] {item['name']}")
        titles = ", ".join(f"{m['title']} ({m['hours']} ч)" for m in row["modules"][:6])
        lines.append(f"  модули: {titles or 'пусто'}")
        lines.append("")
    return "\n".join(lines) + "\n"


async def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    client = CloudRuClient()
    rows = []
    for spec in CASES:
        row = await run_case(client, spec)
        rows.append(row)
        print(
            f"{row['id']} {row['profile']} {row['source']} "
            f"{sum(i['ok'] for i in row['checks'])}/{len(row['checks'])}"
        )
    report = render(rows, client.usage)
    (ROOT / "docs" / "proverka-ohota.txt").write_text(report, encoding="utf-8")
    (OUT / "live-hunt.json").write_text(
        json.dumps(
            {"usage": client.usage, "cases": [{k: v for k, v in row.items() if k != "course"} for row in rows]},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(report)


if __name__ == "__main__":
    asyncio.run(main())
