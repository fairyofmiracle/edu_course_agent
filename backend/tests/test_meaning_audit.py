# -*- coding: utf-8 -*-
from backend.app.meaning_audit import meaning_hits, meaning_audit_items, text_similarity
from backend.app.audit import audit_course


def _course():
    return {
        "brief": {
            "title": "Тест",
            "audience": "Методисты",
            "programKind": "general",
            "durationHours": 16,
            "attestationHours": 0,
            "goals": ["Собрать план"],
            "references": [],
        },
        "modules": [
            {
                "id": "m1",
                "title": "Модуль 1",
                "hours": 8,
                "lectureHours": 4,
                "practiceHours": 4,
                "labHours": 0,
                "selfStudyHours": 0,
                "topics": ["Тема альфа для проверки объёма"],
                "learningOutcomes": ["Пишет бриф с ограничениями"],
            },
            {
                "id": "m2",
                "title": "Модуль 2",
                "hours": 8,
                "lectureHours": 4,
                "practiceHours": 4,
                "labHours": 0,
                "selfStudyHours": 0,
                "topics": ["Тема бета другая"],
                "learningOutcomes": ["Собирает каркас часов"],
            },
        ],
        "lectures": [
            {
                "moduleId": "m1",
                "outline": ["Введение", "Практика", "Итог"],
                "slides": [
                    {
                        "title": "Введение",
                        "bullets": ["Первый пункт содержательный", "Второй пункт содержательный"],
                    }
                ],
            }
        ],
        "seminars": [
            {
                "moduleId": "m1",
                "tasks": [
                    {
                        "title": "Практика",
                        "prompt": "Соберите учебный план на 16 часов",
                        "steps": ["Откройте шаблон", "Заполните часы"],
                        "criteria": ["Часы сходятся", "Есть темы"],
                    }
                ],
            }
        ],
        "assessments": [
            {
                "moduleId": "m1",
                "questions": [
                    {
                        "stem": "Что входит в бриф?",
                        "options": ["Цели", "Случайный текст"],
                        "answer": "Цели",
                        "explanation": "Бриф задаёт цели и ограничения",
                        "learningOutcome": "Пишет бриф с ограничениями",
                    }
                ],
            }
        ],
        "competencies": {"nodes": []},
    }


def test_template_phrase_detected():
    course = _course()
    course["lectures"][0]["slides"][0]["bullets"][0] = "Материал будет описано позже"
    hits = meaning_hits(course)
    assert any(h["kind"] == "template" for h in hits)
    report = audit_course(course)
    assert any(
        i["section"] == "meaning" and i["status"] == "fail" for i in report["items"]
    )


def test_duplicate_modules():
    course = _course()
    shared = (
        "слушатель собирает учебный план и сверяет часы модулей "
        "с объёмом программы перед печатью комплекта"
    )
    course["modules"][0]["topics"] = [shared, "доп один"]
    course["modules"][1]["topics"] = [shared, "доп два"]
    course["modules"][0]["learningOutcomes"] = [shared + " а"]
    course["modules"][1]["learningOutcomes"] = [shared + " б"]
    assert text_similarity(shared, shared) == 1.0
    hits = meaning_hits(course)
    assert any(h["kind"] == "duplicate" for h in hits)


def test_llm_item_disabled_by_default():
    items = meaning_audit_items(_course())
    llm = next(i for i in items if i["id"] == "meaning.llm")
    assert llm["status"] == "disabled"
    assert llm["section"] == "meaning"


def test_clean_sample_has_clear_or_only_disabled():
    course = _course()
    hits = meaning_hits(course)
    assert not any(h["severity"] == "fail" for h in hits)
