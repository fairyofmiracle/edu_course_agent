"""Каркас + комплект с приложенным образцом АЦР. Ключ не печатает."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from backend.app.agent import fill_missing_kit, run_turn
from backend.app.catalog import profile_name
from backend.app.cloud import CHAT_PRO, CloudRuClient, estimate_cost_rub
from backend.app.models import empty_course

ROOT = Path(__file__).resolve().parents[1]
SAMPLE = (ROOT / "materials" / "program-qualification-248h.txt").read_text(encoding="utf-8")[:12000]
TEXT = (
    "Нужна программа повышения квалификации «Основы веб-разработки» "
    "для сотрудников малых компаний без опыта в вебе, 72 часа, очно-заочно. "
    "Основные темы: HTML, CSS, JavaScript и публикация сайта. "
    "Итоговая аттестация — защита проекта: одностраничный сайт. "
    "Слайды нужны для первых двух модулей. "
    "Структуру разделов можно взять из приложенной программы, "
    "содержание и часы пиши новые, образец не копируй."
)


def blob(course) -> str:
    parts = [
        *(module.title for module in course.modules),
        *(topic for module in course.modules for topic in module.topics),
        *(slide.title for lecture in course.lectures for slide in lecture.slides),
        *(" ".join(slide.bullets) for lecture in course.lectures for slide in lecture.slides),
        *(task.title for seminar in course.seminars for task in seminar.tasks),
        *(task.prompt for seminar in course.seminars for task in seminar.tasks),
    ]
    return " ".join(parts).lower()


async def main() -> None:
    client = CloudRuClient()
    course = empty_course()
    result = await run_turn(
        course,
        user_texts=[TEXT],
        model_messages=[{"role": "user", "content": TEXT}],
        references=SAMPLE,
        client=client,
    )
    course = fill_missing_kit(result["course"])
    text = blob(course)
    checks = {
        "72 часа": course.brief.duration_hours == 72,
        "не 248": course.brief.duration_hours != 248,
        "есть html/css/js": any(token in text for token in ("html", "css", "javascript", "js")),
        "нет бизнес-анализа": "babok" not in text and "bpmn" not in text,
        "лекций >= 2": len(course.lectures) >= 2,
        "есть семинар": bool(course.seminars),
        "семинар не чат-бот": "чат-бот" not in text,
    }
    payload = {
        "profile": profile_name(course),
        "usage": client.usage,
        "cost_rub": round(
            estimate_cost_rub(CHAT_PRO, client.usage["prompt_tokens"], client.usage["completion_tokens"]),
            4,
        ),
        "steps": result["steps"],
        "modules": [{"title": m.title, "hours": m.hours} for m in course.modules],
        "lectures": [
            {
                "moduleId": item.module_id,
                "slides": [slide.title for slide in item.slides],
            }
            for item in course.lectures
        ],
        "seminar": [task.title for item in course.seminars for task in item.tasks],
        "checks": checks,
    }
    out = ROOT / "logs" / "cases" / "live-kit-web.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    report = [
        "Лекции и семинар с файлом-образцом",
        "=================================",
        "",
        "Тема: Основы веб-разработки, 72 ч. Файл: program-qualification-248h.txt",
        f"Профиль {payload['profile']}, токены {client.usage['total_tokens']}, "
        f"около {payload['cost_rub']} руб.",
        "",
        "Модули:",
        *[f"- {item['title']} ({item['hours']} ч)" for item in payload["modules"]],
        "",
        "Лекции:",
        *[
            f"- {item['moduleId']}: " + ", ".join(item["slides"])
            for item in payload["lectures"]
        ],
        "",
        "Семинар: " + ", ".join(payload["seminar"]),
        "",
        "Проверки:",
        *[f"  [{'ок' if ok else 'нет'}] {name}" for name, ok in checks.items()],
    ]
    text_out = ROOT / "docs" / "proverka-lekcii-fail.txt"
    text_out.write_text("\n".join(report) + "\n", encoding="utf-8")
    print("\n".join(report))


if __name__ == "__main__":
    asyncio.run(main())
