# -*- coding: utf-8 -*-
from backend.app.agent import assemble_local_course
from backend.app.brief_guard import (
    clarifying_title_from_reply,
    contains_profanity,
    is_unusable_title,
    strip_assistant_text,
    PROFANITY_REPLY,
)
from backend.app.planner import missing_brief_lines, spoken_reply


def test_profanity_catches_zhopa_and_nahuy():
    assert contains_profanity("жопа")
    assert contains_profanity("ЖОООПААА")
    assert contains_profanity("сучка")
    assert contains_profanity("иди нахуй")
    assert contains_profanity("нахуй")


def test_clarifying_title_accepts_single_word():
    assert clarifying_title_from_reply("геркулес") == "Геркулес"
    assert clarifying_title_from_reply("отврат") == "Отврат"
    assert clarifying_title_from_reply("жопа") == ""
    assert clarifying_title_from_reply("Объём: 6 академических часа") == ""


def test_title_loop_closes_after_reply():
    base = ["месяц", "Объём: 6 академических часа"]
    course = assemble_local_course(base)
    assert "название программы" in missing_brief_lines(course)
    course = assemble_local_course(base + ["геркулес"])
    assert course.brief.title.lower().startswith("геркулес")
    assert "название программы" not in missing_brief_lines(course)
    assert not is_unusable_title(course.brief.title)


def test_profanity_reply_not_title_loop():
    base = ["месяц", "Объём: 6 академических часа"]
    course = assemble_local_course(base)
    assert spoken_reply(course, "иди нахуй") == PROFANITY_REPLY


def test_strip_thinking_leak():
    assert strip_assistant_text("модель думает…") == ""
    assert "Ок" in strip_assistant_text("модель думает…\nОк")
    assert strip_assistant_text("думаю") == ""
    assert strip_assistant_text("<think>secret</think>Готово") == "Готово"


def test_osnovy_python_from_clarifying_reply():
    course = assemble_local_course(
        ["месяц", "Объём: 6 академических часа", "Основы Python"]
    )
    assert "Python" in course.brief.title
    assert "название программы" not in missing_brief_lines(course)


def test_month_alone_still_asks_title_after_hours():
    course = assemble_local_course(["месяц", "Объём: 6 академических часа"])
    assert "название программы" in missing_brief_lines(course)
