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

def test_dirty_title_gryazi_rejected():
    from backend.app.brief_guard import title_from_request, is_garbage_title

    assert title_from_request("делаем грязь") == ""
    assert title_from_request("грязь") == ""
    assert is_garbage_title("Грязь") is True
    assert title_from_request("курс по «Excel для бухгалтерии»") != ""
    assert is_garbage_title("Основы Python") is False
    assert is_garbage_title("грязь") is True


def test_profanity_blocks_title_and_flag():
    from backend.app.brief_guard import title_from_request, contains_profanity, PROFANITY_REPLY

    assert contains_profanity("сделайте курс по блядской аналитике")
    assert contains_profanity("make a fucking Excel course")
    assert title_from_request("курс повышения квалификации по fucking Excel") == ""
    assert title_from_request("программа ДПО: сука как работать в Excel") == ""
    assert "Переформ" in PROFANITY_REPLY


def test_data_analysis_not_from_weak_excel():
    from backend.app.catalog import is_data_analysis, needs_profile_confirm, profile_name
    from backend.app.models import empty_course

    # own-s1 style: Excel бухгалтерия → generic, not data_analysis
    c = empty_course()
    c.brief.title = "Excel для бухгалтерии"
    c.brief.goals = ["сводные таблицы", "отчёты"]
    c.brief.audience = "бухгалтеры"
    assert is_data_analysis(c) is False
    assert needs_profile_confirm(c) is False  # office track excluded
    assert profile_name(c) != "data_analysis"

    # weak: Excel + аналитика without pandas/SQL → confirm, not auto DA
    c2 = empty_course()
    c2.brief.title = "Курс по Excel для аналитиков"
    c2.brief.goals = ["работа с данными", "статистика"]
    c2.brief.audience = "аналитики банка"
    assert is_data_analysis(c2) is False
    assert needs_profile_confirm(c2) is True
    assert profile_name(c2) != "data_analysis"

    # strong: pandas + excel → data_analysis (hunt H_PANDAS_EXCEL)
    c3 = empty_course()
    c3.brief.title = "Pandas и Excel для банка"
    c3.brief.goals = ["pandas", "сводные"]
    c3.brief.audience = "аналитики"
    assert is_data_analysis(c3) is True
    assert needs_profile_confirm(c3) is False


def test_profanity_refused_mid_dialog_run_turn():
    """Swear after a titled brief must refuse and leave course untouched."""
    import asyncio

    from backend.app.agent import run_turn
    from backend.app.brief_guard import PROFANITY_REPLY
    from backend.app.models import empty_course

    course = empty_course()
    course.brief.title = "Python для аналитиков"
    course.brief.duration_hours = 72
    title_before = course.brief.title

    result = asyncio.run(
        run_turn(
            course,
            user_texts=["сделай модуль про блядский pandas"],
            model_messages=[
                {"role": "user", "content": "курс Python 72 часа"},
                {"role": "assistant", "content": "Каркас готов"},
                {"role": "user", "content": "сделай модуль про блядский pandas"},
            ],
        )
    )
    assert result["steps"] == ["profanity_refuse"]
    assert result["assistant"] == PROFANITY_REPLY
    assert result["patches"] == []
    assert result["course"].brief.title == title_before


def test_profanity_does_not_stick_from_earlier_turn():
    """Earlier swear in history must not block a clean follow-up reply."""
    import asyncio

    from backend.app.agent import run_turn
    from backend.app.brief_guard import PROFANITY_REPLY
    from backend.app.models import empty_course

    course = empty_course()
    course.brief.title = "Python для аналитиков"
    course.brief.duration_hours = 72

    result = asyncio.run(
        run_turn(
            course,
            user_texts=["хуй", "до"],
            model_messages=[
                {"role": "user", "content": "хуй"},
                {"role": "assistant", "content": PROFANITY_REPLY},
                {"role": "user", "content": "до"},
            ],
            client=type("NoCloud", (), {"api_key": None, "usage": None, "begin_turn": lambda self: None})(),
        )
    )
    assert result["steps"] != ["profanity_refuse"]
    assert result["assistant"] != PROFANITY_REPLY




def test_guard_brief_keeps_established_title_on_later_offtopic():
    """Later offtopic turn must not wipe an already good title."""
    from backend.app.brief_guard import guard_brief

    current = {
        "title": "Основы Python",
        "durationHours": 36,
        "programKind": "upskilling",
        "goals": ["Научиться писать скрипты"],
        "constraints": [],
        "audience": "начинающие",
        "attestationStatus": "unset",
        "attestationForm": "",
        "attestationHours": 0,
    }
    brief, dropped = guard_brief(
        {"title": "борщ дома"},
        current,
        [
            "курс Основы Python 36 часов",
            "дай рецепт борща",
        ],
    )
    # Bad incoming title dropped; established current is not in patch as empty wipe signal
    assert "title" not in brief or brief.get("title") != "борщ дома"
    assert current["title"] == "Основы Python"

