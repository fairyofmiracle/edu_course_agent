from fastapi.testclient import TestClient

from backend.app.main import app, audit_course


def test_audit_checks_hours_and_two_instruments() -> None:
    outcome = "Собирает безопасный план урока"
    course = {
        "brief": {
            "title": "ИИ для учителя",
            "audience": "Учителя школ",
            "programKind": "qualification",
            "durationHours": 36,
            "attestationHours": 2,
            "references": [
                {"title": "Профстандарт Педагог"},
                {
                    "title": "Федеральный закон от 29.12.2012 № 273-ФЗ",
                    "source": "http://publication.pravo.gov.ru/document/0001201212300007",
                },
                {
                    "title": "Приказ Минобрнауки России от 24.03.2025 № 266",
                    "source": "http://publication.pravo.gov.ru/document/0001202504230011",
                },
            ],
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
            {
                "moduleId": "m1",
                "questions": [{"answer": "План с проверкой фактов", "learningOutcome": outcome}],
            }
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


def test_audit_rejects_fractional_hour_and_question_without_key() -> None:
    course = {
        "brief": {
            "title": "Курс",
            "audience": "Слушатели",
            "programKind": "general",
            "durationHours": 16,
            "attestationHours": 0.5,
        },
        "modules": [
            {
                "id": "m1",
                "title": "Модуль",
                "hours": 15.7,
                "lectureHours": 8,
                "practiceHours": 7.7,
                "labHours": 0,
                "selfStudyHours": 0,
                "learningOutcomes": ["Результат"],
            }
        ],
        "lectures": [{"moduleId": "m1"}],
        "seminars": [
            {"moduleId": "m1", "tasks": [{"learningOutcome": "Другой результат"}]}
        ],
        "assessments": [
            {"moduleId": "m1", "questions": [{"answer": "", "learningOutcome": "Результат"}]}
        ],
    }

    report = audit_course(course)
    failed = {item["id"] for item in report["items"] if item["status"] == "fail"}

    assert "framework.hour_step" in failed
    assert "question.m1.0" in failed
    assert "task.m1.0" in failed


def test_audit_accepts_half_hour_with_linked_key() -> None:
    outcome = "Настраивает VLAN"
    course = {
        "brief": {
            "title": "Сети",
            "audience": "Студенты колледжа",
            "programKind": "qualification",
            "durationHours": 16,
            "attestationHours": 0.5,
            "references": [
                {"title": "Материал методиста"},
                {
                    "title": "Федеральный закон от 29.12.2012 № 273-ФЗ",
                    "source": "http://publication.pravo.gov.ru/document/0001201212300007",
                },
                {
                    "title": "Приказ Минобрнауки России от 24.03.2025 № 266",
                    "source": "http://publication.pravo.gov.ru/document/0001202504230011",
                },
            ],
        },
        "modules": [
            {
                "id": "m1",
                "title": "Коммутация",
                "hours": 15.5,
                "lectureHours": 4,
                "practiceHours": 8,
                "labHours": 1.5,
                "selfStudyHours": 2,
                "learningOutcomes": [outcome],
            }
        ],
        "lectures": [{"moduleId": "m1"}],
        "seminars": [{"moduleId": "m1", "tasks": [{"learningOutcome": outcome}]}],
        "assessments": [
            {"moduleId": "m1", "questions": [{"answer": "Сегментация", "learningOutcome": outcome}]}
        ],
    }

    report = audit_course(course)

    assert report["summary"]["fail"] == 0


def test_openapi_describes_audit_contract() -> None:
    schema = app.openapi()
    audit = schema["paths"]["/api/audit"]["post"]

    assert audit["summary"] == "Проверить программу без модели"
    assert "0,5" in audit["description"]
    assert "ключ" in audit["description"]
    assert schema["paths"]["/health"]["get"]["operationId"] == "health"
    assert "courses" in {tag["name"] for tag in schema["tags"]}

    with TestClient(app) as client:
        response = client.post(
            "/api/audit",
            json={
                "brief": {
                    "title": "Сети",
                    "audience": "Студенты",
                    "programKind": "general",
                    "durationHours": 16,
                    "attestationHours": 0.5,
                },
                "modules": [
                    {
                        "id": "m1",
                        "title": "Коммутация",
                        "hours": 15.5,
                        "lectureHours": 4,
                        "practiceHours": 8,
                        "labHours": 1.5,
                        "selfStudyHours": 2,
                        "learningOutcomes": ["Настраивает VLAN"],
                    }
                ],
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert set(body["summary"]) == {"pass", "warning", "fail"}
    assert body["summary"]["fail"] > 0


def test_general_program_fails_without_order_629() -> None:
    report = audit_course(
        {
            "brief": {
                "title": "Курс",
                "audience": "Слушатели",
                "programKind": "general",
                "durationHours": 16,
                "references": [],
            },
            "modules": [],
        }
    )
    failed = {item["id"] for item in report["items"] if item["status"] == "fail"}
    assert "basis.order-629" in failed


def test_qualification_keeps_order_499_as_warning() -> None:
    report = audit_course(
        {
            "brief": {
                "programKind": "qualification",
                "references": [
                    {
                        "title": "Приказ Минобрнауки России от 01.07.2013 № 499",
                        "source": "https://www.consultant.ru/document/cons_doc_LAW_151143/",
                    },
                    {
                        "title": "Федеральный закон от 29.12.2012 № 273-ФЗ",
                        "source": "http://publication.pravo.gov.ru/document/0001201212300007",
                    },
                ],
            },
            "competencies": {"nodes": [{"id": "c1"}]},
        }
    )
    by_id = {item["id"]: item for item in report["items"]}
    assert by_id["basis.order-266"]["status"] == "fail"
    assert by_id["basis.order-499"]["status"] == "warning"
    assert "указан в источниках" in by_id["basis.order-499"]["details"]
    assert by_id["basis.labor-codes"]["status"] == "warning"
    assert "basis.fz-273" not in by_id
