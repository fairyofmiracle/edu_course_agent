from backend.app.brief_guard import guard_brief, volume_from_text


def test_practice_minimum_is_not_course_duration():
    text = "Практики должно быть не менее 25 часов"

    assert volume_from_text([text]) is None


def test_lecture_maximum_is_not_course_duration():
    text = "Лекций должно быть не более 10 часов"

    assert volume_from_text([text]) is None


def test_explicit_course_duration():
    text = "Создай курс Python на 40 часов"

    assert volume_from_text([text]) == 40


def test_course_duration_with_practice_requirement():
    text = "Создай курс Python на 40 часов, практики минимум 25 часов"

    assert volume_from_text([text]) == 40


def test_model_cannot_replace_duration_with_practice_hours():
    current = {
        "durationHours": 40,
        "programKind": "general",
    }

    patch = {"durationHours": 25}

    guarded, dropped = guard_brief(
        patch,
        current,
        ["Практики должно быть не менее 25 часов"],
    )

    assert "durationHours" not in guarded
    assert "durationHours" in dropped

def test_practice_before_course_duration():
    text = "Практики минимум 25 часов, общий объём курса 40 часов"

    assert volume_from_text([text]) == 40


def test_only_lab_hours_is_not_course_duration():
    text = "На лабораторные работы выделить 12 часов"

    assert volume_from_text([text]) is None


def test_duration_in_separate_sentence():
    text = "Практики минимум 25 часов. Общая продолжительность курса 40 часов"

    assert volume_from_text([text]) == 40

import pytest


@pytest.mark.parametrize(
    "text, expected",
    [
        (
            "Создай курс Python на 40 часов практики минимум 25 часов",
            40,
        ),
        (
            "Практики минимум 25 часов курс Python на 40 часов",
            40,
        ),
        (
            "Нужно 40 часов всего из них 25 часов практики",
            40,
        ),
        (
            "Практики 25 часов лекций 15 часов",
            None,
        ),
        (
            "Курс на 72 часа лабораторных не более 20 часов",
            72,
        ),
        (
            "Лекций максимум 10 часов практики минимум 30 часов",
            None,
        ),
        (
            "Общая продолжительность 40 часов практика 25 часов",
            40,
        ),
        (
            "Практика 25 часов общая продолжительность 40 часов",
            40,
        ),
    ],
)
def test_duration_without_punctuation(text, expected):
    assert volume_from_text([text]) == expected

def test_practice_hours_with_na_is_not_total_duration():
    text = "На практику выделить 25 часов"

    assert volume_from_text([text]) is None


def test_course_duration_with_practice_in_title():
    text = "Создай курс по практическому Python на 40 часов"

    assert volume_from_text([text]) == 40


def test_program_duration_without_punctuation():
    text = "Программа обучения Python на 72 часа практика минимум 30 часов"

    assert volume_from_text([text]) == 72

@pytest.mark.parametrize(
    "text, expected",
    [
        ("16 часов практики и 36 часов на программу", 36),
        ("25 часов практики 40 часов на курс", 40),
        ("10 часов лекций и 72 часа для программы", 72),
        ("25 часов на практику", None),
        ("10 часов для лекций", None),
    ],
)
def test_duration_hours_first(text, expected):
    assert volume_from_text([text]) == expected


@pytest.mark.parametrize(
    "text, expected",
    [
        ("измени часы на 67", 67),
        ("Измени часы на 67", 67),
        ("поменяй часы на 24", 24),
        ("увеличь часы до 80", 80),
        ("поставь часы на 40", 40),
        ("часы на 67", 67),
    ],
)
def test_hours_named_edit_phrases(text, expected):
    assert volume_from_text([text]) == expected


def test_guard_allows_hours_named_duration_change():
    current = {"durationHours": 36, "programKind": "general", "title": "X"}
    patch = {"durationHours": 67}
    guarded, dropped = guard_brief(patch, current, ["измени часы на 67"])
    assert guarded.get("durationHours") == 67
    assert "durationHours" not in dropped

