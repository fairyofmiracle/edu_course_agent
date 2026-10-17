from __future__ import annotations

import asyncio
import json
from pathlib import Path

import importlib.util

from backend.app.agent import clip_references
from backend.app.agent_api import RunRequest, run_case

ROOT = Path(__file__).resolve().parents[1]
_SPEC = importlib.util.spec_from_file_location(
    "case_overview", ROOT / "scripts" / "write-case-overview.py"
)
_OVERVIEW = importlib.util.module_from_spec(_SPEC)
assert _SPEC.loader is not None
_SPEC.loader.exec_module(_OVERVIEW)
overview = _OVERVIEW.overview

OUT = ROOT / "logs" / "cases"
SAMPLE = ROOT / "materials" / "program-qualification-248h.txt"

CASES = (
    {
        "id": 2,
        "file": "case-2.json",
        "request": (
            "Программа повышения квалификации «Искусственный интеллект в работе учителя» "
            "для учителей школ Ингушетии, 36 часов, очно-заочно с применением дистанционных "
            "технологий. Учителя должны научиться готовить с помощью нейросетей планы уроков, "
            "задания и проверочные работы, а также понимать риски и правила безопасного "
            "использования ИИ в работе с детьми. Итоговая аттестация в форме зачёта по "
            "портфолио из трёх материалов, созданных с помощью ИИ. Использовать только "
            "сервисы, которые доступны в России."
        ),
        "answers": None,
        "note": (
            "Это только образец оформления. Не копируй тему, часы и стажировку. "
            "Нужна программа 36 часов для учителей об ИИ.\n\n"
        ),
    },
    {
        "id": 3,
        "file": "case-3.json",
        "request": (
            "Нужна программа повышения квалификации на 72 часа «Анализ данных на Python» "
            "для сотрудников региональных отделений банков, которые сейчас работают в Excel. "
            "Формат очно-заочный, срок 4 недели. Основные темы это pandas, визуализация, "
            "SQL для выгрузки данных и основы статистики. Итоговая аттестация в виде защиты "
            "проекта на обезличенных банковских данных. Прикладываю нашу прошлую программу, "
            "структуру можно взять оттуда, но содержание нужно новое. Слайды нужны для "
            "модуля про pandas."
        ),
        "answers": None,
        "note": (
            "Образец оформления, не копируй текст и часы. Содержание должно быть новым. "
            "Ошибку итоговой строки, если она есть, не переноси.\n\n"
        ),
    },
    {
        "id": 4,
        "file": "case-4.json",
        "request": (
            "Сделайте курс по кибербезопасности для студентов колледжа, примерно на месяц, "
            "чтобы после него ребята могли пойти работать в эту сферу."
        ),
        "answers": (
            "Тип программы: повышение квалификации. Объём 72 часа. Слушатели: студенты "
            "3 курса специальности «Информационные системы и программирование», знают "
            "основы сетей и Linux. Форма обучения очная, занятия на базе колледжа. "
            "Итоговая аттестация: экзамен с практическим заданием на стенде."
        ),
        "note": None,
    },
    {
        "id": 5,
        "file": "case-5.json",
        "request": (
            "Нужна программа повышения квалификации в форме стажировки "
            "«DevOps-инженер от Linux до CI/CD» на 256 часов. Слушатели проходят "
            "стажировку в ИТ-компаниях региона, вся работа самостоятельная под "
            "руководством наставника от компании, аудиторных занятий нет. Итоговая "
            "аттестация занимает 2 часа и проходит в форме защиты отчёта о стажировке. "
            "Срок около двух месяцев, не больше 4 часов в день. Возьмите за образец "
            "структуры нашу стажировку по бизнес-анализу."
        ),
        "answers": None,
        "note": (
            "В образце стажировки по бизнес-анализу итоговая строка часов может "
            "не сходиться. Эту ошибку не переноси. Нужна стажировка DevOps 256 часов, "
            "аудиторных занятий нет.\n\n"
        ),
    },
)


def refs_for(case: dict) -> str | None:
    if not case["note"]:
        return None
    raw = SAMPLE.read_text(encoding="utf-8")
    return case["note"] + clip_references(raw, 500)


async def run_one(case: dict) -> dict:
    data = await run_case(
        RunRequest(
            caseId=case["id"],
            request=case["request"],
            answers=case["answers"],
            references=refs_for(case),
        )
    )
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / case["file"]
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / f"case-{case['id']}-obzor.txt").write_text(overview(path), encoding="utf-8")
    course = data.get("course") or {}
    brief = course.get("brief") or {}
    usage = data.get("usage") or {}
    print(
        f"case {case['id']}: kind={brief.get('programKind')} "
        f"hours={brief.get('durationHours')} modules={len(course.get('modules') or [])} "
        f"asked={data.get('report', {}).get('askedQuestions')} "
        f"tokens={usage.get('total_tokens', 0)}"
    )
    return data


async def main() -> None:
    incomplete = await run_case(
        RunRequest(caseId=4, request=CASES[2]["request"], autoApprove=False)
    )
    (OUT / "case-4-incomplete.json").write_text(
        json.dumps(incomplete, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(
        "case 4 first turn: "
        f"kind={incomplete['course']['brief']['programKind']} "
        f"hours={incomplete['course']['brief']['durationHours']} "
        f"modules={len(incomplete['course']['modules'])} "
        f"asked={incomplete['report'].get('askedQuestions')}"
    )
    for case in CASES:
        await run_one(case)


if __name__ == "__main__":
    asyncio.run(main())
