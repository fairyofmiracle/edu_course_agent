from __future__ import annotations

import json
from pathlib import Path

from backend.app.agent import assemble_local_course, course_report
from backend.app.audit import audit_course_document
from backend.tests.test_open_cases import (
    ANYTHING,
    CASE1,
    CASE2,
    CASE3,
    CASE4,
    CASE4_ANSWERS,
    CASE5,
)

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "logs" / "cases"


def dump(name: str, texts: list[str], extra: dict | None = None) -> None:
    course = assemble_local_course(texts, extra)
    report = course_report(course, asked_questions=not course.modules)
    report["audit"] = audit_course_document(course)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / name).write_text(
        json.dumps(
            {"course": course.as_api(), "report": report},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(
        f"{name} kind={course.brief.program_kind} "
        f"hours={course.brief.duration_hours:g} "
        f"modules={len(course.modules)} "
        f"questions={sum(len(item.questions) for item in course.assessments)}"
    )


def main() -> None:
    dump("case-1.json", [CASE1], {"audience": "школьники 8 и 9 классов без опыта"})
    dump("case-2.json", [CASE2], {"audience": "учителя школ Ингушетии"})
    dump("case-3.json", [CASE3], {"audience": "сотрудники банков, работают в Excel"})
    dump("case-4-incomplete.json", [CASE4], {"audience": "студенты колледжа"})
    dump(
        "case-4.json",
        [CASE4, CASE4_ANSWERS],
        {
            "audience": (
                "студенты 3 курса колледжа, параллельно получают СПО, "
                "знают основы сетей и Linux"
            )
        },
    )
    dump("case-5.json", [CASE5], {"audience": "слушатели стажировки в ИТ-компаниях"})
    dump("arbitrary-figma.json", [ANYTHING], {"audience": "сотрудники музея без опыта дизайна"})


if __name__ == "__main__":
    main()
