from __future__ import annotations

import json
from pathlib import Path

from backend.app.agent import fill_missing_kit
from backend.app.audit import audit_course_document
from backend.app.models import CourseDocument

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "logs" / "cases" / "case-2.json"


def main() -> None:
    raw = json.loads(PATH.read_text(encoding="utf-8"))
    course = fill_missing_kit(CourseDocument.model_validate(raw["course"]))
    raw["course"] = course.as_api()
    raw["report"]["audit"] = audit_course_document(course)
    PATH.write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")
    text = " ".join(
        [
            course.brief.title,
            course.brief.attestation_form,
            *course.brief.constraints,
            *(module.title for module in course.modules),
            *(topic for module in course.modules for topic in module.topics),
        ]
    ).lower()
    print(f"kind={course.brief.program_kind} hours={course.brief.duration_hours:g}")
    print(f"attestation={course.brief.attestation_form}")
    print("competencies:")
    for node in course.competencies.nodes:
        print(f"  - {node.name} [{node.labor_function_code}]")
    print("constraints:", course.brief.constraints)
    print("seminars:", [task.title for item in course.seminars for task in item.tasks])
    print("lectures", len(course.lectures), "questions", sum(len(a.questions) for a in course.assessments))
    print("risks", "риск" in text and "персональн" in text)
    print("pedagogue_ref", any("544н" in (ref.title or "") for ref in course.brief.references))


if __name__ == "__main__":
    main()
