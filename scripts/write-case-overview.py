from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def line(parts: list[str]) -> str:
    return "\n".join(part for part in parts if part)


def overview(path: Path) -> str:
    raw = json.loads(path.read_text(encoding="utf-8"))
    course = raw.get("course") or raw
    brief = course.get("brief") or {}
    usage = raw.get("usage") or {}
    blocks = [
        brief.get("title") or "Без названия",
        "=" * len(brief.get("title") or "Без названия"),
        "",
        f"Шаблон: {brief.get('programKind')}",
        f"Объём: {brief.get('durationHours')} ч, аттестация {brief.get('attestationHours')} ч",
        f"Форма: {brief.get('format')}, уровень: {brief.get('level')}",
        f"Аудитория: {brief.get('audience')}",
        f"Аттестация: {brief.get('attestationForm')}",
        "",
        "Ограничения:",
        *[f"- {item}" for item in brief.get("constraints") or []],
        "",
        "Компетенции:",
    ]
    for node in (course.get("competencies") or {}).get("nodes") or []:
        blocks.append(
            f"- {node.get('name')} [{node.get('laborFunctionCode') or 'без кода ТФ'}]"
        )
    blocks.append("")
    blocks.append("Модули:")
    for module in course.get("modules") or []:
        blocks.append(
            f"- {module.get('title')}: {module.get('hours')} ч "
            f"(лек {module.get('lectureHours')}, практ {module.get('practiceHours')}, "
            f"лаб {module.get('labHours')}, СРС {module.get('selfStudyHours')})"
        )
        for topic in module.get("topics") or []:
            blocks.append(f"    тема: {topic}")
    questions = [
        question
        for item in course.get("assessments") or []
        for question in item.get("questions") or []
    ]
    blocks.extend(["", f"Тест: {len(questions)} вопросов"])
    for index, question in enumerate(questions, start=1):
        blocks.append(f"{index}. {question.get('stem')}")
        blocks.append(f"   ключ: {question.get('answer')}")
    blocks.append("")
    blocks.append("Слайды:")
    for lecture in course.get("lectures") or []:
        blocks.append(f"модуль {lecture.get('moduleId')}")
        for slide in lecture.get("slides") or []:
            blocks.append(f"  {slide.get('title')}")
            for bullet in slide.get("bullets") or []:
                blocks.append(f"    - {bullet}")
    blocks.append("")
    blocks.append("Семинар:")
    for seminar in course.get("seminars") or []:
        for task in seminar.get("tasks") or []:
            blocks.append(f"- {task.get('title')}")
            blocks.append(f"  {task.get('prompt')}")
            for criterion in task.get("criteria") or []:
                blocks.append(f"  критерий: {criterion}")
    blocks.extend(
        [
            "",
            "Траты модели:",
            f"вызовы {usage.get('calls', 0)}, токены {usage.get('total_tokens', 0)}",
        ]
    )
    return line(blocks) + "\n"


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "logs" / "cases" / "case-1.json"
    dst = src.with_name(src.stem + "-obzor.txt")
    dst.write_text(overview(src), encoding="utf-8")
    print(dst)


if __name__ == "__main__":
    main()
