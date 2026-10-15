from backend.app.main import audit_course


def test_audit_checks_hours_and_two_instruments() -> None:
    outcome = "Собирает безопасный план урока"
    course = {
        "brief": {
            "title": "ИИ для учителя",
            "audience": "Учителя школ",
            "programKind": "qualification",
            "durationHours": 36,
            "attestationHours": 2,
            "references": [{"title": "Профстандарт Педагог"}],
        },
        "competencies": {"nodes": []},
        "modules": [
            {
                "id": "m1",
                "title": "Безопасное применение ИИ",
                "hours": 34,
                "lectureHours": 8,
                "practiceHours": 16,
                "labHours": 0,
                "selfStudyHours": 10,
                "learningOutcomes": [outcome],
            }
        ],
        "lectures": [{"moduleId": "m1"}],
        "seminars": [{"moduleId": "m1", "tasks": [{"learningOutcome": outcome}]}],
        "assessments": [
            {"moduleId": "m1", "questions": [{"learningOutcome": outcome}]}
        ],
    }

    report = audit_course(course)

    assert report["summary"]["fail"] == 0
    assert any(item["id"].startswith("outcome.") for item in report["items"])


def test_audit_rejects_unlinked_outcome_and_missing_source() -> None:
    course = {
        "brief": {
            "title": "Курс",
            "audience": "Слушатели",
            "programKind": "general",
            "durationHours": 16,
            "attestationHours": 0,
            "references": [],
        },
        "competencies": {"nodes": []},
        "modules": [
            {
                "id": "m1",
                "title": "Модуль",
                "hours": 16,
                "lectureHours": 8,
                "practiceHours": 8,
                "labHours": 0,
                "selfStudyHours": 0,
                "learningOutcomes": ["Результат"],
            }
        ],
        "lectures": [],
        "seminars": [],
        "assessments": [],
    }

    report = audit_course(course)

    assert report["summary"]["fail"] >= 2
    assert report["summary"]["warning"] == 1
