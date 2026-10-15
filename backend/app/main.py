from __future__ import annotations

from typing import Any, Literal

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, HttpUrl


app = FastAPI(
    title="Студия методиста — Python backend",
    version="0.1.0",
    description="Аудит образовательной программы и контроль нормативных источников.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3010"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RegulatoryClaim(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    authority: str = Field(min_length=1, max_length=200)
    number: str | None = Field(default=None, max_length=80)
    date: str | None = Field(default=None, max_length=40)
    source: HttpUrl | None = None


class RegulatoryCheckRequest(BaseModel):
    claims: list[RegulatoryClaim] = Field(default_factory=list, max_length=50)


def _audit_item(
    item_id: str,
    label: str,
    ok: bool,
    section: str,
    details: str | None = None,
) -> dict[str, Any]:
    return {
        "id": item_id,
        "label": label,
        "status": "pass" if ok else "fail",
        "section": section,
        **({"details": details} if details else {}),
    }


def audit_course(course: dict[str, Any]) -> dict[str, Any]:
    """Проверяет только формальные правила; методическое качество остаётся человеку."""
    brief = course.get("brief") or {}
    modules = course.get("modules") or []
    assessments = course.get("assessments") or []
    seminars = course.get("seminars") or []
    lectures = course.get("lectures") or []
    competencies = (course.get("competencies") or {}).get("nodes") or []

    module_hours = sum(float(module.get("hours") or 0) for module in modules)
    attestation_hours = float(brief.get("attestationHours") or 0)
    target_hours = float(brief.get("durationHours") or 0)
    kinds_match = all(
        abs(
            sum(
                float(module.get(field) or 0)
                for field in (
                    "lectureHours",
                    "practiceHours",
                    "labHours",
                    "selfStudyHours",
                )
            )
            - float(module.get("hours") or 0)
        )
        < 0.001
        for module in modules
    )

    items = [
        _audit_item(
            "framework.template",
            "Выбран шаблон программы",
            brief.get("programKind") in {"general", "qualification"},
            "framework",
        ),
        _audit_item(
            "framework.brief",
            "Есть название и аудитория",
            bool(str(brief.get("title") or "").strip())
            and bool(str(brief.get("audience") or "").strip()),
            "framework",
        ),
        _audit_item(
            "framework.hours",
            f"Часы сходятся: {module_hours + attestation_hours:g} из {target_hours:g}",
            bool(modules)
            and target_hours > 0
            and kinds_match
            and abs(module_hours + attestation_hours - target_hours) < 0.001,
            "framework",
        ),
    ]

    for module in modules:
        module_id = str(module.get("id") or "")
        has_lecture = any(row.get("moduleId") == module_id for row in lectures)
        has_seminar = any(row.get("moduleId") == module_id for row in seminars)
        has_assessment = any(row.get("moduleId") == module_id for row in assessments)
        items.append(
            _audit_item(
                f"content.{module_id}",
                f"{module.get('title') or module_id}: лекция, задание и тест",
                has_lecture and has_seminar and has_assessment,
                "content",
            )
        )

        question_outcomes = {
            str(question.get("learningOutcome") or "").strip()
            for assessment in assessments
            if assessment.get("moduleId") == module_id
            for question in assessment.get("questions") or []
        }
        task_outcomes = {
            str(task.get("learningOutcome") or "").strip()
            for seminar in seminars
            if seminar.get("moduleId") == module_id
            for task in seminar.get("tasks") or []
        }
        for outcome in module.get("learningOutcomes") or []:
            missing = []
            if outcome not in question_outcomes:
                missing.append("тест")
            if outcome not in task_outcomes:
                missing.append("практическое задание")
            items.append(
                _audit_item(
                    f"outcome.{module_id}.{outcome}",
                    f"Результат «{outcome}» проверяется двумя способами",
                    not missing,
                    "content",
                    f"Не хватает: {' и '.join(missing)}" if missing else None,
                )
            )

    references = brief.get("references") or []
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
            **(
                {}
                if references
                else {
                    "details": (
                        "Приказы и профстандарты нельзя добавлять без файла "
                        "или проверяемой ссылки."
                    )
                }
            ),
        }
    )

    labor_codes = [
        str(node.get("laborFunctionCode") or "").strip()
        for node in competencies
        if str(node.get("laborFunctionCode") or "").strip()
    ]
    if labor_codes:
        items.append(
            {
                "id": "sources.codes",
                "label": "Коды трудовых функций требуют ручной сверки",
                "status": "warning" if references else "fail",
                "section": "sources",
                "details": ", ".join(labor_codes),
            }
        )

    summary = {
        state: sum(1 for item in items if item["status"] == state)
        for state in ("pass", "warning", "fail")
    }
    return {"summary": summary, "items": items}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "edu-course-python"}


@app.post("/api/audit")
def audit(course: dict[str, Any]) -> dict[str, Any]:
    return audit_course(course)


@app.post("/api/regulatory/check")
def check_regulatory_sources(
    request: RegulatoryCheckRequest,
) -> dict[str, list[dict[str, Any]]]:
    results: list[dict[str, Any]] = []
    for claim in request.claims:
        source_attached = claim.source is not None
        requisites_present = bool(claim.number and claim.date)
        state: Literal["source_attached", "unconfirmed"] = (
            "source_attached" if source_attached and requisites_present else "unconfirmed"
        )
        results.append(
            {
                **claim.model_dump(mode="json"),
                "status": state,
                "message": (
                    "Источник приложен; реквизиты всё равно подтверждает методист."
                    if state == "source_attached"
                    else "Не использовать в программе до подтверждения источником."
                ),
            }
        )
    return {"results": results}


@app.get("/api/regulatory/policy")
def regulatory_policy() -> dict[str, Any]:
    return {
        "authorities": [
            "Минпросвещения России",
            "Минобрнауки России",
            "Минтруд России",
            "Правительство Российской Федерации",
        ],
        "rules": [
            "Использовать только документы из файлов методиста или проверяемых ссылок.",
            "Не придумывать номера, даты, названия приказов и коды профстандартов.",
            "Неподтверждённые реквизиты помечать и не переносить в итоговый DOCX.",
            "Финальное решение о применимости документа принимает методист.",
        ],
    }
