from __future__ import annotations

import json
from pathlib import Path

from backend.app.agent import fill_missing_kit
from backend.app.audit import audit_course_document
from backend.app.models import CourseDocument
from backend.app.planner import kit_needed

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "logs" / "cases" / "case-1.json"


def main() -> None:
    raw = json.loads(PATH.read_text(encoding="utf-8"))
    course = fill_missing_kit(CourseDocument.model_validate(raw["course"]))
    raw["course"] = course.as_api()
    raw["report"]["audit"] = audit_course_document(course)
    PATH.write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")
    practice = sum(module.practice_hours for module in course.modules)
    questions = course.assessments[0].questions if course.assessments else []
    print(
        f"kind={course.brief.program_kind} hours={course.brief.duration_hours:g} "
        f"practice={practice:g} modules={len(course.modules)}"
    )
    print(f"attestation={course.brief.attestation_form}")
    print("competencies:")
    for node in course.competencies.nodes:
        print(f"  - {node.name}: {node.knowledge[0]}")
    print("questions:")
    for question in questions:
        print(f"  - {question.stem}")
    print(
        f"lectures={len(course.lectures)} seminars={len(course.seminars)} "
        f"kit_needed={kit_needed(course)}"
    )
    if course.seminars:
        task = course.seminars[0].tasks[0]
        print(f"seminar={task.title}")
        print("criteria:", "; ".join(task.criteria))
    if course.lectures:
        print("slide0:", " | ".join(course.lectures[0].slides[0].bullets[:3]))


if __name__ == "__main__":
    main()
