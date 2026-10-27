# -*- coding: utf-8 -*-
from backend.app.brief_guard import (
    deadline_volume_conflict,
    is_garbage_title,
    is_offtopic_request,
    title_from_request,
    guard_brief,
    VOLUME_CLARIFY_NOTE,
)
from backend.app.planner import missing_brief_lines, QUESTION_LABELS
from backend.app.models import CourseDocument, empty_course
from backend.app.export_api import export_is_ready
from backend.app.agent import strip_teacher_only_modules


def test_garbage_and_offtopic_titles():
    assert is_garbage_title("asdf!!! ???")
    assert is_offtopic_request("напиши рецепт борща")
    assert title_from_request("напиши рецепт борща") == ""
    assert title_from_request("asdf qwerty") == ""
    assert "Python" in title_from_request("Курс по Python для новичков, 36 часов")


def test_deadline_volume_conflict_asks():
    texts = ["Срочно за 1 день нужна программа курса на 400 часов по сварке"]
    assert deadline_volume_conflict(texts, 400)
    texts2 = texts + ["Оставить 400 часов — это объём обучения, собрать программу быстро"]
    assert not deadline_volume_conflict(texts2, 400)


def test_guard_brief_adds_clarify_note():
    brief, dropped = guard_brief(
        {"durationHours": 400, "title": "Сварка"},
        {},
        ["Срочно за 1 день курс на 400 часов по сварке"],
    )
    assert VOLUME_CLARIFY_NOTE in (brief.get("constraints") or [])


def test_missing_brief_includes_clarify():
    course = empty_course()
    data = course.as_api()
    data["brief"]["programKind"] = "qualification"
    data["brief"]["durationHours"] = 400
    data["brief"]["audience"] = "сварщики, уровень новичок"
    data["brief"]["attestationForm"] = "экзамен"
    data["brief"]["formatNamed"] = True
    data["brief"]["constraints"] = [VOLUME_CLARIFY_NOTE]
    course = CourseDocument.model_validate(data)
    missing = missing_brief_lines(course)
    assert any("уточнить объём" in item for item in missing)
    assert "уточнить объём обучения или срок сборки" in QUESTION_LABELS


def test_export_blocks_zip_without_modules():
    course = empty_course()
    ok, status = export_is_ready(course, "zip")
    assert not ok
    assert status in {"incomplete_brief", "no_modules"}
    ok_json, status_json = export_is_ready(course, "json")
    assert ok_json and status_json == "ready"


def test_strip_ethics_outside_teacher():
    course = empty_course()
    data = course.as_api()
    data["brief"]["title"] = "Сварка НАКС"
    data["modules"] = [
        {"id": "m1", "title": "Технология сварки", "hours": 10, "topics": ["швы"], "learningOutcomes": ["умеет выполнять шов"], "competencyIds": []},
        {"id": "m2", "title": "Этика и персональные данные", "hours": 4, "topics": ["ПДн"], "learningOutcomes": ["умеет выполнять шов"], "competencyIds": []},
    ]
    course = CourseDocument.model_validate(data)
    cleaned = strip_teacher_only_modules(course)
    titles = [m.title for m in cleaned.modules]
    assert "Технология сварки" in titles
    assert not any("этик" in t.lower() for t in titles)
