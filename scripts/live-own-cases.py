"""Прогон своих кейсов через Pro. Ключ в чат не печатает."""

from __future__ import annotations

import asyncio
import importlib.util
import json
from pathlib import Path

from backend.app.agent import fill_missing_kit, run_turn
from backend.app.catalog import is_incomplete_brief, profile_name
from backend.app.cloud import CHAT_PRO, CloudRuClient, estimate_cost_rub
from backend.app.kit_content import is_intro_python, is_teacher_ai
from backend.app.models import empty_course
from backend.tests.test_own_cases import OWN1, OWN2, OWN3, OWN3_ANSWERS, OWN4, OWN5

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "logs" / "cases"
BUDGET_RUB = 90.0

_OVERVIEW = importlib.util.spec_from_file_location(
    "case_overview",
    ROOT / "scripts" / "write-case-overview.py",
)
_overview_mod = importlib.util.module_from_spec(_OVERVIEW)
assert _OVERVIEW and _OVERVIEW.loader
_OVERVIEW.loader.exec_module(_overview_mod)
overview = _overview_mod.overview


def _blob(course) -> str:
    return " ".join(
        [
            course.brief.title,
            course.brief.audience,
            *(module.title for module in course.modules),
            *(" ".join(task.title for item in course.seminars for task in item.tasks),),
        ]
    ).lower()


CASES = [
    {
        "id": "s1",
        "file": "live-own-1.json",
        "turns": [OWN1],
        "checks": [
            ("generic", lambda c: profile_name(c) == "generic"),
            ("24 часа", lambda c: c.brief.duration_hours == 24),
            ("general", lambda c: c.brief.program_kind == "general"),
            ("нет чат-бота", lambda c: "чат-бот" not in _blob(c)),
        ],
    },
    {
        "id": "s2",
        "file": "live-own-2.json",
        "turns": [OWN2],
        "checks": [
            ("не школьный Python", lambda c: not is_intro_python(c)),
            ("24 часа", lambda c: c.brief.duration_hours == 24),
            ("нет чат-бота", lambda c: "чат-бот" not in _blob(c)),
            ("аудитория не школьники", lambda c: "школьник" not in (c.brief.audience or "").lower()),
        ],
    },
    {
        "id": "s3",
        "file": "live-own-3.json",
        "incomplete_first": True,
        "turns": [OWN3, OWN3_ANSWERS],
        "checks": [
            ("сначала вопросы", lambda c: True),
            ("20 часов", lambda c: c.brief.duration_hours == 20),
            ("не teacher_ai", lambda c: not is_teacher_ai(c)),
            ("general", lambda c: c.brief.program_kind == "general"),
        ],
    },
    {
        "id": "s4",
        "file": "live-own-4.json",
        "turns": [OWN4],
        "checks": [
            ("40 часов", lambda c: c.brief.duration_hours == 40),
            ("qualification", lambda c: c.brief.program_kind == "qualification"),
            ("нет B/02.7", lambda c: "b/02.7" not in " ".join(n.labor_function_code or "" for n in c.competencies.nodes).lower()),
            ("не стажировка", lambda c: profile_name(c) != "internship"),
        ],
    },
    {
        "id": "s5",
        "file": "live-own-5.json",
        "turns": [OWN5],
        "checks": [
            ("не teacher_ai", lambda c: not is_teacher_ai(c)),
            ("36 часов", lambda c: c.brief.duration_hours == 36),
            ("нет A/01.6", lambda c: not any(n.labor_function_code == "A/01.6" for n in c.competencies.nodes)),
            ("нет chatgpt", lambda c: "chatgpt" not in _blob(c)),
        ],
    },
]


def _structure_source(calls: list[dict]) -> str:
    sources = []
    for item in calls:
        if item.get("tool") != "set_structure":
            continue
        payload = item.get("input")
        if payload == "local_fallback":
            sources.append("каталог")
        elif isinstance(payload, dict) and payload.get("modules"):
            sources.append("модель")
        else:
            sources.append("модель-пусто")
    if "модель" in sources and "каталог" in sources:
        return "модель пустая, каталог спас"
    if "модель" in sources:
        return "модель"
    if "каталог" in sources:
        return "каталог"
    return "нет плана"


async def run_case(client: CloudRuClient, spec: dict) -> dict:
    course = empty_course()
    asked = False
    last = None
    seen: list[str] = []
    usage_before = dict(client.usage)
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
        "prompt_tokens": client.usage["prompt_tokens"] - usage_before["prompt_tokens"],
        "completion_tokens": client.usage["completion_tokens"] - usage_before["completion_tokens"],
        "total_tokens": client.usage["total_tokens"] - usage_before["total_tokens"],
        "calls": client.usage["calls"] - usage_before["calls"],
    }
    checks = []
    for title, pred in spec["checks"]:
        if title == "сначала вопросы":
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
        "steps": last["steps"] if last else [],
        "assistant": (last.get("assistant") or "")[:400] if last else "",
        "source": _structure_source(last["calls"] if last else []),
        "usage": usage,
        "cost_rub": round(estimate_cost_rub(CHAT_PRO, usage["prompt_tokens"], usage["completion_tokens"]), 4),
        "checks": checks,
        "course": course.as_api(),
        "modules": [{"title": m.title, "hours": m.hours} for m in course.modules],
    }
    path = OUT / spec["file"]
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / f"live-own-{spec['id']}-obzor.txt").write_text(overview(path), encoding="utf-8")
    return payload


def render_report(rows: list[dict], total_usage: dict) -> str:
    cost = estimate_cost_rub(CHAT_PRO, total_usage["prompt_tokens"], total_usage["completion_tokens"])
    lines = [
        "Свои кейсы, живой прогон",
        "=======================",
        "",
        "Тексты: materials/own-cases.txt",
        f"Модель: {CHAT_PRO}. Факт: {total_usage['calls']} вызовов, "
        f"{total_usage['total_tokens']} токенов, около {cost:.2f} руб.",
        "",
    ]
    for row in rows:
        ok = sum(1 for item in row["checks"] if item["ok"])
        lines.append(
            f"{row['id']}. {row.get('title') or 'без названия'}: "
            f"профиль {row['profile']}, план «{row['source']}», "
            f"{row['usage']['calls']} вызов, {row['cost_rub']:.3f} руб, "
            f"чек-лист {ok}/{len(row['checks'])}"
        )
        for item in row["checks"]:
            lines.append(f"  [{'ок' if item['ok'] else 'нет'}] {item['name']}")
        titles = ", ".join(f"{m['title']} ({m['hours']} ч)" for m in row["modules"][:6])
        lines.append(f"  модули: {titles or 'пусто'}")
        lines.append("")
    lines.append("Обзоры: logs/cases/live-own-s1-obzor.txt … live-own-s5-obzor.txt")
    return "\n".join(lines) + "\n"


async def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    total_usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0, "calls": 0}
    for spec in CASES:
        spent = estimate_cost_rub(
            CHAT_PRO,
            total_usage["prompt_tokens"],
            total_usage["completion_tokens"],
        )
        if spent > 8:
            print(f"stop before {spec['id']}: already ≈ {spent:.2f} rub")
            break
        # Отдельный клиент на кейс: иначе хвост пакета упирается в LLM_TOKEN_BUDGET.
        client = CloudRuClient()
        row = await run_case(client, spec)
        rows.append(row)
        for key in total_usage:
            total_usage[key] += row["usage"][key]
        print(
            f"{row['id']} profile={row['profile']} source={row['source']} "
            f"ok={sum(i['ok'] for i in row['checks'])}/{len(row['checks'])}"
        )
    report = render_report(rows, total_usage)
    (ROOT / "docs" / "proverka-svoi-kejsy.txt").write_text(report, encoding="utf-8")
    (OUT / "live-own-cases.json").write_text(
        json.dumps(
            {"usage": total_usage, "cases": [{k: v for k, v in row.items() if k != "course"} for row in rows]},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(report)


if __name__ == "__main__":
    asyncio.run(main())
