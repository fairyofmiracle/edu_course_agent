from __future__ import annotations

from typing import Any

from .domain import framework_items
from .models import CourseDocument


def audit_course_document(course: CourseDocument) -> dict[str, Any]:
    value = course.as_api()
    items = [
        {
            "id": f"framework.{item['id']}",
            "label": item["label"],
            "status": "pass" if item["ok"] else "fail",
            "section": "framework",
        }
        for item in framework_items(course)
    ]
    for module in value["modules"]:
        module_id = module["id"]
        has_lecture = any(row["moduleId"] == module_id for row in value["lectures"])
        has_seminar = any(row["moduleId"] == module_id for row in value["seminars"])
        has_assessment = any(
            row["moduleId"] == module_id for row in value["assessments"]
        )
        items.append(
            {
                "id": f"content.{module_id}",
                "label": f"{module['title']}: лекция, задание и тест",
                "status": (
                    "pass"
                    if has_lecture and has_seminar and has_assessment
                    else "fail"
                ),
                "section": "content",
            }
        )
    references = value["brief"]["references"]
    items.append(
        {
            "id": "sources.present",
            "label": (
                "Источники и референсы указаны"
                if references
                else "Источники и референсы не указаны"
            ),
            "status": "pass" if references else "warning",
            "section": "sources",
        }
    )
    summary = {
        state: sum(1 for item in items if item["status"] == state)
        for state in ("pass", "warning", "fail")
    }
    return {"summary": summary, "items": items}
