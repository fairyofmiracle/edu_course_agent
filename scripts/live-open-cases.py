"""Прогон пяти открытых кейсов через Pro. Ключ в чат не печатает."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import importlib.util

from backend.app.agent import fill_missing_kit, run_turn
from backend.app.catalog import is_incomplete_brief
from backend.app.cloud import CHAT_PRO, CloudRuClient, estimate_cost_rub
from backend.app.models import empty_course
from backend.tests.test_open_cases import CASE1, CASE2, CASE3, CASE4, CASE4_ANSWERS, CASE5

_OVERVIEW = importlib.util.spec_from_file_location(
    "case_overview",
    Path(__file__).resolve().parents[1] / "scripts" / "write-case-overview.py",
)
_overview_mod = importlib.util.module_from_spec(_OVERVIEW)
assert _OVERVIEW and _OVERVIEW.loader
_OVERVIEW.loader.exec_module(_overview_mod)
overview = _overview_mod.overview

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "logs" / "cases"
BUDGET_RUB = 92.0


CASES = [
    {
        "id": "1",
        "file": "live-case-1.json",
        "turns": [CASE1],
        "checks": [
            ("шаблон general", lambda c: c.brief.program_kind == "general"),
            ("16 часов", lambda c: c.brief.duration_hours == 16),
            ("практики ≥ 8", lambda c: sum(m.practice_hours for m in c.modules) >= 8),
            ("нет профстандарта", lambda c: not any(n.labor_function_code for n in c.competencies.nodes)),
            ("защита проекта", lambda c: "проект" in (c.brief.attestation_form or "").lower()),
            ("тест 10 вопросов", lambda c: sum(len(a.questions) for a in c.assessments) >= 10),
            ("есть слайды", lambda c: len(c.lectures) >= 2),
        ],
    },
    {
        "id": "2",
        "file": "live-case-2.json",
        "turns": [CASE2],
        "checks": [
            ("шаблон qualification", lambda c: c.brief.program_kind == "qualification"),
            ("36 часов", lambda c: c.brief.duration_hours == 36),
            ("есть удостоверение", lambda c: any("удостоверение" in x.lower() for x in c.brief.constraints)),
            ("код A/01.6", lambda c: any(n.labor_function_code == "A/01.6" for n in c.competencies.nodes)),
            ("нет chatgpt", lambda c: "chatgpt" not in _blob(c)),
            ("портфолио", lambda c: "портфолио" in (c.brief.attestation_form or "").lower()),
        ],
    },
    {
        "id": "3",
        "file": "live-case-3.json",
        "turns": [CASE3],
        "checks": [
            ("72 часа", lambda c: c.brief.duration_hours == 72),
            ("pandas", lambda c: "pandas" in _titles(c)),
            ("sql", lambda c: "sql" in _titles(c)),
            ("статистика", lambda c: "статист" in _titles(c)),
            ("визуализация", lambda c: "визуализац" in _titles(c)),
            ("06.042", lambda c: any("06.042" in (r.title or "") for r in c.brief.references)),
            ("обезличенные данные", lambda c: "обезлич" in (c.brief.attestation_form or "").lower()),
        ],
    },
    {
        "id": "4",
        "file": "live-case-4.json",
        "turns": [CASE4, CASE4_ANSWERS],
        "checks": [
            ("сначала вопросы", lambda c, first=None: first is True),
            ("72 часа после ответов", lambda c: c.brief.duration_hours == 72),
            ("qualification", lambda c: c.brief.program_kind == "qualification"),
            ("экзамен на стенде", lambda c: "экзамен" in (c.brief.attestation_form or "").lower()),
            ("06.032", lambda c: any("06.032" in (r.title or "") for r in c.brief.references)),
            ("начальный уровень", lambda c: c.brief.level == "beginner"),
        ],
    },
    {
        "id": "5",
        "file": "live-case-5.json",
        "turns": [CASE5],
        "checks": [
            ("256 часов", lambda c: c.brief.duration_hours == 256),
            ("2 ч аттестация", lambda c: c.brief.attestation_hours == 2),
            ("лекции 0", lambda c: sum(m.lecture_hours for m in c.modules) == 0),
            ("СРС 254", lambda c: sum(m.self_study_hours for m in c.modules) == 254),
            ("linux/ci/cd", lambda c: all(t in _blob(c) for t in ("linux", "ci/cd"))),
            ("06.026", lambda c: any("06.026" in (r.title or "") for r in c.brief.references)),
        ],
    },
]


def _blob(course) -> str:
    return " ".join(
        [
            course.brief.title,
            course.brief.audience,
            course.brief.attestation_form,
            *course.brief.constraints,
            *(module.title for module in course.modules),
            *(topic for module in course.modules for topic in module.topics),
        ]
    ).lower()


def _titles(course) -> str:
    return " ".join(module.title for module in course.modules).lower()


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
        if spec["id"] == "4" and is_incomplete_brief(course) and not course.modules:
            asked = bool(last.get("assistant"))
            continue
        course = fill_missing_kit(course)
    usage_after = client.usage
    usage = {
        "prompt_tokens": usage_after["prompt_tokens"] - usage_before["prompt_tokens"],
        "completion_tokens": usage_after["completion_tokens"] - usage_before["completion_tokens"],
        "total_tokens": usage_after["total_tokens"] - usage_before["total_tokens"],
        "calls": usage_after["calls"] - usage_before["calls"],
    }
    source = _structure_source(last["calls"] if last else [])
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
        "steps": last["steps"] if last else [],
        "assistant": (last.get("assistant") or "") if last else "",
        "source": source,
        "usage": usage,
        "cost_rub": round(estimate_cost_rub(CHAT_PRO, usage["prompt_tokens"], usage["completion_tokens"]), 4),
        "checks": checks,
        "course": course.as_api(),
        "modules": [{"title": m.title, "hours": m.hours} for m in course.modules],
    }
    path = OUT / spec["file"]
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / f"live-case-{spec['id']}-obzor.txt").write_text(overview(path), encoding="utf-8")
    return payload


def render_report(rows: list[dict], total_usage: dict) -> str:
    cost = estimate_cost_rub(
        CHAT_PRO,
        total_usage["prompt_tokens"],
        total_usage["completion_tokens"],
    )
    lines = [
        "Живой прогон пяти открытых кейсов",
        "================================",
        "",
        f"Бюджет на сегодня: {BUDGET_RUB:.0f} руб. Модель: {CHAT_PRO}.",
        f"Факт: {total_usage['calls']} вызовов, {total_usage['total_tokens']} токенов, ≈ {cost:.2f} руб.",
        f"Остаток грубо: {BUDGET_RUB - cost:.2f} руб.",
        "",
    ]
    for row in rows:
        ok = sum(1 for item in row["checks"] if item["ok"])
        lines.append(
            f"Кейс {row['id']}: план от «{row['source']}», "
            f"{row['usage']['calls']} вызов, {row['usage']['total_tokens']} ток, "
            f"≈ {row['cost_rub']:.3f} руб, чек-лист {ok}/{len(row['checks'])}"
        )
        for item in row["checks"]:
            mark = "ок" if item["ok"] else "нет"
            lines.append(f"  [{mark}] {item['name']}")
        titles = ", ".join(f"{m['title']} ({m['hours']} ч)" for m in row["modules"][:6])
        lines.append(f"  модули: {titles or 'пусто'}")
        lines.append("")
    lines.extend(
        [
            "Где смотреть программу словами:",
            "  logs/cases/live-case-1-obzor.txt … live-case-5-obzor.txt",
            "",
            "Скрытые кейсы не гоняла.",
        ]
    )
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
        if spent > BUDGET_RUB * 0.6:
            print(f"stop before case {spec['id']}: already ≈ {spent:.2f} rub")
            break
        # Отдельный клиент на кейс: общий LLM_TOKEN_BUDGET иначе режет хвост прогона.
        client = CloudRuClient()
        row = await run_case(client, spec)
        rows.append(row)
        for key in total_usage:
            total_usage[key] += row["usage"][key]
        print(
            f"case {row['id']} source={row['source']} "
            f"usage={row['usage']} checks={sum(i['ok'] for i in row['checks'])}/{len(row['checks'])}"
        )
    report = render_report(rows, total_usage)
    (ROOT / "docs" / "proverka-92.txt").write_text(report, encoding="utf-8")
    (OUT / "live-open-cases.json").write_text(
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
